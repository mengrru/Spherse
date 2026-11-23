import { ModelCatalog, type Logger } from "@spherse/core";
import { RpcErrorCode } from "@spherse/contracts";
import {
  RpcAppError,
  RpcConnectionHandler,
  RpcDispatcher,
  type RpcContext,
  type RpcLogger,
  type RpcMethodEntry,
  type RpcRegistry,
} from "@spherse/rpc/host";
import { ChatSessionHub } from "@spherse/rpc/chat";
import { BrowserProjectRegistry } from "./registry.js";
import {
  BrowserModelSettingsStore,
  createBrowserModelSettings,
  extractProviderKeys,
} from "./model-settings.js";
import { createWorkerBusSource } from "./bus.js";
import { buildBrowserMethodRegistry } from "./methods/index.js";
import { createBrowserRegistryMethods } from "./methods/browser.js";
import { consoleRpcLogger } from "./logger.js";

export interface BrowserRpcAppOptions {
  logger?: RpcLogger;
  appVersion?: string | null;
}

function toCoreLogger(logger: RpcLogger): Logger {
  const coreLogger: Logger = {
    level: "info",
    info: (obj: unknown, msg?: unknown) => logger.info(obj, typeof msg === "string" ? msg : undefined),
    warn: (obj: unknown, msg?: unknown) => logger.warn(obj, typeof msg === "string" ? msg : undefined),
    error: (obj: unknown, msg?: unknown) => logger.error(obj, typeof msg === "string" ? msg : undefined),
    debug: (obj: unknown, msg?: unknown) => logger.debug(obj, typeof msg === "string" ? msg : undefined),
    trace: () => undefined,
    fatal: (obj: unknown, msg?: unknown) => logger.error(obj, typeof msg === "string" ? msg : undefined),
    child: () => coreLogger,
  };
  return coreLogger;
}

export class BrowserRpcApp {
  readonly registry: BrowserProjectRegistry;
  readonly hub: ChatSessionHub;
  private readonly ctx: RpcContext;
  private readonly methods: Map<string, RpcMethodEntry>;
  private readonly logger: RpcLogger;

  private constructor(options: {
    registry: BrowserProjectRegistry;
    ctx: RpcContext;
    methods: Map<string, RpcMethodEntry>;
    logger: RpcLogger;
    hub: ChatSessionHub;
  }) {
    this.registry = options.registry;
    this.ctx = options.ctx;
    this.methods = options.methods;
    this.logger = options.logger;
    this.hub = options.hub;
  }

  static async create(options: BrowserRpcAppOptions = {}): Promise<BrowserRpcApp> {
    const logger = options.logger ?? consoleRpcLogger;
    const catalog = new ModelCatalog();
    const registry = await BrowserProjectRegistry.open(toCoreLogger(logger), catalog);
    const modelSettingsStore = await BrowserModelSettingsStore.open();
    const storedSettings = modelSettingsStore.get();
    catalog.setProviderApiKeys(extractProviderKeys(storedSettings.text.providers));
    catalog.syncCustomProviders(
      storedSettings.customProviders ?? [],
      extractProviderKeys(storedSettings.text.providers),
    );
    if (storedSettings.text.defaultModel) {
      registry.setDefaultModel(storedSettings.text.defaultModel);
    }
    registry.setSampling(storedSettings.text.sampling);
    registry.setThinkingLevel(storedSettings.text.thinkingLevel);
    const hub = new ChatSessionHub(logger);
    const registryPort: RpcRegistry = {
      getSupportedProviders: () => catalog.getSupportedProviders(),
      listInfo: () => registry.listInfo(),
      getInfo: (projectId) => registry.getInfo(projectId),
    };
    const ctx: RpcContext = {
      resolveProject(projectId: string) {
        const project = registry.get(projectId);
        if (!project) throw new RpcAppError(RpcErrorCode.AppNotFound, "Unknown project");
        return project;
      },
      registry: registryPort,
      modelSettings: createBrowserModelSettings(modelSettingsStore, catalog, registry, logger),
      authRequired: false,
      appVersion: options.appVersion ?? null,
      hub,
      bus: createWorkerBusSource(registry),
    };
    const methods = buildBrowserMethodRegistry(createBrowserRegistryMethods(registry));
    return new BrowserRpcApp({ registry, ctx, methods, logger, hub });
  }

  attachPort(port: MessagePort): void {
    const dispatcher = new RpcDispatcher({
      methods: this.wrapWithStoreBarrier(this.methods),
      ctx: this.ctx,
      logger: this.logger,
    });
    const handler = new RpcConnectionHandler(
      { send: (data) => port.postMessage(data) },
      dispatcher,
      this.hub,
      this.ctx,
      this.logger,
    );
    port.postMessage({ type: "spherse-worker-ready" });
    port.onmessage = (ev: MessageEvent) => {
      handler.onMessage(ev.data);
    };
    port.onmessageerror = () => {
      handler.onClose();
    };
  }

  private wrapWithStoreBarrier(methods: Map<string, RpcMethodEntry>): Map<string, RpcMethodEntry> {
    const wrapped = new Map<string, RpcMethodEntry>();
    for (const [name, entry] of methods) {
      wrapped.set(name, {
        params: entry.params,
        handler: (params, ctx, conn) =>
          this.registry.storesReady().then(() => entry.handler(params, ctx, conn)),
      });
    }
    return wrapped;
  }
}
