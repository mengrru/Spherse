import { getProviders, getModels, getModel } from "@earendil-works/pi-ai";
import type { ProviderCatalog, ProviderCatalogItem, ProviderModelItem } from "./types.js";

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
  const allProviders = getProviders();
  const enabledSet = new Set<string>(ENABLED_PROVIDERS);
  const catalog: ProviderCatalog = {};

  for (const provider of allProviders) {
    if (!enabledSet.has(provider)) continue;
    const models = getModels(provider);
    if (models.length === 0) continue;

    const envKeys = PROVIDER_ENV_KEYS[provider] ?? [];
    const authType = resolveAuthType(provider);

    const items: ProviderModelItem[] = models.map((m) => ({
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
      id: provider,
      name: toDisplayName(provider),
      auth: { type: authType, envKeys },
      models: items,
    };
    catalog[provider] = item;
  }

  return catalog;
}

export function resolveModelById(modelId: string) {
  const slashIdx = modelId.indexOf("/");
  if (slashIdx >= 0) {
    const provider = modelId.slice(0, slashIdx);
    const id = modelId.slice(slashIdx + 1);
    const model = (getModel as any)(provider, id);
    if (model) return model;
    throw new Error(`Could not resolve model: ${modelId}`);
  }
  const providers = getProviders();
  for (const provider of providers) {
    const model = (getModel as any)(provider, modelId);
    if (model) return model;
  }
  throw new Error(`Could not resolve model: ${modelId}`);
}
