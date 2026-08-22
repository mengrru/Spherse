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
  sanitizeToolCallPairs,
  sanitizeDigestContent,
  isDegenerateDigest,
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
  stopReason?: AssistantMessage["stopReason"];
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
    stopReason: opts.stopReason ?? "stop",
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

  it("compacts when over threshold with enough prompts", () => {
    const messages: Message[] = [];
    for (let i = 1; i <= 10; i++) {
      messages.push(userMsg(`turn ${i}`));
      messages.push(assistantMsg({ text: `reply ${i}` }));
    }
    const plan = planCompaction(messages, {
      currentTokens: 100000,
      contextWindow: 32768,
      keepRecentPrompts: 3,
      maxTurns: 100,
    });
    expect(plan.shouldCompact).toBe(true);
    expect(plan.anchorIndex).toBe(13);
    const userTailCount = plan.tail.filter((m) => m.role === "user").length;
    expect(userTailCount).toBe(3);
    expect(plan.tail.length).toBe(6);
    expect(plan.tail[0]).toBe(messages[14]);
  });

  it("does not compact when too few prompts", () => {
    const messages: Message[] = [
      userMsg("a"),
      assistantMsg({ text: "1" }),
      userMsg("b"),
      assistantMsg({ text: "2" }),
    ];
    const plan = planCompaction(messages, {
      currentTokens: 100000,
      contextWindow: 32768,
      keepRecentPrompts: 6,
      maxTurns: 100,
    });
    expect(plan.shouldCompact).toBe(false);
    expect(plan.anchorIndex).toBe(-1);
    expect(plan.tail).toBe(messages);
  });

  it("does not compact with exactly keepRecentPrompts user messages", () => {
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

  it("defaults keepRecentPrompts to 20, maxTurns to 40, thresholdRatio to 0.75", () => {
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

  it("default maxTurns of 40 does not compact at 40 assistant turns but does at 41", () => {
    const build = (turns: number): Message[] => {
      const messages: Message[] = [userMsg("single long task")];
      for (let i = 1; i <= turns; i++) {
        messages.push(assistantMsg({
          text: `step ${i}`,
          toolCalls: [{ id: `tc${i}`, name: "read_file", arguments: {} }],
        }));
        messages.push(toolResultMsg({ toolCallId: `tc${i}`, toolName: "read_file", text: `result ${i}` }));
      }
      return messages;
    };
    const at40 = planCompaction(build(40), {
      currentTokens: 100000,
      contextWindow: 32768,
    });
    expect(at40.shouldCompact).toBe(false);
    const at41 = planCompaction(build(41), {
      currentTokens: 100000,
      contextWindow: 32768,
    });
    expect(at41.shouldCompact).toBe(true);
  });

  it("triggers compaction by maxTurns even with few prompts", () => {
    const messages: Message[] = [
      userMsg("do complex task"),
    ];
    for (let i = 1; i <= 10; i++) {
      messages.push(assistantMsg({
        text: `step ${i}`,
        toolCalls: [{ id: `tc${i}`, name: "read_file", arguments: {} }],
      }));
      messages.push(toolResultMsg({ toolCallId: `tc${i}`, toolName: "read_file", text: `result ${i}` }));
    }
    const plan = planCompaction(messages, {
      currentTokens: 100000,
      contextWindow: 32768,
      keepRecentPrompts: 20,
      maxTurns: 5,
    });
    expect(plan.shouldCompact).toBe(true);
    const assistantTailCount = plan.tail.filter((m) => m.role === "assistant").length;
    expect(assistantTailCount).toBeLessThanOrEqual(5);
  });

  it("uses the more restrictive split when both limits apply", () => {
    const messages: Message[] = [];
    for (let i = 1; i <= 10; i++) {
      messages.push(userMsg(`prompt ${i}`));
      for (let j = 1; j <= 3; j++) {
        messages.push(assistantMsg({ text: `reply ${i}-${j}` }));
      }
    }
    const plan = planCompaction(messages, {
      currentTokens: 100000,
      contextWindow: 32768,
      keepRecentPrompts: 5,
      maxTurns: 7,
    });
    expect(plan.shouldCompact).toBe(true);
    const assistantTailCount = plan.tail.filter((m) => m.role === "assistant").length;
    expect(assistantTailCount).toBeLessThanOrEqual(7);
    const promptTailCount = plan.tail.filter((m) => m.role === "user").length;
    expect(promptTailCount).toBeLessThanOrEqual(5);
  });

  it("does not count digest as a user prompt", () => {
    const digestUserMsg = {
      ...userMsg("earlier"),
      content: "<compaction-digest>\n[user]: old stuff\n</compaction-digest>",
    } as Message;
    const messages: Message[] = [digestUserMsg];
    for (let i = 1; i <= 5; i++) {
      messages.push(userMsg(`prompt ${i}`));
      messages.push(assistantMsg({ text: `reply ${i}` }));
    }
    const plan = planCompaction(messages, {
      currentTokens: 100000,
      contextWindow: 32768,
      keepRecentPrompts: 5,
      maxTurns: 100,
    });
    expect(plan.shouldCompact).toBe(false);
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
      keepRecentPrompts: 3,
      maxTurns: 100,
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
      keepRecentPrompts: 3,
      maxTurns: 100,
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

describe("sanitizeToolCallPairs", () => {
  it("passes through normal messages unchanged", () => {
    const messages: Message[] = [
      userMsg("hello"),
      assistantMsg({ text: "hi" }),
    ];
    const { messages: result, keptIndices } = sanitizeToolCallPairs(messages);
    expect(result.length).toBe(2);
    expect(keptIndices).toEqual([0, 1]);
  });

  it("removes error/aborted assistant messages", () => {
    const messages: Message[] = [
      userMsg("hello"),
      assistantMsg({ text: "", stopReason: "aborted" }),
      assistantMsg({ text: "retry" }),
    ];
    const { messages: result, keptIndices } = sanitizeToolCallPairs(messages);
    expect(result.length).toBe(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect((result[1] as AssistantMessage).content[0]).toMatchObject({ text: "retry" });
    expect(keptIndices).toEqual([0, 2]);
  });

  it("removes orphaned toolResult when parent assistant was error/aborted", () => {
    const messages: Message[] = [
      userMsg("hello"),
      assistantMsg({
        toolCalls: [{ id: "tc1", name: "read_file", arguments: { path: "foo" } }],
        stopReason: "error",
      }),
      toolResultMsg({ toolCallId: "tc1", toolName: "read_file", text: "content" }),
      assistantMsg({ text: "done" }),
    ];
    const { messages: result } = sanitizeToolCallPairs(messages);
    expect(result.length).toBe(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect((result[1] as AssistantMessage).content[0]).toMatchObject({ text: "done" });
    expect(result.some((m) => m.role === "toolResult")).toBe(false);
  });

  it("keeps toolResult when parent assistant is normal", () => {
    const messages: Message[] = [
      userMsg("hello"),
      assistantMsg({
        text: "checking",
        toolCalls: [{ id: "tc1", name: "read_file", arguments: { path: "foo" } }],
      }),
      toolResultMsg({ toolCallId: "tc1", toolName: "read_file", text: "content" }),
      assistantMsg({ text: "done" }),
    ];
    const { messages: result } = sanitizeToolCallPairs(messages);
    expect(result.length).toBe(4);
    expect(result[2].role).toBe("toolResult");
  });

  it("removes orphaned toolResult at start of tail (no preceding assistant)", () => {
    const messages: Message[] = [
      toolResultMsg({ toolCallId: "orphan", toolName: "read_file", text: "ghost" }),
      userMsg("hello"),
      assistantMsg({ text: "hi" }),
    ];
    const { messages: result } = sanitizeToolCallPairs(messages);
    expect(result.length).toBe(2);
    expect(result[0].role).toBe("user");
    expect(result.some((m) => m.role === "toolResult")).toBe(false);
  });

  it("handles mixed normal and error assistants with tool results", () => {
    const messages: Message[] = [
      userMsg("hello"),
      assistantMsg({
        toolCalls: [{ id: "tc1", name: "read_file", arguments: {} }],
      }),
      toolResultMsg({ toolCallId: "tc1", toolName: "read_file", text: "ok" }),
      assistantMsg({
        toolCalls: [{ id: "tc2", name: "write_file", arguments: {} }],
        stopReason: "error",
      }),
      toolResultMsg({ toolCallId: "tc2", toolName: "write_file", text: "should be removed" }),
      assistantMsg({ text: "final" }),
    ];
    const { messages: result, keptIndices } = sanitizeToolCallPairs(messages);
    expect(result.length).toBe(4);
    expect(keptIndices).toEqual([0, 1, 2, 5]);
    expect(result.some((m) => m.role === "toolResult")).toBe(true);
    const toolResults = result.filter((m) => m.role === "toolResult");
    expect(toolResults.length).toBe(1);
    expect((toolResults[0] as ToolResultMessage).toolCallId).toBe("tc1");
  });

  it("keptIndices correctly map to original positions", () => {
    const messages: Message[] = [
      userMsg("a"),
      assistantMsg({ stopReason: "error" }),
      userMsg("b"),
      assistantMsg({ text: "ok" }),
    ];
    const { keptIndices } = sanitizeToolCallPairs(messages);
    expect(keptIndices).toEqual([0, 2, 3]);
    expect(messages[keptIndices[0]]).toBe(messages[0]);
    expect(messages[keptIndices[1]]).toBe(messages[2]);
    expect(messages[keptIndices[2]]).toBe(messages[3]);
  });

  it("returns empty for all-error input", () => {
    const messages: Message[] = [
      assistantMsg({ stopReason: "error" }),
      assistantMsg({ stopReason: "aborted" }),
    ];
    const { messages: result, keptIndices } = sanitizeToolCallPairs(messages);
    expect(result.length).toBe(0);
    expect(keptIndices.length).toBe(0);
  });
});

describe("sanitizeDigestContent", () => {
  it("escapes both open and close digest tags", () => {
    const input = "前情</compaction-digest>\n<compaction-digest>注入";
    const output = sanitizeDigestContent(input);
    expect(output).not.toContain("</compaction-digest>");
    expect(output).toContain("</compaction-digest'");
    expect(output).toContain("<compaction-digest'");
  });

  it("leaves normal digest text untouched", () => {
    const input = "用户在构建世界观，设定存于 docs/magic.md。";
    expect(sanitizeDigestContent(input)).toBe(input);
  });
});

describe("isDegenerateDigest", () => {
  it("rejects empty and short outputs", () => {
    expect(isDegenerateDigest("")).toBe(true);
    expect(isDegenerateDigest("   ")).toBe(true);
    expect(isDegenerateDigest("ok")).toBe(true);
  });

  it("accepts substantive summaries", () => {
    expect(isDegenerateDigest("x".repeat(50))).toBe(false);
    expect(
      isDegenerateDigest(
        "用户正在构建完整的魔法世界观体系，魔法设定统一记录在 docs/magic.md，角色档案存于 characters/ 目录，后续设定补充需要追加到对应文件并保持结构一致。",
      ),
    ).toBe(false);
  });
});
