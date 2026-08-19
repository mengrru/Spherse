import { describe, it, expect, afterEach } from "vitest";
import { ModelCatalog } from "../../model-providers/catalog.js";

const catalog = new ModelCatalog();
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

function anthropicSseBody(): string {
  return [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","model":"kimi-for-coding","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}',
    "",
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    "",
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
    "",
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":0}',
    "",
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
    "",
    'event: message_stop',
    'data: {"type":"message_stop"}',
    "",
    "",
  ].join("\n");
}

async function captureRequestHeaders(
  model: Model,
  options: Record<string, unknown> = {},
  body: string = sseBody(),
): Promise<Headers[]> {
  const requestHeaders: Headers[] = [];
  const fetch = async (_input: unknown, init?: RequestInit) => {
    requestHeaders.push(new Headers(init?.headers));
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
  const stream = catalog.getChatModels().streamSimple(model, chatContext, {
    fetch: fetch as typeof globalThis.fetch,
    ...options,
  });
  for await (const _event of stream) void _event;
  return requestHeaders;
}

function registerCustomProvider() {
  catalog.syncCustomProviders(
    [{ id: "custom-ua", name: "UA Test", baseUrl: "https://ua.example.com/v1", models: ["model-a"], keyless: false }],
    { "custom-ua": "sk-test" },
  );
  return catalog.resolveModelById("custom-ua/model-a");
}

afterEach(() => {
  catalog.syncCustomProviders([], {});
});

describe("custom provider user-agent", () => {
  it("does not send a user-agent header for custom provider requests", async () => {
    const model = registerCustomProvider();

    const requestHeaders = await captureRequestHeaders(model);

    expect(requestHeaders).toHaveLength(1);
    expect(requestHeaders[0].has("user-agent")).toBe(false);
  });

  it("keeps the SDK default user-agent for builtin providers", async () => {
    const builtinModels = catalog.getChatModels()
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

  it("prefers an explicitly provided lowercase user-agent key over suppression", async () => {
    const model = registerCustomProvider();

    const requestHeaders = await captureRequestHeaders(model, {
      apiKey: "sk-test",
      headers: { "user-agent": "Spherse-Lower/1.0" },
    });

    expect(requestHeaders).toHaveLength(1);
    expect(requestHeaders[0].get("user-agent")).toBe("Spherse-Lower/1.0");
  });

  it("does not send a user-agent header for keyless custom providers", async () => {
    catalog.syncCustomProviders(
      [{ id: "custom-keyless-ua", name: "Keyless UA", baseUrl: "https://keyless.example.com/v1", models: ["m"], keyless: true }],
      {},
    );
    const model = catalog.resolveModelById("custom-keyless-ua/m");

    const requestHeaders = await captureRequestHeaders(model);

    expect(requestHeaders).toHaveLength(1);
    expect(requestHeaders[0].has("user-agent")).toBe(false);
  });

  it("sends pi's runtime user-agent for kimi-coding (pi-ai >=0.84.2)", async () => {
    // pi-ai 0.84.2 起 kimi-coding 不再在模型上定义 KimiCLI/1.5 UA，
    // 改为在请求层强制注入 pi 的运行时 UA（见 pi release v0.84.2 "Changed
    // inherited Kimi Coding requests to use pi's runtime User-Agent header"）。
    const kimiModels = catalog.getChatModels()
      .getModels("kimi-coding")
      .filter((m) => m.api === "anthropic-messages");
    expect(kimiModels.length).toBeGreaterThan(0);

    const requestHeaders = await captureRequestHeaders(
      kimiModels[0],
      { apiKey: "sk-test" },
      anthropicSseBody(),
    );

    expect(requestHeaders).toHaveLength(1);
    expect(requestHeaders[0].get("user-agent")).toMatch(/^pi \(/);
  });
});
