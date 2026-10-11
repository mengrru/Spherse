import fs from "node:fs";
import path from "node:path";
import type { ModelCatalog, ModelGroupSettings, ModelSettings, ProviderCredentials } from "@spherse/core";
import type { ModelSettingsRequest, ModelSettingsResponse } from "@spherse/contracts";

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

export class ModelSettingsStore {
  private readonly filePath?: string;
  private settings: ModelSettings;

  constructor(options?: { filePath?: string }) {
    this.filePath = options?.filePath;
    this.settings = this.readFromDisk();
  }

  private readFromDisk(): ModelSettings {
    if (!this.filePath) return normalizeSettings(undefined);
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      return normalizeSettings(JSON.parse(raw));
    } catch {
      return normalizeSettings(undefined);
    }
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

  applyUpdate(request: ModelSettingsRequest): ModelSettings {
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
    this.settings = next;
    this.persist();
    return next;
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), "utf-8");
    fs.renameSync(tmp, this.filePath);
  }
}

function extractProviderKeys(providers: Record<string, ProviderCredentials> | undefined): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const [id, creds] of Object.entries(providers ?? {})) {
    if (creds?.apiKey) keys[id] = creds.apiKey;
  }
  return keys;
}

const envOverrides = new Map<string, string | undefined>();

function applyProviderKeysToEnv(settings: ModelSettings, catalog: ModelCatalog): void {
  const textCatalog = catalog.getSupportedProviders();
  const applied = new Set<string>();
  for (const [id, creds] of Object.entries(settings.text.providers)) {
    const envName = textCatalog[id]?.auth.envKeys[0];
    if (!creds?.apiKey || !envName) continue;
    if (!envOverrides.has(envName)) envOverrides.set(envName, process.env[envName]);
    process.env[envName] = creds.apiKey;
    applied.add(envName);
  }
  for (const [envName, original] of envOverrides) {
    if (applied.has(envName)) continue;
    if (original === undefined) delete process.env[envName];
    else process.env[envName] = original;
    envOverrides.delete(envName);
  }
}

export function applyModelSettingsToEnv(settings: ModelSettings, catalog: ModelCatalog): void {
  applyProviderKeysToEnv(settings, catalog);

  const imageGroup = settings.image;
  if (imageGroup?.defaultModel) {
    process.env.SPHERSE_IMAGE_MODEL = imageGroup.defaultModel;
    const slashIdx = imageGroup.defaultModel.indexOf("/");
    const provider = slashIdx > 0 ? imageGroup.defaultModel.slice(0, slashIdx) : "";
    process.env.SPHERSE_IMAGE_API_KEY = imageGroup.providers[provider]?.apiKey ?? "";
  } else {
    delete process.env.SPHERSE_IMAGE_MODEL;
    delete process.env.SPHERSE_IMAGE_API_KEY;
  }

  catalog.syncCustomProviders(
    settings.customProviders ?? [],
    extractProviderKeys(settings.text.providers),
  );
}
