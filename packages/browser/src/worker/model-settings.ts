import type {
  ModelCatalog,
  ModelGroupSettings,
  ModelSettings,
  ProviderCredentials,
} from "@spherse/core";
import type { ModelSettingsRequest, ModelSettingsResponse } from "@spherse/contracts";
import type { RpcLogger, RpcModelSettings } from "@spherse/rpc/host";
import type { BrowserProjectRegistry } from "./registry.js";
import { readOpfsJson, writeOpfsJson } from "./opfs-json.js";

function storageScope(): string {
  const base = import.meta.env.BASE_URL;
  if (base === "/" || base === "" || base === "./") return "";
  return `${base.split("/").filter(Boolean).join("-")}/`;
}

const MODEL_SETTINGS_FILE = `${storageScope()}spherse-model-settings.json`;

function emptyGroup(): ModelGroupSettings {
  return { defaultModel: "", providers: {} };
}

function normalizeGroup(raw: unknown): ModelGroupSettings {
  if (typeof raw !== "object" || raw === null) return emptyGroup();
  const group = raw as Partial<ModelGroupSettings>;
  const providers: Record<string, ProviderCredentials> = {};
  for (const [id, creds] of Object.entries(group.providers ?? {})) {
    if (creds?.apiKey?.trim()) providers[id] = { apiKey: creds.apiKey };
  }
  return {
    defaultModel: typeof group.defaultModel === "string" ? group.defaultModel : "",
    providers,
    sampling: group.sampling,
    thinkingLevel: group.thinkingLevel,
  };
}

function normalizeSettings(raw: unknown): ModelSettings {
  if (typeof raw !== "object" || raw === null) {
    return { text: emptyGroup(), image: emptyGroup(), customProviders: [] };
  }
  const data = raw as Partial<ModelSettings>;
  return {
    text: normalizeGroup(data.text),
    image: normalizeGroup(data.image),
    customProviders: Array.isArray(data.customProviders) ? data.customProviders : [],
  };
}

function mergeProviderKeys(
  incoming: Record<string, { apiKey?: string }> | undefined,
  prev: Record<string, ProviderCredentials>,
): Record<string, ProviderCredentials> {
  const next: Record<string, ProviderCredentials> = {};
  for (const [id, creds] of Object.entries(prev)) {
    if (creds?.apiKey?.trim()) next[id] = { apiKey: creds.apiKey };
  }
  if (!incoming) return next;
  for (const [id, write] of Object.entries(incoming)) {
    const apiKey = write?.apiKey;
    if (apiKey === undefined) continue;
    if (!apiKey.trim()) {
      delete next[id];
      continue;
    }
    next[id] = { apiKey };
  }
  return next;
}

function extractProviderKeys(providers: Record<string, ProviderCredentials> | undefined): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const [id, creds] of Object.entries(providers ?? {})) {
    if (creds?.apiKey) keys[id] = creds.apiKey;
  }
  return keys;
}

export class BrowserModelSettingsStore {
  private settings: ModelSettings;

  private constructor(settings: ModelSettings) {
    this.settings = settings;
  }

  static async open(): Promise<BrowserModelSettingsStore> {
    const raw = await readOpfsJson<unknown>(MODEL_SETTINGS_FILE, undefined);
    return new BrowserModelSettingsStore(normalizeSettings(raw));
  }

  get(): ModelSettings {
    return this.settings;
  }

  sanitize(): ModelSettingsResponse {
    return {
      models: {
        text: {
          defaultModel: this.settings.text.defaultModel,
          providers: this.toConfiguredMap(this.settings.text.providers),
          sampling: this.settings.text.sampling,
          thinkingLevel: this.settings.text.thinkingLevel,
        },
        image: {
          defaultModel: this.settings.image.defaultModel,
          providers: this.toConfiguredMap(this.settings.image.providers),
        },
      },
      customProviders: this.settings.customProviders,
    };
  }

  private toConfiguredMap(providers: Record<string, ProviderCredentials>): Record<string, { configured: boolean }> {
    const map: Record<string, { configured: boolean }> = {};
    for (const [id, creds] of Object.entries(providers)) {
      map[id] = { configured: Boolean(creds?.apiKey?.trim()) };
    }
    return map;
  }

  async applyUpdate(request: ModelSettingsRequest): Promise<ModelSettings> {
    const prev = this.settings;
    const next: ModelSettings = {
      text: {
        defaultModel: request.models.text.defaultModel,
        providers: mergeProviderKeys(request.models.text.providers, prev.text.providers),
        sampling: request.models.text.sampling,
        thinkingLevel: request.models.text.thinkingLevel,
      },
      image: {
        defaultModel: request.models.image.defaultModel,
        providers: mergeProviderKeys(request.models.image.providers, prev.image.providers),
      },
      customProviders: request.customProviders ?? prev.customProviders,
    };
    await writeOpfsJson(MODEL_SETTINGS_FILE, next);
    this.settings = next;
    return next;
  }
}

export function createBrowserModelSettings(
  store: BrowserModelSettingsStore,
  catalog: ModelCatalog,
  registry: BrowserProjectRegistry,
  logger: RpcLogger,
): RpcModelSettings {
  return {
    sanitize: () => store.sanitize(),
    apply: (req: unknown) => {
      const applyAsync = async () => {
        const next = await store.applyUpdate(req as ModelSettingsRequest);
        catalog.syncCustomProviders(
          next.customProviders ?? [],
          extractProviderKeys(next.text.providers),
        );
        if (next.text.defaultModel) {
          registry.setDefaultModel(next.text.defaultModel);
        }
        registry.setSampling(next.text.sampling);
        registry.setThinkingLevel(next.text.thinkingLevel);
        return store.sanitize();
      };
      return applyAsync().catch((err) => {
        logger.error({ err }, "model settings apply failed");
        throw err;
      });
    },
  };
}
