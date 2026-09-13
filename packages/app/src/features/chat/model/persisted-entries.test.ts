import { describe, expect, it } from "vitest";
import type { ChatReplayEvent } from "@spherse/contracts";
import type { AssistantEntry, ErrorEntry, ToolResultEntry, UserEntry } from "./entry";
import { reduceLiveEvents } from "./entry-reducer";
import { createEntryState, type ChatEntryState } from "./entry-state";
import { applyPersistedEvents, dropTransientProjections } from "./persisted-entries";
import type { AgentEvent } from "./agent-event-parse";

function event(payload: object): AgentEvent {
  return payload as unknown as AgentEvent;
}

function replayEvent(payload: object): ChatReplayEvent {
  return payload as unknown as ChatReplayEvent;
}

function stateWith(entries: ChatEntryState["entries"]): ChatEntryState {
  return { ...createEntryState(), entries };
}

function assistantEntry(overrides: Partial<AssistantEntry> = {}): AssistantEntry {
  return {
    kind: "assistant",
    id: "a1",
    text: "",
    toolCalls: [],
    ...overrides,
  };
}

describe("persisted entries", () => {
  it("clears pendingWithdraw and bindings when a withdraw is replayed", () => {
    let state = stateWith([
      { kind: "user", id: "e1", seq: 1, text: "q" },
      assistantEntry({ id: "e2", seq: 2, text: "a" }),
    ]);
    state = { ...state, pendingWithdraw: true, seqByMessageId: { m2: 2, m9: 9 } };
    state = applyPersistedEvents(state, [
      replayEvent({ type: "turn/withdrawn", seq: 4, time: 0, data: { seq: 1 } }),
    ], 0);

    expect(state.entries).toHaveLength(0);
    expect(state.pendingWithdraw).toBe(false);
    expect(state.seqByMessageId).toEqual({ m9: 9 });
    expect(state.cursor).toBe(4);
  });

  it("applies persisted user, assistant and tool messages with seq identity", () => {
    let state = createEntryState();
    state = applyPersistedEvents(state, [
      replayEvent({ type: "turn/start", seq: 0, time: 0, data: {} }),
      replayEvent({
        type: "user/message",
        seq: 1,
        time: 100,
        data: { message: { role: "user", content: "hi", timestamp: 100 } },
      }),
      replayEvent({
        type: "assistant/message",
        seq: 2,
        time: 101,
        data: {
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "calling" },
              { type: "toolCall", id: "tc1", name: "read_file", arguments: { path: "a" } },
            ],
            timestamp: 101,
          },
        },
      }),
      replayEvent({
        type: "tool/result",
        seq: 3,
        time: 102,
        data: {
          message: {
            role: "toolResult",
            toolCallId: "tc1",
            content: [{ type: "text", text: "data" }],
            isError: false,
            timestamp: 102,
          },
        },
      }),
      replayEvent({ type: "turn/end", seq: 4, time: 103, data: { reason: "completed" } }),
    ], 0);

    expect(state.entries.map((entry) => [entry.kind, entry.id, entry.seq])).toEqual([
      ["user", "e1", 1],
      ["assistant", "e2", 2],
      ["tool-result", "e3", 3],
    ]);
    expect(state.entries[1]).toMatchObject({
      text: "calling",
      toolCalls: [{ toolCallId: "tc1", toolName: "read_file", args: { path: "a" } }],
    });
    expect(state.entries[2]).toMatchObject({ ownerId: "e2", result: "data", isError: false });
    expect(state.cursor).toBe(4);
  });

  it("merges a persisted tool result into the transient tool entry by toolCallId", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [
      event({ type: "tool_execution_end", toolCallId: "tc1", toolName: "run_command", result: "raw", isError: false }),
    ], 1);
    expect(state.entries.find((entry) => entry.kind === "tool-result")).toMatchObject({ kind: "tool-result", id: "t:tc1" });

    state = applyPersistedEvents(state, [
      replayEvent({
        type: "tool/result",
        seq: 6,
        time: 1,
        data: {
          message: {
            role: "toolResult",
            toolCallId: "tc1",
            content: [{ type: "text", text: "persisted" }],
            isError: false,
          },
        },
      }),
    ], 2);

    expect(state.entries.filter((entry) => entry.kind === "tool-result")).toHaveLength(1);
    expect(state.entries.find((entry) => entry.kind === "tool-result")).toMatchObject({ id: "t:tc1", seq: 6, result: "persisted" });
    expect(state.cursor).toBe(6);
  });

  it("settles the optimistic user entry on replay by unique text", () => {
    const optimistic: UserEntry = { kind: "user", id: "c1", clientId: "c1", text: "hi", optimistic: true };
    let state = stateWith([optimistic]);
    state = applyPersistedEvents(state, [
      replayEvent({
        type: "user/message",
        seq: 4,
        time: 1,
        data: { message: { role: "user", content: "hi", timestamp: 1 } },
      }),
    ], 2);

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ id: "c1", seq: 4, text: "hi" });
    expect((state.entries[0] as UserEntry).optimistic).toBeUndefined();
  });

  it("removes the withdrawn seq interval on replay", () => {
    let state = createEntryState();
    state = applyPersistedEvents(state, [
      replayEvent({ type: "user/message", seq: 1, time: 0, data: { message: { role: "user", content: "q1" } } }),
      replayEvent({ type: "assistant/message", seq: 2, time: 0, data: { message: { role: "assistant", content: "a1", timestamp: 0 } } }),
      replayEvent({ type: "user/message", seq: 3, time: 0, data: { message: { role: "user", content: "q2" } } }),
      replayEvent({ type: "assistant/message", seq: 4, time: 0, data: { message: { role: "assistant", content: "a2", timestamp: 0 } } }),
    ], 0);
    state = applyPersistedEvents(state, [
      replayEvent({ type: "turn/withdrawn", seq: 6, time: 0, data: { seq: 3 } }),
    ], 0);

    expect(state.entries.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(state.cursor).toBe(6);
  });

  it("advances the cursor over compaction without touching entries", () => {
    let state = createEntryState();
    state = applyPersistedEvents(state, [
      replayEvent({ type: "assistant/message", seq: 1, time: 0, data: { message: { role: "assistant", content: "a", timestamp: 0 } } }),
      replayEvent({
        type: "compaction/applied",
        seq: 2,
        time: 0,
        data: { anchorSeq: 1, digestContent: "digest", excludedSeqs: [1] },
      }),
    ], 0);

    expect(state.entries).toHaveLength(1);
    expect(state.cursor).toBe(2);
  });

  it("drops transient projections while keeping optimistic users and errors", () => {
    const transient = assistantEntry({ id: "m1", streamId: "m1", streaming: true, text: "partial" });
    const tool: ToolResultEntry = { kind: "tool-result", id: "t:tc1", toolCallId: "tc1" };
    const optimistic: UserEntry = { kind: "user", id: "c1", text: "hi", optimistic: true };
    const error: ErrorEntry = { kind: "error", id: "x1", message: "boom" };
    let state = stateWith([transient, tool, optimistic, error]);
    state = { ...state, openStreamId: "m1", ownerAssistantId: "m1", streaming: true };

    const dropped = dropTransientProjections(state);
    expect(dropped.entries.map((entry) => entry.id)).toEqual(["c1", "x1"]);
    expect(dropped.openStreamId).toBeNull();
    expect(dropped.ownerAssistantId).toBeNull();
    expect(dropTransientProjections(dropped)).toBe(dropped);
  });

  it("projects pending controls from replay and resolves them by requestId", () => {
    let state = createEntryState();
    state = applyPersistedEvents(state, [
      replayEvent({
        type: "assistant/message",
        seq: 1,
        time: 0,
        data: {
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "go" },
              { type: "toolCall", id: "tc1", name: "run_command", arguments: { command: "rm" } },
            ],
            timestamp: 0,
          },
        },
      }),
      replayEvent({
        type: "control/requested",
        seq: 2,
        time: 2,
        data: { requestId: "r1", kind: "approval", toolCallId: "tc1", toolName: "run_command", args: { command: "rm" } },
      }),
    ], 0);

    let result = state.entries.find((entry) => entry.kind === "tool-result") as ToolResultEntry;
    expect(result).toMatchObject({
      kind: "tool-result",
      id: "t:tc1",
      toolCallId: "tc1",
      ownerId: "e1",
      toolName: "run_command",
      control: { requestId: "r1", kind: "approval", status: "pending" },
    });

    state = applyPersistedEvents(state, [
      replayEvent({ type: "control/requested", seq: 2, time: 2, data: { requestId: "r1", kind: "approval", toolCallId: "tc1", toolName: "run_command", args: { command: "rm" } } }),
      replayEvent({
        type: "control/resolved",
        seq: 3,
        time: 3,
        data: { requestId: "r1", kind: "approval", approved: false, reason: "denied" },
      }),
    ], 0);

    result = state.entries.find((entry) => entry.kind === "tool-result") as ToolResultEntry;
    expect(result.control).toMatchObject({ status: "rejected", approved: false, reason: "denied" });
    expect(state.entries.filter((entry) => entry.kind === "tool-result")).toHaveLength(1);
  });

  it("answers question controls and clears pending controls on turn/end", () => {
    let state = createEntryState();
    state = applyPersistedEvents(state, [
      replayEvent({
        type: "control/requested",
        seq: 1,
        time: 1,
        data: { requestId: "q1", kind: "question", toolCallId: "tc2", toolName: "ask_user", args: { question: "why" } },
      }),
      replayEvent({
        type: "control/resolved",
        seq: 2,
        time: 2,
        data: { requestId: "q1", kind: "question", answer: "because", timedOut: false },
      }),
      replayEvent({
        type: "control/requested",
        seq: 3,
        time: 3,
        data: { requestId: "q2", kind: "question", toolCallId: "tc3", toolName: "ask_user", args: { question: "again" } },
      }),
      replayEvent({ type: "turn/end", seq: 4, time: 4, data: { reason: "aborted" } }),
    ], 0);

    const first = state.entries.find(
      (entry) => entry.kind === "tool-result" && entry.toolCallId === "tc2",
    ) as ToolResultEntry;
    expect(first.control).toMatchObject({ status: "answered", answer: "because" });
    const second = state.entries.find(
      (entry) => entry.kind === "tool-result" && entry.toolCallId === "tc3",
    ) as ToolResultEntry;
    expect(second.control).toBeUndefined();
    expect(state.cursor).toBe(4);
  });
});
