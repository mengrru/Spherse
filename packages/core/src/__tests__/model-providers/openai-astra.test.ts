import { describe, expect, it, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import { getSupportedThinkingLevels, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { ModelCatalog } from "../../model-providers/catalog.js";

const context: Context = {
  messages: [{ role: "user", content: "hello", timestamp: 1 }],
  tools: [{ name: "lookup", description: "Look up a value", parameters: Type.Object({ query: Type.String() }) }],
};

async function captureRequest(options: SimpleStreamOptions = {}, modelId = "openai/gpt-6-astra", mode: "chat" | "simple" | "full" = "chat") {
  const catalog = new ModelCatalog();
  const model = catalog.resolveModelById(modelId);
  const fetch = vi.fn(async () => new Response(
    'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_test","status":"completed","output":[],"usage":{"input_tokens":10,"output_tokens":1}}}\n\n',
    { headers: { "content-type": "text/event-stream" } },
  ));
  const requestOptions = {
    apiKey: "sk-test",
    ...options,
    fetch: fetch as typeof globalThis.fetch,
  };
  const stream = mode === "chat"
    ? await catalog.getChatStreamFn({ temperature: 0.7, topP: 0.9 })(model, context, requestOptions)
    : mode === "simple"
      ? catalog.getChatModels().streamSimple(model, context, requestOptions)
      : catalog.getChatModels().stream(model, context, requestOptions);
  const result = await stream.result();
  expect(result.stopReason).not.toBe("error");
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  return { url: String(url), payload: JSON.parse(init.body as string) };
}

describe("OpenAI GPT-6 Astra", () => {
  it("is discoverable with its supported effort levels and context limits", () => {
    const catalog = new ModelCatalog();
    expect(catalog.getSupportedProviders().openai.models).toContainEqual(expect.objectContaining({
      id: "gpt-6-astra", name: "GPT-6 Astra", api: "openai-responses", reasoning: true,
      contextWindow: 1050000, maxTokens: 128000,
    }));
    expect(getSupportedThinkingLevels(catalog.resolveModelById("openai/gpt-6-astra")))
      .toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it.each(["low", "medium", "high", "xhigh", "max"] as const)("sends %s effort with tools through Responses", async (reasoning) => {
    const { url, payload } = await captureRequest({ reasoning });
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(payload.model).toBe("gpt-6-astra");
    expect(payload.reasoning.effort).toBe(reasoning);
    expect(payload.tools).toContainEqual(expect.objectContaining({ type: "function", name: "lookup" }));
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("top_p");
  });

  it("uses low when the agent disables reasoning", async () => {
    const { payload } = await captureRequest({ reasoning: undefined });
    expect(payload.reasoning.effort).toBe("low");
  });

  it("clamps minimal to low", async () => {
    const { payload } = await captureRequest({ reasoning: "minimal" });
    expect(payload.reasoning.effort).toBe("low");
  });

  it("removes legacy cache retention for long-cache requests", async () => {
    const { payload } = await captureRequest({ cacheRetention: "long" });
    expect(payload).not.toHaveProperty("prompt_cache_retention");
    expect(payload.prompt_cache_options).toMatchObject({ ttl: "30m" });
  });

  it("keeps short-cache requests free of legacy retention", async () => {
    const { payload } = await captureRequest({ cacheRetention: "short" });
    expect(payload).not.toHaveProperty("prompt_cache_retention");
  });

  it("disables implicit caching when cache retention is none", async () => {
    const { payload } = await captureRequest({ cacheRetention: "none", sessionId: "session-test" });
    expect(payload.prompt_cache_options).toEqual({ mode: "explicit" });
    expect(payload).not.toHaveProperty("prompt_cache_key");
    expect(payload).not.toHaveProperty("prompt_cache_retention");
  });

  it("preserves asynchronous payload callbacks before removing unsupported parameters", async () => {
    const onPayload = vi.fn(async (payload: unknown) => ({
      ...(payload as Record<string, unknown>),
      metadata: { task: "test" },
      temperature: 0.4,
      top_p: 0.5,
      top_logprobs: 2,
      include: ["reasoning.encrypted_content", "message.output_text.logprobs"],
    }));
    const { payload } = await captureRequest({ onPayload, reasoning: "max" });
    expect(onPayload).toHaveBeenCalledTimes(1);
    expect(payload.metadata).toEqual({ task: "test" });
    expect(payload.include).toEqual(["reasoning.encrypted_content"]);
    expect(payload.reasoning.effort).toBe("max");
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("top_p");
    expect(payload).not.toHaveProperty("top_logprobs");
  });

  it("preserves sampling for other OpenAI models", async () => {
    const { payload } = await captureRequest({}, "openai/gpt-4o");
    expect(payload.temperature).toBe(0.7);
    expect(payload.top_p).toBe(0.9);
  });

  it.each(["simple", "full"] as const)("protects direct catalog %s requests", async (mode) => {
    const { payload } = await captureRequest({ temperature: 0.6, cacheRetention: "long" }, "openai/gpt-6-astra", mode);
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("prompt_cache_retention");
    expect(payload.prompt_cache_options.ttl).toBe("30m");
    expect(payload.reasoning?.effort).not.toBe("none");
  });
});
