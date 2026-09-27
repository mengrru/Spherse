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

function thoughtBubbleOf(group: { bubbles: ReturnType<typeof assembleGroups>[number]["bubbles"] }) {
  const thought = group.bubbles.find((bubble) => bubble.kind === "thought");
  expect(thought).toBeDefined();
  return thought as Extract<typeof thought, { kind: "thought" }>;
}

describe("message groups", () => {
  it("collects tool calls from all entries into one thought bubble and merges results", () => {
    const groups = assembleGroups([
      user(),
      assistant({
        id: "a1",
        seq: 2,
        toolCalls: [
          { toolCallId: "tc1", toolName: "read_file", args: { path: "a" } },
          { toolCallId: "tc2", toolName: "search_content", args: { query: "x" } },
        ],
      }),
      toolResult({
        id: "e3",
        seq: 3,
        ownerId: "a1",
        toolCallId: "tc1",
        toolName: "read_file",
        result: "data",
        isError: false,
      }),
      assistant({ id: "a2", seq: 4, text: "done" }),
    ]);

    expect(groups).toHaveLength(1);
    const bubbles = groups[0].bubbles;
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0].kind).toBe("thought");
    expect(bubbles[1]).toMatchObject({ kind: "assistant", entryId: "a2", text: "done" });

    const thought = thoughtBubbleOf(groups[0]);
    expect(thought.tools).toHaveLength(2);
    expect(thought.tools[0]).toMatchObject({
      toolCallId: "tc1",
      toolName: "read_file",
      status: "completed",
      result: "data",
    });
    expect(thought.tools[1]).toMatchObject({ toolCallId: "tc2", status: "completed" });
    expect(thought.awaiting).toBeUndefined();
  });

  it("keeps live tool calls running and merges streamed cards", () => {
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
    const thought = thoughtBubbleOf(groups[0]);
    expect(thought.tools).toHaveLength(1);
    expect(thought.tools[0].status).toBe("running");
    const cards = groups[0].bubbles.find((bubble) => bubble.kind === "cards");
    expect(cards).toMatchObject({ kind: "cards", entryId: "a1" });
    if (!cards || cards.kind !== "cards") return;
    expect(cards.tools[0].status).toBe("running");
    expect(cards.tools[0].card).toMatchObject({ type: "command", status: "running" });
  });

  it("interleaves cards with text bubbles by their owning entry order", () => {
    const groups = assembleGroups([
      user(),
      assistant({
        id: "a1",
        text: "先看猫",
        toolCalls: [{ toolCallId: "tc1", toolName: "generate_image", args: { prompt: "猫" } }],
      }),
      toolResult({
        id: "e2",
        seq: 2,
        ownerId: "a1",
        toolCallId: "tc1",
        toolName: "generate_image",
        result: "ok",
        isError: false,
        details: { cardType: "image", status: "done", path: "cat.png", prompt: "猫", mimeType: "image/png" },
      }),
      assistant({ id: "a3", seq: 3, text: "再看这张" }),
      assistant({
        id: "a4",
        seq: 4,
        toolCalls: [{ toolCallId: "tc2", toolName: "generate_image", args: { prompt: "狗" } }],
      }),
      toolResult({
        id: "e5",
        seq: 5,
        ownerId: "a4",
        toolCallId: "tc2",
        toolName: "generate_image",
        result: "ok",
        isError: false,
        details: { cardType: "image", status: "done", path: "dog.png", prompt: "狗", mimeType: "image/png" },
      }),
    ]);
    const kinds = groups[0].bubbles.map((bubble) =>
      bubble.kind === "cards" ? `cards:${bubble.entryId}` : bubble.kind === "assistant" ? `text:${bubble.entryId}` : bubble.kind,
    );
    expect(kinds).toEqual(["thought", "text:a1", "cards:a1", "text:a3", "cards:a4"]);
    const thought = thoughtBubbleOf(groups[0]);
    expect(thought.tools.map((tool) => tool.toolCallId)).toEqual(["tc1", "tc2"]);
  });

  it("merges a result without ownerId via in-turn toolCallId fallback", () => {
    const groups = assembleGroups([
      user(),
      assistant({
        id: "a1",
        toolCalls: [{ toolCallId: "tc1", toolName: "read_file", args: { path: "a" } }],
      }),
      toolResult({ id: "tr1", toolCallId: "tc1", toolName: "read_file", result: "data", isError: false }),
    ]);
    const bubbles = groups[0].bubbles;
    expect(bubbles).toHaveLength(1);
    const thought = thoughtBubbleOf(groups[0]);
    expect(thought.tools[0]).toMatchObject({ toolCallId: "tc1", status: "completed", result: "data" });
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

  it("marks the thought bubble awaiting while a streaming entry has neither text nor tool calls", () => {
    const groups = assembleGroups([user(), assistant({ id: "a1", streaming: true })]);
    const thought = thoughtBubbleOf(groups[0]);
    expect(thought.awaiting).toBe(true);
    expect(thought.tools).toHaveLength(0);
    expect(groups[0].bubbles).toHaveLength(1);
  });

  it("anchors the thought bubble to the first assistant entry even when tools arrive later", () => {
    const groups = assembleGroups([
      user(),
      assistant({ id: "a1", text: "let me check" }),
      assistant({
        id: "a2",
        toolCalls: [{ toolCallId: "tc1", toolName: "read_file", args: { path: "a" } }],
      }),
    ]);
    const thought = thoughtBubbleOf(groups[0]);
    expect(thought.id).toBe("b:thought:a1");
    expect(thought.entryId).toBe("a1");
    expect(thought.tools).toHaveLength(1);
    const textBubbles = groups[0].bubbles.filter((bubble) => bubble.kind === "assistant");
    expect(textBubbles).toHaveLength(1);
    expect(textBubbles[0]).toMatchObject({ entryId: "a1", text: "let me check" });
  });

  it("keeps an empty-text errored assistant entry as a visible error bubble", () => {
    const groups = assembleGroups([
      user(),
      assistant({ id: "a1", error: { message: "boom" } }),
    ]);
    const bubbles = groups[0].bubbles;
    expect(bubbles).toHaveLength(2);
    expect(bubbles[1]).toMatchObject({ kind: "assistant", entryId: "a1", error: { message: "boom" } });
    expect(groups[0].hasError).toBe(true);
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
    expect(groups[1]).toMatchObject({ kind: "turn" });
  });

  it("creates a headless turn for assistant entries without a preceding user", () => {
    const groups = assembleGroups([assistant({ id: "a1", text: "triggered run" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].user).toBeUndefined();
    expect(groups[0].bubbles).toHaveLength(2);
    expect(groups[0].bubbles[0].kind).toBe("thought");
  });

  it("merges an error entry into a streaming assistant entry", () => {
    const error: ErrorEntry = { kind: "error", id: "x1", message: "boom" };
    const groups = assembleGroups([user(), assistant({ id: "a1", text: "partial", streaming: true }), error]);
    const bubbles = groups[0].bubbles;
    expect(bubbles).toHaveLength(2);
    expect(bubbles[1]).toMatchObject({
      kind: "assistant",
      entryId: "a1",
      text: "partial",
      error: { message: "boom" },
    });
    if (bubbles[1].kind !== "assistant") return;
    expect(bubbles[1].streaming).toBeUndefined();
    expect(groups[0].hasError).toBe(true);
  });

  it("surfaces an error bubble when an interrupted streaming entry has no text", () => {
    const error: ErrorEntry = { kind: "error", id: "x1", message: "boom" };
    const groups = assembleGroups([user(), assistant({ id: "a1", streaming: true }), error]);
    const bubbles = groups[0].bubbles;
    expect(bubbles).toHaveLength(2);
    expect(bubbles[1]).toMatchObject({
      kind: "assistant",
      entryId: "a1",
      text: "",
      error: { message: "boom" },
    });
    expect(groups[0].hasError).toBe(true);
  });

  it("appends a standalone error bubble when no assistant is streaming", () => {
    const error: ErrorEntry = { kind: "error", id: "x1", message: "boom", time: 7 };
    const groups = assembleGroups([user(), assistant({ id: "a1", text: "done" }), error]);
    const bubble = groups[0].bubbles.find((candidate) => candidate.kind === "error");
    expect(bubble).toMatchObject({
      kind: "error",
      entryId: "x1",
      error: { message: "boom" },
      timestamp: 7,
    });
  });

  it("attaches run changes to the last text bubble when one exists", () => {
    const groups = assembleGroups([
      user(),
      assistant({
        id: "a1",
        seq: 2,
        toolCalls: [{ toolCallId: "tc1", toolName: "write_file", args: { path: "a.ts" } }],
      }),
      toolResult({
        id: "e3",
        seq: 3,
        ownerId: "a1",
        toolCallId: "tc1",
        toolName: "write_file",
        result: "ok",
        isError: false,
      }),
      assistant({ id: "a4", seq: 4, text: "saved" }),
    ]);
    const thought = thoughtBubbleOf(groups[0]);
    expect(thought.runChanges).toBeUndefined();
    const last = groups[0].bubbles[groups[0].bubbles.length - 1];
    expect(last).toMatchObject({ kind: "assistant", entryId: "a4" });
    if (last.kind !== "assistant") return;
    expect(last.runChanges).toHaveLength(1);
  });

  it("attaches run changes to the thought bubble for a tool-only turn", () => {
    const groups = assembleGroups([
      user(),
      assistant({
        id: "a1",
        seq: 2,
        toolCalls: [{ toolCallId: "tc1", toolName: "edit_file", args: { path: "a.ts" } }],
      }),
      toolResult({
        id: "e3",
        seq: 3,
        ownerId: "a1",
        toolCallId: "tc1",
        toolName: "edit_file",
        result: "ok",
        isError: false,
      }),
    ]);
    const thought = thoughtBubbleOf(groups[0]);
    expect(thought.runChanges).toHaveLength(1);
  });

  it("reassembles cleanly after entries are removed (withdrawn turn)", () => {
    const entries: ChatEntry[] = [
      user({ id: "u1" }),
      assistant({ id: "a1", toolCalls: [{ toolCallId: "tc1", toolName: "read_file", args: {} }] }),
      user({ id: "u2" }),
      assistant({ id: "a2", text: "kept" }),
    ];
    const withdrawn = entries.filter((entry) => entry.id !== "u1" && entry.id !== "a1");
    const groups = assembleGroups(withdrawn);
    expect(groups).toHaveLength(1);
    expect(groups[0].user?.id).toBe("u2");
    const textBubbles = groups[0].bubbles.filter((bubble) => bubble.kind === "assistant");
    expect(textBubbles).toHaveLength(1);
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
          const text = random() < 0.5 ? `a${id}` : "";
          const error = text === "" && random() < 0.2 ? { message: `err-${id}` } : undefined;
          entries.push(assistant({ id, text, toolCalls, ...(error ? { error } : {}) }));
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
          const matching = bubbles.filter(
            (bubble) => bubble.kind === "assistant" && bubble.entryId === entry.id,
          );
          if (entry.text !== "" || entry.error) {
            expect(matching).toHaveLength(1);
          } else {
            expect(matching).toHaveLength(0);
          }
          continue;
        }
        if (entry.kind === "tool-result") {
          const orphan = bubbles.filter((bubble) => bubble.kind === "tool-result" && bubble.entryId === entry.id);
          const joined = bubbles.filter(
            (bubble) =>
              (bubble.kind === "thought" || bubble.kind === "cards") &&
              bubble.tools.some((tool) => tool.toolCallId === entry.toolCallId),
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
