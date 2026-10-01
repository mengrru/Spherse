import { describe, it, expect, afterEach } from "vitest";
import { ModelCatalog } from "../../model-providers/catalog.js";
import type { Context, Model } from "@earendil-works/pi-ai";

const catalog = new ModelCatalog();

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

async function captureRequestHeaders(model: Model): Promise<Headers[]> {
  const requestHeaders: Headers[] = [];
  const fetch = async (_input: unknown, init?: RequestInit) => {
    requestHeaders.push(new Headers(init?.headers));
    return new Response(sseBody(), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
  const stream = catalog.getChatModels().streamSimple(model, chatContext, {
    fetch: fetch as typeof globalThis.fetch,
  });
  for await (const _event of stream) void _event;
  return requestHeaders;
}

function registerCustomProvider(headers?: Record<string, string>, keyless = false) {
  catalog.syncCustomProviders(
    [{
      id: "custom-hdr",
      name: "Header Test",
      baseUrl: "https://hdr.example.com/v1",
      models: ["model-a"],
      keyless,
      ...(headers ? { headers } : {}),
    }],
    keyless ? {} : { "custom-hdr": "sk-test" },
  );
  return catalog.resolveModelById("custom-hdr/model-a");
}

afterEach(() => {
  catalog.syncCustomProviders([], {});
});

describe("custom provider headers", () => {
  it("sends configured headers on requests", async () => {
    const model = registerCustomProvider({ "X-Custom": "abc", Authorization: "Bearer tok" });

    const requestHeaders = await captureRequestHeaders(model);

    expect(requestHeaders).toHaveLength(1);
    expect(requestHeaders[0].get("x-custom")).toBe("abc");
    expect(requestHeaders[0].get("authorization")).toBe("Bearer tok");
  });

  it("sends configured headers for keyless providers", async () => {
    const model = registerCustomProvider({ "X-Custom": "abc" }, true);

    const requestHeaders = await captureRequestHeaders(model);

    expect(requestHeaders).toHaveLength(1);
    expect(requestHeaders[0].get("x-custom")).toBe("abc");
  });

  it("lets a keyless provider override the placeholder auth via a custom Authorization header", async () => {
    const model = registerCustomProvider({ Authorization: "Bearer real-token" }, true);

    const requestHeaders = await captureRequestHeaders(model);

    expect(requestHeaders[0].get("authorization")).toBe("Bearer real-token");
  });

  it("still suppresses user-agent when not configured as a custom header", async () => {
    const model = registerCustomProvider({ "X-Custom": "abc" });

    const requestHeaders = await captureRequestHeaders(model);

    expect(requestHeaders[0].has("user-agent")).toBe(false);
  });

  it("lets an explicitly configured User-Agent header override suppression", async () => {
    const model = registerCustomProvider({ "User-Agent": "MyAgent/1.0" });

    const requestHeaders = await captureRequestHeaders(model);

    expect(requestHeaders[0].get("user-agent")).toBe("MyAgent/1.0");
  });

  it("reflects updated headers after re-syncing the same id", async () => {
    const model = registerCustomProvider({ "X-Custom": "old" });
    await captureRequestHeaders(model);

    registerCustomProvider({ "X-Custom": "new", "X-Extra": "1" });
    const modelAfter = catalog.resolveModelById("custom-hdr/model-a");

    const requestHeaders = await captureRequestHeaders(modelAfter);

    expect(requestHeaders[0].get("x-custom")).toBe("new");
    expect(requestHeaders[0].get("x-extra")).toBe("1");
  });

  it("drops headers after re-syncing without any", async () => {
    const model = registerCustomProvider({ "X-Custom": "abc" });
    await captureRequestHeaders(model);

    registerCustomProvider();
    const modelAfter = catalog.resolveModelById("custom-hdr/model-a");

    const requestHeaders = await captureRequestHeaders(modelAfter);

    expect(requestHeaders[0].has("x-custom")).toBe(false);
  });
});
