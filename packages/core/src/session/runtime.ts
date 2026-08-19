import type { ProjectStore } from "../store/project.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import type { Logger } from "../logger.js";
import type { SamplingParams } from "../types.js";
import { composeTurnHooks, type TurnHooksFactory } from "../kernel/turn-hooks.js";
import type { ModelResolver } from "./model-resolver.js";
import { createModelResolver } from "./model-resolver.js";
import { ModelCatalog } from "../model-providers/catalog.js";
import type { Capability } from "../kernel/capability.js";
import type { AttachmentProcessor } from "../kernel/attachments.js";
import type { StoreRegistry } from "../kernel/ports.js";

export interface RunConfig {
  readonly defaultModel?: string;
  readonly sampling?: SamplingParams;
}

export interface RunConfigSource {
  current(): RunConfig;
}

export class RunConfigHolder implements RunConfigSource {
  private config: RunConfig;

  constructor(initial?: RunConfig) {
    this.config = initial ?? {};
  }

  current(): RunConfig {
    return this.config;
  }

  update(patch: Partial<RunConfig>): void {
    this.config = { ...this.config, ...patch };
  }
}

export interface RuntimeDeps {
  readonly projectStore: ProjectStore;
  readonly projectRoot: string;
  readonly fileWriteMutex: FileWriteMutex;
  readonly logger: Logger;
  readonly runConfig: RunConfigSource;
  readonly createTurnHooks?: TurnHooksFactory;
  readonly modelResolver: ModelResolver;
  readonly modelCatalog: ModelCatalog;
  readonly capabilities: ReadonlyArray<Capability>;
  readonly stores: import("../kernel/ports.js").StoreRegistry;
  readonly attachmentProcessors: ReadonlyArray<AttachmentProcessor>;
}

export function freezeRuntimeDeps(deps: RuntimeDeps): Readonly<RuntimeDeps> {
  return Object.freeze({ ...deps });
}

export function createRuntimeDeps(input: {
  projectStore: ProjectStore;
  logger: Logger;
  fileWriteMutex: FileWriteMutex;
  capabilities: ReadonlyArray<Capability>;
  stores: StoreRegistry;
  runConfig: RunConfigSource;
  modelResolver?: ModelResolver;
  modelCatalog?: ModelCatalog;
}): Readonly<RuntimeDeps> {
  const capabilities = input.capabilities;
  const catalog = input.modelCatalog ?? new ModelCatalog();
  return freezeRuntimeDeps({
    projectStore: input.projectStore,
    projectRoot: input.projectStore.getRootPath(),
    fileWriteMutex: input.fileWriteMutex,
    logger: input.logger,
    runConfig: input.runConfig,
    createTurnHooks: (agentId, sessionId) =>
      composeTurnHooks(
        capabilities
          .map((c) => c.turnHooks?.(agentId, sessionId))
          .filter((h): h is NonNullable<ReturnType<TurnHooksFactory>> => Boolean(h)),
      ),
    modelCatalog: catalog,
    modelResolver: input.modelResolver ?? createModelResolver(catalog),
    capabilities,
    stores: input.stores,
    attachmentProcessors: capabilities.flatMap((c) => c.attachmentProcessors ?? []),
  });
}
