import { type Models, type MutableModels, type ImagesModels, type MutableImagesModels, createProvider, type ApiKeyAuth } from "@earendil-works/pi-ai";
import { builtinModels, builtinImagesModels } from "@earendil-works/pi-ai/providers/all";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { CustomProviderDef, ProviderCatalog, ProviderCatalogItem, ProviderModelItem, SamplingParams } from "../types.js";
import { createZhipuImagesProvider } from "./zhipu-images.js";
import { createOpenaiImagesProvider } from "./openai-images.js";

export const ENABLED_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "zai",
  "minimax",
  "minimax-cn",
  "xiaomi",
  "moonshotai",
  "moonshotai-cn",
  "xai",
  "openrouter",
  "kimi-coding",
  "opencode-go",
] as const;

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  deepseek: "DeepSeek",
  zai: "Zhipu",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax（国内）",
  xiaomi: "小米",
  moonshotai: "Moonshot AI",
  "moonshotai-cn": "Moonshot AI（国内）",
  xai: "xAI",
  openrouter: "OpenRouter",
  "kimi-coding": "Kimi For Coding",
  "opencode-go": "OpenCode Go",
};

const PROVIDER_ENV_KEYS: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GEMINI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  zai: ["ZAI_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  "minimax-cn": ["MINIMAX_CN_API_KEY"],
  xiaomi: ["XIAOMI_API_KEY"],
  moonshotai: ["MOONSHOT_API_KEY"],
  "moonshotai-cn": ["MOONSHOT_API_KEY"],
  xai: ["XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  "kimi-coding": ["KIMI_API_KEY"],
  "opencode-go": ["OPENCODE_API_KEY"],
};

const models: MutableModels = builtinModels();
const imagesModels: MutableImagesModels = builtinImagesModels();
imagesModels.setProvider(createZhipuImagesProvider());
imagesModels.setProvider(createOpenaiImagesProvider());

let registeredDefs: CustomProviderDef[] = [];
const customIds = new Set<string>();
const KEYLESS_PLACEHOLDER = "sk-no-key";

function customAuth(apiKey: string | undefined, keyless: boolean): ApiKeyAuth {
  return {
    name: "API Key",
    resolve: async () => {
      if (apiKey) return { auth: { apiKey }, source: "API Key" };
      if (keyless) return { auth: { apiKey: KEYLESS_PLACEHOLDER }, source: "Keyless" };
      return undefined;
    },
  };
}

function buildCustomProvider(def: CustomProviderDef, apiKey: string | undefined) {
  const input: ("text" | "image")[] = ["text"];
  const modelList = def.models.map((m) => ({
    id: m,
    name: m,
    api: "openai-completions" as const,
    provider: def.id,
    baseUrl: def.baseUrl,
    reasoning: false,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 4096,
  }));
  return createProvider({
    id: def.id,
    name: def.name,
    baseUrl: def.baseUrl,
    auth: { apiKey: customAuth(apiKey, def.keyless) },
    models: modelList,
    api: openAICompletionsApi(),
  });
}

export function syncCustomProviders(defs: CustomProviderDef[], apiKeys: Record<string, string>): void {
  const nextIds = new Set(defs.map((d) => d.id));
  for (const id of [...customIds].filter((i) => !nextIds.has(i))) {
    models.deleteProvider(id);
    customIds.delete(id);
  }
  for (const def of defs) {
    models.setProvider(buildCustomProvider(def, apiKeys[def.id]));
    customIds.add(def.id);
  }
  registeredDefs = defs;
}

function toDisplayName(id: string): string {
  return (
    PROVIDER_DISPLAY_NAMES[id] ??
    id
      .split("-")
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join(" ")
  );
}

function resolveAuthType(provider: string): "apiKey" | "external" | "unknown" {
  if (PROVIDER_ENV_KEYS[provider]?.length) return "apiKey";
  if (provider === "amazon-bedrock" || provider === "google-vertex") return "external";
  return "unknown";
}

export function getSupportedProviders(): ProviderCatalog {
  const allProviders = models.getProviders();
  const enabledSet = new Set<string>(ENABLED_PROVIDERS);
  const catalog: ProviderCatalog = {};

  for (const provider of allProviders) {
    if (!enabledSet.has(provider.id)) continue;
    const providerModels = models.getModels(provider.id);
    if (providerModels.length === 0) continue;

    const envKeys = PROVIDER_ENV_KEYS[provider.id] ?? [];
    const authType = resolveAuthType(provider.id);

    const items: ProviderModelItem[] = providerModels.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      api: m.api,
      reasoning: m.reasoning ?? false,
      input: m.input ?? ["text"],
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    }));

    const item: ProviderCatalogItem = {
      id: provider.id,
      name: toDisplayName(provider.id),
      auth: { type: authType, envKeys },
      models: items,
    };
    catalog[provider.id] = item;
  }

  for (const def of registeredDefs) {
    catalog[def.id] = {
      id: def.id,
      name: def.name,
      auth: { type: def.keyless ? "unknown" : "apiKey", envKeys: [] },
      models: def.models.map((m) => ({
        id: m,
        name: m,
        provider: def.id,
        api: "openai-completions",
        reasoning: false,
        input: ["text"],
        contextWindow: 32768,
        maxTokens: 4096,
      })),
      custom: true,
      keyless: def.keyless,
      baseUrl: def.baseUrl,
    };
  }

  return catalog;
}

export function resolveModelById(modelId: string) {
  const slashIdx = modelId.indexOf("/");
  if (slashIdx >= 0) {
    const provider = modelId.slice(0, slashIdx);
    const id = modelId.slice(slashIdx + 1);
    const model = models.getModel(provider, id);
    if (model) return model;
    throw new Error(`Could not resolve model: ${modelId}`);
  }
  const providers = models.getProviders();
  for (const provider of providers) {
    const model = models.getModel(provider.id, modelId);
    if (model) return model;
  }
  throw new Error(`Could not resolve model: ${modelId}`);
}

const IMAGE_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openrouter: "OpenRouter",
  zhipu: "智谱",
  openai: "OpenAI",
};

const IMAGE_PROVIDER_ENV_KEYS: Record<string, string[]> = {
  openrouter: ["SPHERSE_IMAGE_API_KEY"],
  zhipu: ["SPHERSE_IMAGE_API_KEY"],
  openai: ["SPHERSE_IMAGE_API_KEY"],
};

export function getImageSupportedProviders(): ProviderCatalog {
  const catalog: ProviderCatalog = {};

  for (const provider of imagesModels.getProviders()) {
    const providerModels = imagesModels.getModels(provider.id);
    if (providerModels.length === 0) continue;
    const items: ProviderModelItem[] = providerModels.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      api: m.api,
      reasoning: false,
      input: m.input ?? ["text"],
    }));
    catalog[provider.id] = {
      id: provider.id,
      name: IMAGE_PROVIDER_DISPLAY_NAMES[provider.id] ?? provider.id,
      auth: { type: "apiKey", envKeys: IMAGE_PROVIDER_ENV_KEYS[provider.id] ?? [] },
      models: items,
    };
  }

  return catalog;
}

export function getChatStreamFn(sampling?: SamplingParams): StreamFn {
  const { temperature, topP } = sampling ?? {};
  return (model, context, options) =>
    models.streamSimple(model, context, {
      ...options,
      ...(temperature != null ? { temperature } : {}),
      ...(topP != null ? { onPayload: injectTopP(topP) } : {}),
    });
}

function injectTopP(topP: number) {
  return (payload: unknown, model: { api?: string }) => {
    const api = model?.api;
    if (api === "google-generative-ai") {
      const p = (payload ?? {}) as Record<string, unknown>;
      const config = (p.config ?? {}) as Record<string, unknown>;
      return { ...p, config: { ...config, topP } };
    }
    if (
      api === "openai-completions" ||
      api === "openai-responses" ||
      api === "anthropic-messages"
    ) {
      const p = (payload ?? {}) as Record<string, unknown>;
      return { ...p, top_p: topP };
    }
    return undefined;
  };
}

export function getImagesModels(): ImagesModels {
  return imagesModels;
}

export function getChatModels(): Models {
  return models;
}
