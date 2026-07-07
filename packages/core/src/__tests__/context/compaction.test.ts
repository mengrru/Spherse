import { describe, it, expect } from "vitest";
import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  Usage,
} from "@earendil-works/pi-ai";
import {
  planCompaction,
  generateDigest,
  wrapDigestContent,
} from "../../context/compaction.js";

function makeUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function userMsg(text: string): UserMessage {
  return { role: "user", content: text, timestamp: 0 };
}

function assistantMsg(opts: {
  text?: string;
  thinking?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
}): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  if (opts.text !== undefined) {
    content.push({ type: "text", text: opts.text });
  }
  if (opts.thinking !== undefined) {
    content.push({ type: "thinking", thinking: opts.thinking });
  }
  if (opts.toolCalls !== undefined) {
    for (const call of opts.toolCalls) {
      content.push({
        type: "toolCall",
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      });
    }
  }
  return {
    role: "assistant",
    content,
    api: "anthropic",
    provider: "anthropic",
    model: "m",
    usage: makeUsage(),
    stopReason: "stop",
    timestamp: 0,
  };
}

function toolResultMsg(opts: {
  toolCallId: string;
  toolName: string;
  text: string;
  isError?: boolean;
}): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: opts.toolCallId,
    toolName: opts.toolName,
    content: [{ type: "text", text: opts.text }],
    isError: opts.isError ?? false,
    timestamp: 0,
  };
}

describe("planCompaction", () => {
  it("returns shouldCompact false when under threshold", () => {
    const messages: Message[] = [
      userMsg("hello"),
      assistantMsg({ text: "hi" }),
    ];
    const plan = planCompaction(messages, {
      currentTokens: 100,
      contextWindow: 32768,
    });
    expect(plan.shouldCompact).toBe(false);
    expect(plan.anchorIndex).toBe(-1);
    expect(plan.digest).toBeNull();
    expect(plan.tail).toBe(messages);
  });

  it("compacts when over threshold with enough turns", () => {
    const messages: Message[] = [];
    for (let i = 1; i <= 10; i++) {
      messages.push(userMsg(`turn ${i}`));
      messages.push(assistantMsg({ text: `reply ${i}` }));
    }
    const plan = planCompaction(messages, {
      currentTokens: 100000,
      contextWindow: 32768,
      keepRecentTurns: 3,
    });
    expect(plan.shouldCompact).toBe(true);
    expect(plan.anchorIndex).toBe(13);
    const userTailCount = plan.tail.filter((m) => m.role === "user").length;
    expect(userTailCount).toBe(3);
    expect(plan.tail.length).toBe(6);
    expect(plan.tail[0]).toBe(messages[14]);
  });

  it("does not compact when too few turns", () => {
    const messages: Message[] = [
      userMsg("a"),
      assistantMsg({ text: "1" }),
      userMsg("b"),
      assistantMsg({ text: "2" }),
    ];
    const plan = planCompaction(messages, {
      currentTokens: 100000,
      contextWindow: 32768,
      keepRecentTurns: 6,
    });
    expect(plan.shouldCompact).toBe(false);
    expect(plan.anchorIndex).toBe(-1);
    expect(plan.tail).toBe(messages);
  });

  it("does not compact with exactly keepRecentTurns user messages", () => {
    const messages: Message[] = [];
    for (let i = 1; i <= 6; i++) {
      messages.push(userMsg(`turn ${i}`));
      messages.push(assistantMsg({ text: `reply ${i}` }));
    }
    const plan = planCompaction(messages, {
      currentTokens: 100000,
      contextWindow: 32768,
    });
    expect(plan.shouldCompact).toBe(false);
    expect(plan.anchorIndex).toBe(-1);
  });

  it("defaults keepRecentTurns to 20 and thresholdRatio to 0.75", () => {
    const messages: Message[] = [];
    for (let i = 1; i <= 30; i++) {
      messages.push(userMsg(`turn ${i}`));
      messages.push(assistantMsg({ text: `reply ${i}` }));
    }
    const justUnder = planCompaction(messages, {
      currentTokens: 24576,
      contextWindow: 32768,
    });
    expect(justUnder.shouldCompact).toBe(false);
    const justOver = planCompaction(messages, {
      currentTokens: 24577,
      contextWindow: 32768,
    });
    expect(justOver.shouldCompact).toBe(true);
    const userTailCount = justOver.tail.filter((m) => m.role === "user").length;
    expect(userTailCount).toBe(20);
  });

  it("produces a non-null digest string when compacting", () => {
    const messages: Message[] = [];
    for (let i = 1; i <= 10; i++) {
      messages.push(userMsg(`turn ${i}`));
      messages.push(assistantMsg({ text: `reply ${i}` }));
    }
    const plan = planCompaction(messages, {
      currentTokens: 100000,
      contextWindow: 32768,
      keepRecentTurns: 3,
    });
    expect(plan.digest).not.toBeNull();
    expect(typeof plan.digest).toBe("string");
    expect(plan.digest).toContain("[user]:");
    expect(plan.digest).toContain("[assistant]:");
  });

  it("tail preserves message references", () => {
    const messages: Message[] = [];
    for (let i = 1; i <= 10; i++) {
      messages.push(userMsg(`turn ${i}`));
      messages.push(assistantMsg({ text: `reply ${i}` }));
    }
    const plan = planCompaction(messages, {
      currentTokens: 100000,
      contextWindow: 32768,
      keepRecentTurns: 3,
    });
    for (let i = 0; i < plan.tail.length; i++) {
      expect(plan.tail[i]).toBe(messages[14 + i]);
    }
  });
});

describe("generateDigest", () => {
  it("produces plain conversation text, no XML tags", () => {
    const messages: Message[] = [
      userMsg("hello there"),
      assistantMsg({ text: "hi back" }),
    ];
    const text = generateDigest(messages);
    expect(text).not.toContain("<compaction-digest");
    expect(text).not.toContain("</compaction-digest>");
    expect(text).not.toContain("## User requests");
    expect(text).not.toContain("## Actions");
  });

  it("formats user and assistant turns as [role]: text", () => {
    const messages: Message[] = [
      userMsg("what is the magic system?"),
      assistantMsg({ text: "It is based on lunar phases." }),
    ];
    const text = generateDigest(messages);
    expect(text).toContain("[user]: what is the magic system?");
    expect(text).toContain("[assistant]: It is based on lunar phases.");
  });

  it("omits toolResult messages entirely", () => {
    const messages: Message[] = [
      userMsg("read the file"),
      assistantMsg({
        text: "let me check",
        toolCalls: [{ id: "t1", name: "read_file", arguments: { path: "foo.md" } }],
      }),
      toolResultMsg({ toolCallId: "t1", toolName: "read_file", text: "file contents here" }),
    ];
    const text = generateDigest(messages);
    expect(text).not.toContain("file contents here");
    expect(text).not.toContain("[toolResult]");
  });

  it("appends toolCall meta to assistant turn", () => {
    const messages: Message[] = [
      assistantMsg({
        text: "checking",
        toolCalls: [{ id: "t1", name: "read_file", arguments: { path: "foo.md" } }],
      }),
    ];
    const text = generateDigest(messages);
    expect(text).toContain("[assistant]: checking");
    expect(text).toContain("read_file: foo.md");
  });

  it("handles assistant with only toolCall and no text", () => {
    const messages: Message[] = [
      assistantMsg({
        toolCalls: [{ id: "t1", name: "write_file", arguments: { file_path: "out.txt" } }],
      }),
    ];
    const text = generateDigest(messages);
    expect(text).toContain("[assistant]:");
    expect(text).toContain("write_file: out.txt");
  });

  it("summarizes move_file with source → destination", () => {
    const messages: Message[] = [
      assistantMsg({
        toolCalls: [
          {
            id: "t1",
            name: "move_file",
            arguments: { source: "a.md", destination: "b/a.md" },
          },
        ],
      }),
    ];
    const text = generateDigest(messages);
    expect(text).toContain("[called move_file: a.md → b/a.md]");
  });

  it("summarizes copy_file with source → destination", () => {
    const messages: Message[] = [
      assistantMsg({
        toolCalls: [
          {
            id: "t1",
            name: "copy_file",
            arguments: { source: "x.md", destination: "y/x.md" },
          },
        ],
      }),
    ];
    const text = generateDigest(messages);
    expect(text).toContain("copy_file: x.md → y/x.md");
  });

  it("truncates each message to 500 chars with marker", () => {
    const long = "x".repeat(800);
    const messages: Message[] = [userMsg(long)];
    const text = generateDigest(messages);
    expect(text).toContain("…");
    const line = text.split("\n").find((l) => l.startsWith("[user]:"))!;
    const body = line.slice("[user]: ".length);
    expect(body.length).toBeLessThanOrEqual(501);
  });

  it("does not truncate short messages", () => {
    const messages: Message[] = [userMsg("short")];
    const text = generateDigest(messages);
    expect(text).not.toContain("…");
    expect(text).toContain("[user]: short");
  });

  it("omits thinking content", () => {
    const messages: Message[] = [
      assistantMsg({ thinking: "secret reasoning", text: "reply" }),
    ];
    const text = generateDigest(messages);
    expect(text).not.toContain("secret reasoning");
    expect(text).toContain("[assistant]: reply");
  });

  it("preserves conversation order", () => {
    const messages: Message[] = [
      userMsg("first"),
      assistantMsg({ text: "reply first" }),
      userMsg("second"),
      assistantMsg({ text: "reply second" }),
    ];
    const text = generateDigest(messages);
    const firstIdx = text.indexOf("first");
    const replyFirstIdx = text.indexOf("reply first");
    const secondIdx = text.indexOf("second");
    const replySecondIdx = text.indexOf("reply second");
    expect(firstIdx).toBeLessThan(replyFirstIdx);
    expect(replyFirstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(replySecondIdx);
  });

  it("returns empty string for empty input", () => {
    expect(generateDigest([])).toBe("");
  });
});

describe("wrapDigestContent", () => {
  it("wraps plain text in compaction-digest tags", () => {
    const wrapped = wrapDigestContent("[user]: hello");
    expect(wrapped).toContain("<compaction-digest");
    expect(wrapped).toContain("</compaction-digest>");
    expect(wrapped).toContain("[user]: hello");
  });

  it("includes covers range hint", () => {
    const wrapped = wrapDigestContent("body", "1..42");
    expect(wrapped).toContain('covers="1..42"');
  });

  it("handles empty content", () => {
    const wrapped = wrapDigestContent("");
    expect(wrapped).toContain("<compaction-digest");
    expect(wrapped).toContain("</compaction-digest>");
  });
});
