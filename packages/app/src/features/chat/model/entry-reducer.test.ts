import { describe, expect, it } from "vitest";
import { ErrorEventCode, type ChatReplayEvent } from "@spherse/contracts";
import type { AssistantEntry, ErrorEntry, ToolResultEntry, UserEntry } from "./entry";
import {
  applyPersistedEvents,
  createEntryState,
  dropTransientProjections,
  markRetrying,
  reduceLiveEvents,
  type ChatEntryState,
} from "./entry-reducer";
import type { AgentEvent } from "./agent-event-parse";

function event(payload: object): AgentEvent {
  return payload as unknown as AgentEvent;
}

function replayEvent(payload: object): ChatReplayEvent {
  return payload as unknown as ChatReplayEvent;
}

function assistantMessage(text: string, extra: Record<string, unknown> = {}) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    ...extra,
  };
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

describe("entry reducer", () => {
  it("returns the same state for ignored events", () => {
    const state = stateWith([assistantEntry()]);
    expect(reduceLiveEvents(state, [event({ type: "turn_start" })], 1)).toBe(state);
    expect(reduceLiveEvents(state, [event({ type: "session_ready", lastSeq: 0, replay: false })], 1)).toBe(state);
  });

  it("streams an assistant message and closes it on message_end", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [event({ type: "run_status", active: true })], 1);
    expect(state.streaming).toBe(true);

    state = reduceLiveEvents(state, [event({ type: "message_start", message: assistantMessage("") })], 2);
    expect(state.entries).toHaveLength(1);
    const entryId = state.entries[0].id;
    expect(state.openStreamId).toBe(entryId);

    state = reduceLiveEvents(state, [event({ type: "message_update", message: assistantMessage("hello") })], 3);
    state = reduceLiveEvents(state, [event({ type: "message_end", message: assistantMessage("hello", { timestamp: 10 }) })], 4);

    expect(state.entries[0]).toMatchObject({ kind: "assistant", text: "hello", streaming: false, time: 10 });
    expect(state.openStreamId).toBeNull();
    expect(state.ownerAssistantId).toBe(entryId);

    state = reduceLiveEvents(state, [event({ type: "agent_end", messages: [] })], 5);
    expect(state.streaming).toBe(false);
    expect(state.ownerAssistantId).toBeNull();
  });

  it("attaches tool results to the assistant message that finished before the tool ran", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [event({ type: "message_start", message: assistantMessage("") })], 1);
    state = reduceLiveEvents(state, [event({ type: "message_end", message: assistantMessage("", { stopReason: "toolUse" }) })], 2);
    const assistantId = state.entries[0].id;

    state = reduceLiveEvents(state, [
      event({ type: "tool_execution_start", toolCallId: "tc1", toolName: "run_command", args: { command: "ls" } }),
    ], 3);
    state = reduceLiveEvents(state, [
      event({ type: "tool_execution_update", toolCallId: "tc1", toolName: "run_command", args: { command: "ls" }, partialResult: "partial" }),
    ], 4);
    state = reduceLiveEvents(state, [
      event({ type: "tool_execution_end", toolCallId: "tc1", toolName: "run_command", result: { details: { stdout: "ok" } }, isError: false }),
    ], 5);

    const assistant = state.entries[0] as AssistantEntry;
    expect(assistant.toolCalls).toEqual([{ toolCallId: "tc1", toolName: "run_command", args: { command: "ls" } }]);
    const result = state.entries.find((entry) => entry.kind === "tool-result") as ToolResultEntry;
    expect(result.ownerId).toBe(assistantId);
    expect(result.toolName).toBe("run_command");
    expect(result.isError).toBe(false);
    expect(result).not.toBeUndefined();
  });

  it("creates a tool result entry on update or end even without a start", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [
      event({ type: "tool_execution_end", toolCallId: "tc9", toolName: "read_file", result: "content", isError: false }),
    ], 1);
    const result = state.entries.find((entry) => entry.kind === "tool-result") as ToolResultEntry;
    expect(result.toolCallId).toBe("tc9");
    expect(result.result).toBe("content");
  });

  it("marks an assistant message with stopReason error as a turn error", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [event({ type: "message_start", message: assistantMessage("") })], 1);
    state = reduceLiveEvents(state, [
      event({ type: "message_end", message: assistantMessage("", { stopReason: "error", errorMessage: "unauthorized" }) }),
    ], 2);
    const assistant = state.entries[0] as AssistantEntry;
    expect(assistant.error).toEqual({ message: "unauthorized", code: ErrorEventCode.Auth });
    expect(assistant.streaming).toBe(false);
  });

  it("attaches error events to an open assistant window", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [event({ type: "message_start", message: assistantMessage("") })], 1);
    state = reduceLiveEvents(state, [event({ type: "error", message: "boom", code: ErrorEventCode.Permanent })], 2);
    const assistant = state.entries[0] as AssistantEntry;
    expect(assistant.error).toEqual({ message: "boom", code: ErrorEventCode.Permanent });
    expect(assistant.streaming).toBe(false);
    expect(state.openStreamId).toBeNull();
    expect(state.streaming).toBe(false);
  });

  it("appends a standalone error entry when no assistant window is open", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [event({ type: "error", message: "nope" })], 1);
    const error = state.entries[0] as ErrorEntry;
    expect(error.kind).toBe("error");
    expect(error.message).toBe("nope");
  });

  it("settles a pending withdraw with the next error event", () => {
    let state = stateWith([assistantEntry({ id: "a1", error: { message: "old" } })]);
    state = { ...state, pendingWithdraw: true };
    state = reduceLiveEvents(state, [event({ type: "error", message: "withdraw failed" })], 1);
    expect(state.pendingWithdraw).toBe(false);
    const error = state.entries[state.entries.length - 1] as ErrorEntry;
    expect(error.retrySuppressed).toBe(true);
  });

  it("clears pending withdraw on turn_withdrawn and truncates from the withdrawn seq", () => {
    const user: UserEntry = { kind: "user", id: "e0", seq: 0, text: "q1" };
    const answer = assistantEntry({ id: "e1", seq: 1, text: "a1" });
    const second: UserEntry = { kind: "user", id: "e2", seq: 2, text: "q2" };
    const trailing = assistantEntry({ id: "e3", seq: 3, text: "a2" });
    let state = stateWith([user, answer, second, trailing]);
    state = { ...state, pendingWithdraw: true };
    state = reduceLiveEvents(state, [event({ type: "turn_withdrawn", seq: 2 })], 1);
    expect(state.entries.map((entry) => entry.id)).toEqual(["e0", "e1"]);
    expect(state.pendingWithdraw).toBe(false);
    expect(state.openStreamId).toBeNull();
    expect(state.ownerAssistantId).toBeNull();
    expect(state.cursor).toBe(2);
  });

  it("tracks control requests on tool results and resolves them", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [
      event({ type: "tool_execution_start", toolCallId: "tc1", toolName: "run_command", args: { command: "rm" } }),
      event({ type: "control_request", requestId: "r1", kind: "approval", toolCallId: "tc1", toolName: "run_command", args: { command: "rm" } }),
    ], 1);
    let result = state.entries.find((entry) => entry.kind === "tool-result") as ToolResultEntry;
    expect(result.control).toEqual({ requestId: "r1", kind: "approval", status: "pending" });

    state = reduceLiveEvents(state, [
      event({ type: "control_resolved", requestId: "r1", kind: "approval", approved: false }),
    ], 2);
    result = state.entries.find((entry) => entry.kind === "tool-result") as ToolResultEntry;
    expect(result.control).toMatchObject({ status: "rejected", approved: false });
  });

  it("clears pending question controls when the run ends", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [
      event({ type: "tool_execution_start", toolCallId: "tc1", toolName: "ask_user", args: { question: "why" } }),
      event({ type: "control_request", requestId: "q1", kind: "question", toolCallId: "tc1", toolName: "ask_user", args: { question: "why" } }),
    ], 1);
    state = reduceLiveEvents(state, [event({ type: "run_status", active: false })], 2);
    const result = state.entries.find((entry) => entry.kind === "tool-result") as ToolResultEntry;
    expect(result.control).toBeUndefined();
  });

  it("markRetrying clears the error and reuses the entry on the next message_start", () => {
    let state = stateWith([
      { kind: "user", id: "u1", text: "hi" },
      assistantEntry({ id: "a1", text: "", error: { message: "boom", code: ErrorEventCode.Transient } }),
    ]);
    const retried = markRetrying(state);
    expect(retried.entries[1]).toMatchObject({ kind: "assistant", streaming: true });
    expect((retried.entries[1] as AssistantEntry).error).toBeUndefined();

    state = reduceLiveEvents(retried, [event({ type: "message_start", message: assistantMessage("") })], 1);
    expect(state.entries).toHaveLength(2);
    expect(state.entries[1].id).toBe("a1");
    expect(state.entries[1]).toMatchObject({ streaming: true });
    expect(state.openStreamId).toBe("a1");
  });

  it("does not append an empty assistant bubble for an empty update after a closed assistant", () => {
    let state = stateWith([assistantEntry({ id: "a1", text: "done" })]);
    state = reduceLiveEvents(state, [event({ type: "message_update", message: assistantMessage("") })], 1);
    expect(state.entries).toHaveLength(1);
  });

  it("settles the optimistic user entry with the echoed seq and clientId", () => {
    const optimistic: UserEntry = { kind: "user", id: "c1", clientId: "c1", text: "hi", optimistic: true };
    let state = stateWith([optimistic]);
    state = reduceLiveEvents(state, [
      event({ type: "user_message", seq: 4, message: { role: "user", content: "hi", timestamp: 9 }, clientId: "c1" }),
    ], 10);

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ kind: "user", id: "c1", seq: 4, text: "hi", time: 9 });
    expect((state.entries[0] as UserEntry).optimistic).toBeUndefined();
    expect(state.cursor).toBe(4);
  });

  it("creates a trigger user entry from an echo without clientId", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [
      event({
        type: "user_message",
        seq: 0,
        message: { role: "user", content: "report" },
        source: "triggered",
        triggerName: "cron",
      }),
    ], 1);

    expect(state.entries[0]).toMatchObject({
      kind: "user",
      id: "e0",
      seq: 0,
      text: "report",
      triggered: true,
      triggerName: "cron",
    });
    expect(state.cursor).toBe(0);
  });

  it("is idempotent for repeated user echoes", () => {
    const echo = event({ type: "user_message", seq: 4, message: { role: "user", content: "hi" } });
    let state = reduceLiveEvents(createEntryState(), [echo], 1);
    const once = state;
    state = reduceLiveEvents(state, [echo], 2);
    expect(state).toBe(once);
  });

  it("binds messageId to the persisted seq and skips resent wire frames", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [event({ type: "message_start", message: assistantMessage(""), messageId: "m1" })], 1);
    state = reduceLiveEvents(state, [event({ type: "message_update", message: assistantMessage("partial"), messageId: "m1" })], 2);
    state = reduceLiveEvents(state, [
      event({ type: "message_end", message: assistantMessage("done", { timestamp: 5 }), messageId: "m1", seq: 7 }),
    ], 3);

    expect(state.seqByMessageId).toEqual({ m1: 7 });
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ kind: "assistant", id: "m1", text: "done", seq: 7, streaming: false });
    expect(state.cursor).toBe(7);

    state = reduceLiveEvents(state, [
      event({ type: "message_start", message: assistantMessage(""), messageId: "m1" }),
      event({ type: "message_update", message: assistantMessage("done"), messageId: "m1" }),
      event({ type: "message_end", message: assistantMessage("done"), messageId: "m1", seq: 7 }),
    ], 4);

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].id).toBe("m1");
  });

  it("drops the transient window when the replayed seq already exists", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [event({ type: "message_start", message: assistantMessage(""), messageId: "m1" })], 1);
    state = reduceLiveEvents(state, [event({ type: "message_update", message: assistantMessage("partial"), messageId: "m1" })], 2);
    state = { ...state, entries: [...state.entries, assistantEntry({ id: "e7", seq: 7, text: "done" })] };

    state = reduceLiveEvents(state, [
      event({ type: "message_end", message: assistantMessage("partial"), messageId: "m1", seq: 7 }),
    ], 3);

    expect(state.entries.map((entry) => entry.id)).toEqual(["e7"]);
    expect(state.openStreamId).toBeNull();
    expect(state.seqByMessageId).toEqual({ m1: 7 });
  });

  it("upserts an update with a known messageId instead of appending a duplicate", () => {
    let state = stateWith([assistantEntry({ id: "m1", streamId: "m1", text: "old", streaming: false })]);
    state = reduceLiveEvents(state, [
      event({ type: "message_update", message: assistantMessage("new"), messageId: "m1" }),
    ], 1);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ id: "m1", text: "new", streaming: true });
  });

  it("removes abandoned seqs on turn_retried", () => {
    let state = stateWith([
      { kind: "user", id: "e1", seq: 1, text: "q" },
      assistantEntry({ id: "e2", seq: 2, text: "failed" }),
      { kind: "tool-result", id: "e3", seq: 3, toolCallId: "tc1" },
    ]);
    state = reduceLiveEvents(state, [event({ type: "turn_retried", seq: 5, abandonedSeqs: [2, 3] })], 1);

    expect(state.entries.map((entry) => entry.id)).toEqual(["e1"]);
    expect(state.cursor).toBe(5);
    expect(state.openStreamId).toBeNull();
    expect(state.ownerAssistantId).toBeNull();
  });

  it("advances the cursor on agent_end", () => {
    const state = reduceLiveEvents(createEntryState(), [event({ type: "agent_end", messages: [], seq: 9 })], 1);
    expect(state.cursor).toBe(9);
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
});
