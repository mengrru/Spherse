import { describe, it, expect } from "vitest";
import type { Message } from "@earendil-works/pi-ai";
import { estimateTokens } from "../../context/token-estimate.js";

describe("estimateTokens (string mode)", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates pure ASCII text reasonably", () => {
    const text = "hello world";
    const result = estimateTokens(text);
    expect(result).toBe(Math.ceil(11 / 4));
    expect(result).toBe(3);
  });

  it("estimates pure CJK text reasonably", () => {
    const text = "你好世界";
    const result = estimateTokens(text);
    expect(result).toBe(Math.ceil(4 / 1.5));
    expect(result).toBe(3);
  });

  it("estimates mixed CJK + ASCII with weighted sum", () => {
    const cjk = "你好"; // 2 cjk
    const ascii = "ab"; // 2 other
    const expected = Math.ceil(2 / 1.5 + 2 / 4);
    expect(estimateTokens(cjk + ascii)).toBe(expected);
  });

  it("is monotonic: longer text yields larger or equal estimate", () => {
    const short = "abc";
    const long = "abcdefghijklmnopqrstuvwxyz";
    expect(estimateTokens(long)).toBeGreaterThanOrEqual(estimateTokens(short));
  });

  it("is monotonic across CJK additions", () => {
    const a = "你";
    const b = "你好世界你好世界你好世界";
    expect(estimateTokens(b)).toBeGreaterThanOrEqual(estimateTokens(a));
  });
});

describe("estimateTokens (Message[] mode)", () => {
  it("returns 0 for empty array", () => {
    expect(estimateTokens([])).toBe(0);
  });

  it("matches string estimate for user message with string content", () => {
    const text = "hello world";
    const messages: Message[] = [
      { role: "user", content: text, timestamp: 0 },
    ];
    expect(estimateTokens(messages)).toBe(estimateTokens(text));
  });

  it("extracts text from assistant message content array (text block)", () => {
    const text = "assistant reply";
    const messages: Message[] = [
      {
        role: "assistant",
        content: [{ type: "text", text }],
        api: "anthropic",
        provider: "anthropic",
        model: "m",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 0,
      },
    ];
    expect(estimateTokens(messages)).toBe(estimateTokens(text));
  });

  it("extracts text from toolResult message content array (text block)", () => {
    const text = "tool result content";
    const messages: Message[] = [
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "read",
        content: [{ type: "text", text }],
        isError: false,
        timestamp: 0,
      },
    ];
    expect(estimateTokens(messages)).toBe(estimateTokens(text));
  });

  it("sums tokens across multiple messages", () => {
    const a = "hello world";
    const b = "你好世界";
    const messages: Message[] = [
      { role: "user", content: a, timestamp: 0 },
      { role: "user", content: b, timestamp: 0 },
    ];
    expect(estimateTokens(messages)).toBe(estimateTokens(a + b));
  });

  it("handles thinking blocks", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "reasoning here" }],
        api: "anthropic",
        provider: "anthropic",
        model: "m",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 0,
      },
    ];
    expect(estimateTokens(messages)).toBe(estimateTokens("reasoning here"));
  });

  it("handles toolCall blocks by stringifying arguments", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "t1",
            name: "read",
            arguments: { path: "/a" },
          },
        ],
        api: "anthropic",
        provider: "anthropic",
        model: "m",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 0,
      },
    ];
    expect(estimateTokens(messages)).toBe(estimateTokens(JSON.stringify({ path: "/a" })));
  });

  it("ignores non-text blocks like images", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", data: "base64", mimeType: "image/png" },
        ],
        timestamp: 0,
      },
    ];
    expect(estimateTokens(messages)).toBe(estimateTokens("look"));
  });
});
