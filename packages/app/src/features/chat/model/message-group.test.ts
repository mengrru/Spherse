import { describe, expect, it } from "vitest";
import { assembleGroups } from "./message-group";
import type { AssistantEntry, ChatEntry, ErrorEntry, ToolResultEntry, UserEntry } from "./entry";

function user(overrides: Partial<UserEntry> = {}): UserEntry {
  return { kind: "user", id: "u1", text: "hi", ...overrides };
}

function assistant(overrides: Partial<AssistantEntry> = {}): AssistantEntry {
  return { kind: "assistant", id: "a1", text: "", toolCalls: [], ...overrides };
}

function toolResult(overrides: Partial<ToolResultEntry> = {}): ToolResultEntry {
  return { kind: "tool-result", id: "tr1", toolCallId: "tc1", ...overrides };
}

describe("message groups", () => {
  it("joins a tool call and its result into one assistant bubble", () => {
    const groups = assembleGroups([
      user(),
      assistant({
        id: "a1",
        seq: 2,
        toolCalls: [{ toolCallId: "tc1", toolName: "read_file", args: { path: "a" } }],
      }),
      toolResult({
        id: "e3",
        seq: 3,
        ownerId: "a1",
        toolName: "read_file",
        result: "data",
        isError: false,
      }),
    ]);

    expect(groups).toHaveLength(1);
    const bubble = groups[0].bubbles[0];
    expect(bubble.kind).toBe("assistant");
    if (bubble.kind !== "assistant") return;
    expect(bubble.tools).toHaveLength(1);
    expect(bubble.tools[0]).toMatchObject({
      toolCallId: "tc1",
      toolName: "read_file",
      status: "completed",
      result: "data",
    });
  });

  it("keeps a tool running until a terminal result arrives", () => {
    const groups = assembleGroups([
      user(),
      assistant({
        id: "a1",
        toolCalls: [{ toolCallId: "tc1", toolName: "run_command", args: { command: "ls" } }],
      }),
      toolResult({
        id: "tr1",
        ownerId: "a1",
        toolCallId: "tc1",
        toolName: "run_command",
        partialResult: { details: { cardType: "command", command: "ls", stdout: "", status: "running" } },
      }),
    ]);
    const bubble = groups[0].bubbles[0];
    expect(bubble.kind).toBe("assistant");
    if (bubble.kind !== "assistant") return;
    expect(bubble.tools[0].status).toBe("running");
    expect(bubble.tools[0].card).toMatchObject({ type: "command", status: "running" });
  });

  it("keeps an unowned tool result as its own bubble instead of dropping it", () => {
    const groups = assembleGroups([
      user(),
      toolResult({ id: "e9", seq: 9, toolCallId: "tc9", toolName: "read_file", result: "data" }),
    ]);
    const bubble = groups[0].bubbles[0];
    expect(bubble.kind).toBe("tool-result");
    if (bubble.kind !== "tool-result") return;
    expect(bubble.tool).toMatchObject({ toolCallId: "tc9", status: "completed" });
  });

  it("wraps trigger turns until the next user entry", () => {
    const groups = assembleGroups([
      user({ id: "u1", triggered: true, triggerName: "cron" }),
      assistant({ id: "a1", text: "one" }),
      assistant({ id: "a2", text: "two" }),
      user({ id: "u2", text: "manual" }),
      assistant({ id: "a3", text: "three" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ kind: "trigger-turn", triggerName: "cron" });
    expect(groups[0].bubbles).toHaveLength(2);
    expect(groups[1]).toMatchObject({ kind: "turn" });
    expect(groups[1].bubbles).toHaveLength(1);
  });

  it("creates a headless turn for assistant entries without a preceding user", () => {
    const groups = assembleGroups([assistant({ id: "a1", text: "triggered run" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].user).toBeUndefined();
    expect(groups[0].bubbles).toHaveLength(1);
  });

  it("merges an error entry into a streaming assistant bubble", () => {
    const error: ErrorEntry = { kind: "error", id: "x1", message: "boom" };
    const groups = assembleGroups([user(), assistant({ id: "a1", streaming: true }), error]);
    const bubble = groups[0].bubbles[0];
    expect(bubble.kind).toBe("assistant");
    if (bubble.kind !== "assistant") return;
    expect(bubble.streaming).toBe(false);
    expect(bubble.error).toEqual({ message: "boom" });
    expect(groups[0].hasError).toBe(true);
  });

  it("appends a standalone error bubble when no assistant is streaming", () => {
    const error: ErrorEntry = { kind: "error", id: "x1", message: "boom", time: 7 };
    const groups = assembleGroups([user(), assistant({ id: "a1", text: "done" }), error]);
    const bubble = groups[0].bubbles[1];
    expect(bubble).toMatchObject({
      kind: "error",
      entryId: "x1",
      error: { message: "boom" },
      timestamp: 7,
    });
  });

  it("consumes every entry exactly once across randomized sequences", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let iteration = 0; iteration < 200; iteration++) {
      const entries: ChatEntry[] = [];
      let counter = 0;
      const turns = Math.floor(random() * 4) + 1;
      for (let turn = 0; turn < turns; turn++) {
        if (random() < 0.8) {
          entries.push(user({
            id: `u${counter}`,
            text: `q${counter}`,
            ...(random() < 0.3 ? { triggered: true as const, triggerName: "cron" } : {}),
            ...(random() < 0.2 ? { optimistic: true } : {}),
          }));
          counter += 1;
        }
        const assistantCount = Math.floor(random() * 2) + 1;
        for (let index = 0; index < assistantCount; index++) {
          const id = `a${counter}`;
          counter += 1;
          const toolCalls = Array.from({ length: Math.floor(random() * 2) }, (_, toolIndex) => ({
            toolCallId: `t${id}-${toolIndex}`,
            toolName: "read_file",
            args: { path: `p${toolIndex}` },
          }));
          entries.push(assistant({ id, text: `a${id}`, toolCalls }));
          for (const call of toolCalls) {
            if (random() < 0.8) {
              entries.push(toolResult({
                id: `tr${counter}`,
                toolCallId: call.toolCallId,
                ownerId: id,
                toolName: call.toolName,
                args: call.args,
                result: "ok",
                isError: random() < 0.2,
              }));
              counter += 1;
            }
          }
        }
        if (random() < 0.3) {
          entries.push({ kind: "error", id: `x${counter}`, message: `err${counter}` });
          counter += 1;
        }
      }

      const groups = assembleGroups(entries);
      const bubbles = groups.flatMap((group) => group.bubbles);
      for (const entry of entries) {
        if (entry.kind === "user") {
          expect(groups.filter((group) => group.user?.id === entry.id)).toHaveLength(1);
          continue;
        }
        if (entry.kind === "assistant") {
          expect(bubbles.filter((bubble) => bubble.kind === "assistant" && bubble.entryId === entry.id)).toHaveLength(1);
          continue;
        }
        if (entry.kind === "tool-result") {
          const orphan = bubbles.filter((bubble) => bubble.kind === "tool-result" && bubble.entryId === entry.id);
          const joined = bubbles.filter(
            (bubble) => bubble.kind === "assistant" && bubble.tools.some((tool) => tool.toolCallId === entry.toolCallId),
          );
          expect(orphan.length + joined.length).toBeGreaterThan(0);
          expect(joined.length).toBeLessThanOrEqual(1);
          continue;
        }
        const standalone = bubbles.filter((bubble) => bubble.kind === "error" && bubble.entryId === entry.id);
        const merged = bubbles.filter(
          (bubble) => bubble.kind === "assistant" && bubble.error?.message === entry.message,
        );
        expect(standalone.length + merged.length).toBeGreaterThan(0);
      }
    }
  });
});
