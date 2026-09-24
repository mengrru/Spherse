import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildWebSearchRequest,
  createWebSearchTool,
  formatWebSearchResult,
  parseWebSearchResponse,
  readDeepSeekApiKey,
} from "../../tools/web-search.js";

const FIXTURE = {
  id: "msg-1",
  type: "message",
  role: "assistant",
  content: [
    { type: "text", text: "I'll search for that." },
    {
      type: "server_tool_use",
      id: "call_00",
      name: "web_search",
      input: { query: "latest Node.js LTS version" },
    },
    {
      type: "web_search_tool_result",
      tool_use_id: "call_00",
      content: [
        {
          type: "web_search_result",
          title: "Node.js 22.23.3 (LTS)",
          url: "https://nodejs.org/en/blog/release/v22.23.3",
          encrypted_content: "xxx",
          page_age: null,
        },
        {
          type: "web_search_result",
          title: "Duplicate",
          url: "https://nodejs.org/en/blog/release/v22.23.3",
          encrypted_content: "yyy",
          page_age: null,
        },
        {
          type: "web_search_result",
          title: "Node.js Release Working Group",
          url: "https://github.com/nodejs/release",
          encrypted_content: "zzz",
          page_age: null,
        },
      ],
    },
    { type: "thinking", thinking: "summarize", signature: "s" },
    { type: "text", text: "The latest LTS is Node.js 24." },
  ],
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 1 } },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("parseWebSearchResponse", () => {
  it("extracts summary, queries, deduped sources and search count", () => {
    const result = parseWebSearchResponse(FIXTURE);
    expect(result.summary).toBe("I'll search for that.\n\nThe latest LTS is Node.js 24.");
    expect(result.queries).toEqual(["latest Node.js LTS version"]);
    expect(result.sources).toEqual([
      { title: "Node.js 22.23.3 (LTS)", url: "https://nodejs.org/en/blog/release/v22.23.3" },
      { title: "Node.js Release Working Group", url: "https://github.com/nodejs/release" },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.searchCount).toBe(1);
  });

  it("collects error result blocks", () => {
    const result = parseWebSearchResponse({
      content: [
        {
          type: "web_search_tool_result",
          tool_use_id: "c",
          content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
        },
      ],
    });
    expect(result.errors).toEqual(["max_uses_exceeded"]);
    expect(result.sources).toEqual([]);
  });

  it("tolerates malformed bodies", () => {
    expect(parseWebSearchResponse(null).summary).toBe("");
    expect(parseWebSearchResponse({ content: "nope" }).sources).toEqual([]);
  });
});

describe("formatWebSearchResult", () => {
  it("appends a markdown source list", () => {
    const text = formatWebSearchResult(parseWebSearchResponse(FIXTURE));
    expect(text).toContain("The latest LTS is Node.js 24.");
    expect(text).toContain("Sources:\n- [Node.js 22.23.3 (LTS)](https://nodejs.org/en/blog/release/v22.23.3)");
  });
});

describe("buildWebSearchRequest", () => {
  it("uses the server web_search tool with thinking disabled and the local date", () => {
    const body = buildWebSearchRequest("hello world", new Date(2026, 8, 24, 3, 0, 0));
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]);
    expect(body.system).toContain("2026-09-24");
    expect(body.messages[0].content).toContain("hello world");
  });
});

describe("readDeepSeekApiKey", () => {
  afterEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("reads DEEPSEEK_API_KEY and ignores blank values", () => {
    process.env.DEEPSEEK_API_KEY = "  ";
    expect(readDeepSeekApiKey()).toBeUndefined();
    process.env.DEEPSEEK_API_KEY = "sk-abc";
    expect(readDeepSeekApiKey()).toBe("sk-abc");
  });
});

describe("createWebSearchTool", () => {
  const KEY = "sk-secret-123";

  it("posts to the DeepSeek anthropic endpoint and returns summary + sources", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(FIXTURE));
    const tool = createWebSearchTool({ fetch: fetchMock as unknown as typeof fetch, getApiKey: () => KEY });
    const result = await tool.execute("tc1", { query: "node lts" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/anthropic/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(init.body as string).messages[0].content).toContain("node lts");

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("The latest LTS is Node.js 24.");
    expect(text).toContain("https://github.com/nodejs/release");
    expect(result.details).toMatchObject({ query: "node lts", searchCount: 1 });
  });

  it("throws when no API key is configured", async () => {
    const fetchMock = vi.fn();
    const tool = createWebSearchTool({ fetch: fetchMock as unknown as typeof fetch, getApiKey: () => undefined });
    await expect(tool.execute("tc1", { query: "x y" })).rejects.toThrow(/DeepSeek API Key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports HTTP errors without leaking the key", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: `Authentication Fails, your api key: ${KEY} is invalid` } }, 401),
    );
    const tool = createWebSearchTool({ fetch: fetchMock as unknown as typeof fetch, getApiKey: () => KEY });
    const error = await tool.execute("tc1", { query: "x y" }).catch((err: Error) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("HTTP 401");
    expect((error as Error).message).toContain("Authentication Fails");
    expect((error as Error).message).not.toContain(KEY);
  });

  it("throws when the response carries no results", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        content: [
          { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "unavailable" } },
        ],
      }),
    );
    const tool = createWebSearchTool({ fetch: fetchMock as unknown as typeof fetch, getApiKey: () => KEY });
    await expect(tool.execute("tc1", { query: "x y" })).rejects.toThrow(/no results: unavailable/);
  });

  it("distinguishes user abort from timeout", async () => {
    const hanging = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });

    const controller = new AbortController();
    const aborted = createWebSearchTool({ fetch: hanging as unknown as typeof fetch, getApiKey: () => KEY });
    const pending = aborted.execute("tc1", { query: "x y" }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);

    const timed = createWebSearchTool({
      fetch: hanging as unknown as typeof fetch,
      getApiKey: () => KEY,
      timeoutMs: 10,
    });
    await expect(timed.execute("tc1", { query: "x y" })).rejects.toThrow(/timed out/);
  });
});
