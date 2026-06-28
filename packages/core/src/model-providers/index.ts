import { type Models, type ImagesModels, type MutableImagesModels } from "@earendil-works/pi-ai";
import { builtinModels, builtinImagesModels } from "@earendil-works/pi-ai/providers/all";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { ProviderCatalog, ProviderCatalogItem, ProviderModelItem } from "../types.js";
import { createZhipuImagesProvider } from "./zhipu-images.js";

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
] as const;

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  deepseek: "DeepSeek",
  zai: "z.ai",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax（国内）",
  xiaomi: "小米",
  moonshotai: "Moonshot AI",
  "moonshotai-cn": "Moonshot AI（国内）",
  xai: "xAI",
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
};

const models: Models = builtinModels();
const imagesModels: MutableImagesModels = builtinImagesModels();
imagesModels.setProvider(createZhipuImagesProvider());

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
};

const IMAGE_PROVIDER_ENV_KEYS: Record<string, string[]> = {
  openrouter: ["SPHERSE_IMAGE_API_KEY"],
  zhipu: ["SPHERSE_IMAGE_API_KEY"],
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

export function getChatStreamFn(): StreamFn {
  return (model, context, options) => models.streamSimple(model, context, options);
}

export function getImagesModels(): ImagesModels {
  return imagesModels;
}
