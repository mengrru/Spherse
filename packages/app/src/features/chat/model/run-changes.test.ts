import { describe, expect, it } from "vitest";
import { assembleGroups } from "./message-group";
import type { AssistantEntry, ToolResultEntry, UserEntry } from "./entry";

function user(overrides: Partial<UserEntry> = {}): UserEntry {
  return { kind: "user", id: "u1", text: "hi", ...overrides };
}

function assistant(overrides: Partial<AssistantEntry> = {}): AssistantEntry {
  return { kind: "assistant", id: "a1", text: "", toolCalls: [], ...overrides };
}

function toolResult(overrides: Partial<ToolResultEntry> = {}): ToolResultEntry {
  return { kind: "tool-result", id: "tr1", toolCallId: "tc1", ...overrides };
}

describe("run changes", () => {
  it("aggregates file operations by path on the last assistant bubble", () => {
    const groups = assembleGroups([
      user(),
      assistant({
        id: "a1",
        toolCalls: [
          { toolCallId: "tc1", toolName: "write_file", args: { path: "a.ts" } },
          { toolCallId: "tc2", toolName: "edit_file", args: { path: "a.ts" } },
        ],
      }),
      toolResult({ id: "e1", ownerId: "a1", toolCallId: "tc1", toolName: "write_file", args: { path: "a.ts" }, result: "ok", isError: false }),
      toolResult({ id: "e2", ownerId: "a1", toolCallId: "tc2", toolName: "edit_file", args: { path: "a.ts" }, result: "ok", isError: false }),
      assistant({
        id: "a2",
        toolCalls: [{ toolCallId: "tc3", toolName: "write_file", args: { path: "b.ts" } }],
      }),
      toolResult({ id: "e3", ownerId: "a2", toolCallId: "tc3", toolName: "write_file", args: { path: "b.ts" }, result: "ok", isError: false }),
    ]);

    const last = groups[0].bubbles[1];
    expect(last.kind).toBe("assistant");
    if (last.kind !== "assistant") return;
    expect(last.runChanges?.map((change) => change.path)).toEqual(["a.ts", "b.ts"]);
    expect(last.runChanges?.[0].ops.map((op) => op.toolCallId)).toEqual(["tc1", "tc2"]);
  });

  it("does not attach run changes before a file operation completes", () => {
    const groups = assembleGroups([
      user(),
      assistant({
        id: "a1",
        toolCalls: [{ toolCallId: "tc1", toolName: "write_file", args: { path: "a.ts" } }],
      }),
      toolResult({
        id: "tr1",
        ownerId: "a1",
        toolCallId: "tc1",
        toolName: "write_file",
        args: { path: "a.ts" },
        partialResult: "writing",
      }),
    ]);
    const bubble = groups[0].bubbles[0];
    if (bubble.kind !== "assistant") return;
    expect(bubble.runChanges).toBeUndefined();
  });

  it("ignores failed file operations and non-file tools", () => {
    const groups = assembleGroups([
      user(),
      assistant({
        id: "a1",
        toolCalls: [
          { toolCallId: "tc1", toolName: "write_file", args: { path: "a.ts" } },
          { toolCallId: "tc2", toolName: "read_file", args: { path: "b.ts" } },
        ],
      }),
      toolResult({ id: "e1", ownerId: "a1", toolCallId: "tc1", toolName: "write_file", args: { path: "a.ts" }, result: "boom", isError: true }),
      toolResult({ id: "e2", ownerId: "a1", toolCallId: "tc2", toolName: "read_file", args: { path: "b.ts" }, result: "data", isError: false }),
    ]);

    const bubble = groups[0].bubbles[0];
    if (bubble.kind !== "assistant") return;
    expect(bubble.runChanges).toBeUndefined();
  });
});
