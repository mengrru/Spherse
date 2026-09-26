import { describe, it, expect } from "vitest";
import {
  buildSnippet,
  escapeLikePattern,
  extractSearchableText,
  matchMessageData,
} from "../session/search.js";

describe("extractSearchableText", () => {
  it("returns string content as-is", () => {
    expect(extractSearchableText("hello")).toBe("hello");
  });

  it("joins text blocks from block arrays", () => {
    const content = [
      { type: "text", text: "first" },
      { type: "image", url: "x" },
      { type: "text", text: "second" },
    ];
    expect(extractSearchableText(content)).toBe("first\nsecond");
  });

  it("returns empty for unknown shapes", () => {
    expect(extractSearchableText(undefined)).toBe("");
    expect(extractSearchableText(null)).toBe("");
    expect(extractSearchableText(42)).toBe("");
    expect(extractSearchableText([{ type: "image", url: "x" }])).toBe("");
  });
});

describe("escapeLikePattern", () => {
  it("escapes LIKE wildcards and the escape char", () => {
    expect(escapeLikePattern("100%_\\")).toBe("100\\%\\_\\\\");
  });
});

describe("buildSnippet", () => {
  it("keeps text around the match and collapses whitespace", () => {
    const text = "a".repeat(50) + "  needle  " + "b".repeat(200);
    const index = text.toLowerCase().indexOf("needle");
    const snippet = buildSnippet(text, index, "needle".length);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("needle");
    expect(snippet).not.toContain("  ");
  });

  it("omits ellipses when match covers the whole text", () => {
    expect(buildSnippet("needle", 0, 6)).toBe("needle");
  });
});

describe("matchMessageData", () => {
  const userJson = JSON.stringify({
    message: { role: "user", content: "hello world", timestamp: 1 },
  });
  const assistantJson = JSON.stringify({
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "the answer is 42" },
        { type: "toolCall", id: "t1", name: "n", arguments: {} },
      ],
      stopReason: "stop",
    },
  });

  it("matches user message with string content case-insensitively", () => {
    expect(matchMessageData("WORLD", userJson)).toEqual({
      role: "user",
      snippet: "hello world",
    });
  });

  it("matches assistant text blocks only", () => {
    expect(matchMessageData("answer", assistantJson)).toEqual({
      role: "assistant",
      snippet: "the answer is 42",
    });
    expect(matchMessageData("toolCall", assistantJson)).toBeNull();
  });

  it("rejects empty query, invalid JSON and non-user/assistant roles", () => {
    expect(matchMessageData("", userJson)).toBeNull();
    expect(matchMessageData("x", "{broken")).toBeNull();
    const toolJson = JSON.stringify({
      message: { role: "toolResult", content: "hello world" },
    });
    expect(matchMessageData("hello", toolJson)).toBeNull();
  });

  it("does not match JSON structural text outside the message", () => {
    expect(matchMessageData("timestamp", userJson)).toBeNull();
    expect(matchMessageData("role", userJson)).toBeNull();
  });
});
