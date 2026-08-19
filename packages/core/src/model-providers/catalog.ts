import {
  type Models,
  type MutableModels,
  type ImagesModels,
  type MutableImagesModels,
  createProvider,
  type ApiKeyAuth,
  type ProviderStreams,
  type ProviderHeaders,
} from "@earendil-works/pi-ai";
import { builtinModels, builtinImagesModels } from "@earendil-works/pi-ai/providers/all";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type {
  CustomProviderDef,
  ProviderCatalog,
  ProviderCatalogItem,
  ProviderModelItem,
  SamplingParams,
} from "../types.js";
import { createZhipuImagesProvider } from "./zhipu-images.js";
import { createOpenaiImagesProvider } from "./openai-images.js";

export const ENABLED_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "zai",
  "zai-coding-cn",
  "minimax",
  "minimax-cn",
  "xiaomi",
  "xiaomi-token-plan-cn",
  "qwen-token-plan-cn",
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
  "zai-coding-cn": "Zhipu Coding CN",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax CN",
  xiaomi: "Xiaomi",
  "xiaomi-token-plan-cn": "Xiaomi Token Plan CN",
  "qwen-token-plan-cn": "Qwen Token Plan CN",
  moonshotai: "Moonshot AI",
  "moonshotai-cn": "Moonshot AI CN",
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
  "zai-coding-cn": ["ZAI_CODING_CN_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  "minimax-cn": ["MINIMAX_CN_API_KEY"],
  xiaomi: ["XIAOMI_API_KEY"],
  "xiaomi-token-plan-cn": ["XIAOMI_TOKEN_PLAN_CN_API_KEY"],
  "qwen-token-plan-cn": ["QWEN_TOKEN_PLAN_CN_API_KEY"],
  moonshotai: ["MOONSHOT_API_KEY"],
  "moonshotai-cn": ["MOONSHOT_API_KEY"],
  xai: ["XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  "kimi-coding": ["KIMI_API_KEY"],
  "opencode-go": ["OPENCODE_API_KEY"],
};

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

function suppressUserAgent(api: ProviderStreams): ProviderStreams {
  const inject = <T extends { headers?: ProviderHeaders }>(options?: T): T => ({
    ...(options ?? ({} as T)),
    headers: { "User-Agent": null, ...options?.headers },
  });
  const wrapped: ProviderStreams = {
    stream: (model, context, options) => api.stream(model, context, inject(options)),
    streamSimple: (model, context, options) => api.streamSimple(model, context, inject(options)),
  };
  if (api.fetchDeferred) {
    wrapped.fetchDeferred = (model, handle, options) => api.fetchDeferred!(model, handle, inject(options));
  }
  if (api.cancelDeferred) {
    wrapped.cancelDeferred = (model, handle, options) => api.cancelDeferred!(model, handle, inject(options));
  }
  return wrapped;
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
    api: suppressUserAgent(openAICompletionsApi()),
  });
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

export class ModelCatalog {
  private readonly models: MutableModels;
  private readonly imagesModels: MutableImagesModels;
  private registeredDefs: CustomProviderDef[] = [];
  private readonly customIds = new Set<string>();

  constructor() {
    this.models = builtinModels();
    this.imagesModels = builtinImagesModels();
    this.imagesModels.setProvider(createZhipuImagesProvider());
    this.imagesModels.setProvider(createOpenaiImagesProvider());
  }

  syncCustomProviders(defs: CustomProviderDef[], apiKeys: Record<string, string>): void {
    const nextIds = new Set(defs.map((d) => d.id));
    for (const id of [...this.customIds].filter((i) => !nextIds.has(i))) {
      this.models.deleteProvider(id);
      this.customIds.delete(id);
    }
    for (const def of defs) {
      this.models.setProvider(buildCustomProvider(def, apiKeys[def.id]));
      this.customIds.add(def.id);
    }
    this.registeredDefs = defs;
  }

  getSupportedProviders(): ProviderCatalog {
    const allProviders = this.models.getProviders();
    const enabledSet = new Set<string>(ENABLED_PROVIDERS);
    const catalog: ProviderCatalog = {};

    for (const provider of allProviders) {
      if (!enabledSet.has(provider.id)) continue;
      const providerModels = this.models.getModels(provider.id);
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

    for (const def of this.registeredDefs) {
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

  resolveModelById(modelId: string) {
    const slashIdx = modelId.indexOf("/");
    if (slashIdx >= 0) {
      const provider = modelId.slice(0, slashIdx);
      const id = modelId.slice(slashIdx + 1);
      const model = this.models.getModel(provider, id);
      if (model) return model;
      throw new Error(`Could not resolve model: ${modelId}`);
    }
    const providers = this.models.getProviders();
    for (const provider of providers) {
      const model = this.models.getModel(provider.id, modelId);
      if (model) return model;
    }
    throw new Error(`Could not resolve model: ${modelId}`);
  }

  getImageSupportedProviders(): ProviderCatalog {
    const catalog: ProviderCatalog = {};

    for (const provider of this.imagesModels.getProviders()) {
      const providerModels = this.imagesModels.getModels(provider.id);
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

  getChatStreamFn(sampling?: SamplingParams): StreamFn {
    const { temperature, topP } = sampling ?? {};
    const models = this.models;
    return (model, context, options) =>
      models.streamSimple(model, context, {
        ...options,
        ...(temperature != null ? { temperature } : {}),
        ...(topP != null ? { onPayload: injectTopP(topP) } : {}),
      });
  }

  getChatModels(): Models {
    return this.models;
  }

  getImagesModels(): ImagesModels {
    return this.imagesModels;
  }
}
