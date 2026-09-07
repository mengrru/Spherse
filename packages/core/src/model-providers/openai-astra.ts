import type { Model, MutableModels, StreamOptions } from "@earendil-works/pi-ai";

const astra: Model<"openai-responses"> = {
  id: "gpt-6-astra",
  name: "GPT-6 Astra",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: true,
  thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
  input: ["text", "image"],
  cost: {
    input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5,
    tiers: [{ inputTokensAbove: 272000, input: 20, output: 75, cacheRead: 2, cacheWrite: 25 }],
  },
  contextWindow: 1050000,
  maxTokens: 128000,
  compat: { supportsStrictMode: true, supportsExplicitPromptCacheMode: true },
};

function astraPayload(onPayload?: StreamOptions["onPayload"]): NonNullable<StreamOptions["onPayload"]> {
  return async (payload, model) => {
    const prepared = await onPayload?.(payload, model);
    const next = { ...((prepared ?? payload) as Record<string, unknown>) };
    delete next.temperature;
    delete next.top_p;
    delete next.top_logprobs;
    if (Array.isArray(next.include)) {
      next.include = next.include.filter((value) => value !== "message.output_text.logprobs");
    }
    if (next.prompt_cache_retention !== undefined) {
      next.prompt_cache_options = { ...(next.prompt_cache_options as Record<string, unknown>), ttl: "30m" };
    }
    delete next.prompt_cache_retention;
    return next;
  };
}

export function registerOpenaiAstra(models: MutableModels): void {
  const provider = models.getProvider("openai");
  if (!provider) return;
  models.setProvider({
    ...provider,
    getModels: () => {
      const existing = provider.getModels();
      return existing.some((model) => model.id === astra.id) ? existing : [...existing, astra];
    },
    stream: (model, context, options) => provider.stream(model, context, model.id === astra.id ? {
      ...options,
      onPayload: astraPayload(options?.onPayload),
    } as typeof options : options),
    streamSimple: (model, context, options) => provider.streamSimple(model, context, model.id === astra.id ? {
      ...options,
      reasoning: options?.reasoning ?? "low",
      onPayload: astraPayload(options?.onPayload),
    } : options),
  });
}
