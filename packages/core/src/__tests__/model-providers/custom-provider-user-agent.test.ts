import { describe, it, expect, afterEach } from "vitest";
import { syncCustomProviders, resolveModelById, getChatModels } from "../../model-providers/index.js";
import type { Context, Model } from "@earendil-works/pi-ai";

const chatContext: Context = {
  messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
};

function sseBody(): string {
  const chunk = (delta: Record<string, unknown>, finishReason: string | null) =>
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 1,
      model: "test-model",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    });
  return [
    `data: ${chunk({ role: "assistant", content: "hi" }, null)}`,
    "",
    `data: ${chunk({}, "stop")}`,
    "",
    "data: [DONE]",
    "",
    "",
  ].join("\n");
}

async function captureRequestHeaders(
  model: Model,
  options: Record<string, unknown> = {},
): Promise<Headers[]> {
  const requestHeaders: Headers[] = [];
  const fetch = async (_input: unknown, init?: RequestInit) => {
    requestHeaders.push(new Headers(init?.headers));
    return new Response(sseBody(), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
  const stream = getChatModels().streamSimple(model, chatContext, {
    fetch: fetch as typeof globalThis.fetch,
    ...options,
  });
  for await (const _event of stream) void _event;
  return requestHeaders;
}

function registerCustomProvider() {
  syncCustomProviders(
    [{ id: "custom-ua", name: "UA Test", baseUrl: "https://ua.example.com/v1", models: ["model-a"], keyless: false }],
    { "custom-ua": "sk-test" },
  );
  return resolveModelById("custom-ua/model-a");
}

afterEach(() => {
  syncCustomProviders([], {});
});

describe("custom provider user-agent", () => {
  it("does not send a user-agent header for custom provider requests", async () => {
    const model = registerCustomProvider();

    const requestHeaders = await captureRequestHeaders(model);

    expect(requestHeaders).toHaveLength(1);
    expect(requestHeaders[0].has("user-agent")).toBe(false);
  });

  it("keeps the SDK default user-agent for builtin providers", async () => {
    const builtinModels = getChatModels()
      .getModels("deepseek")
      .filter((m) => m.api === "openai-completions");
    expect(builtinModels.length).toBeGreaterThan(0);

    const requestHeaders = await captureRequestHeaders(builtinModels[0], { apiKey: "sk-test" });

    expect(requestHeaders).toHaveLength(1);
    expect(requestHeaders[0].get("user-agent")).toMatch(/^OpenAI\/JS/);
  });

  it("prefers an explicitly provided user-agent over suppression", async () => {
    const model = registerCustomProvider();

    const requestHeaders = await captureRequestHeaders(model, {
      apiKey: "sk-test",
      headers: { "User-Agent": "Spherse/1.0" },
    });

    expect(requestHeaders).toHaveLength(1);
    expect(requestHeaders[0].get("user-agent")).toBe("Spherse/1.0");
  });
});
