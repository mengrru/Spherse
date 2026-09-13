import { describe, expect, it } from "vitest";
import { ErrorEventCode } from "@spherse/contracts";
import type { AssistantEntry, ErrorEntry, ToolResultEntry, UserEntry } from "./entry";
import { markRetrying, reduceLiveEvents } from "./entry-reducer";
import { createEntryState, type ChatEntryState } from "./entry-state";
import type { AgentEvent } from "./agent-event-parse";

function event(payload: object): AgentEvent {
  return payload as unknown as AgentEvent;
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

  it("does not settle a local optimistic entry with another client's echo", () => {
    const optimistic: UserEntry = { kind: "user", id: "c1", clientId: "c1", text: "same", optimistic: true };
    let state = stateWith([optimistic]);
    state = reduceLiveEvents(state, [
      event({ type: "user_message", seq: 5, message: { role: "user", content: "same" }, clientId: "c2" }),
    ], 1);

    expect(state.entries).toHaveLength(2);
    expect(state.entries[0]).toMatchObject({ id: "c1", optimistic: true });
    expect(state.entries[1]).toMatchObject({ kind: "user", id: "e5", seq: 5 });
  });

  it("does not settle a local optimistic entry with a clientId-less echo carrying the same text", () => {
    const optimistic: UserEntry = { kind: "user", id: "c1", clientId: "c1", text: "same", optimistic: true };
    let state = stateWith([optimistic]);
    state = reduceLiveEvents(state, [
      event({ type: "user_message", seq: 5, message: { role: "user", content: "same" }, source: "triggered" }),
    ], 1);

    expect(state.entries).toHaveLength(2);
    expect(state.entries[0]).toMatchObject({ id: "c1", optimistic: true });
  });

  it("does not reuse a completed entry when a later run reissues the same messageId", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [
      event({ type: "agent_start" }),
      event({ type: "message_start", message: assistantMessage(""), messageId: "m1" }),
      event({ type: "message_end", message: assistantMessage("first", { timestamp: 1 }), messageId: "m1", seq: 1 }),
    ], 1);

    state = reduceLiveEvents(state, [
      event({ type: "agent_start" }),
      event({ type: "message_start", message: assistantMessage(""), messageId: "m1" }),
      event({ type: "message_update", message: assistantMessage("second"), messageId: "m1" }),
    ], 2);

    expect(state.entries).toHaveLength(2);
    expect(state.entries[0]).toMatchObject({ seq: 1, text: "first", streaming: false });
    expect(state.entries[1]).toMatchObject({ streamId: "m1", text: "second", streaming: true });
    expect(state.entries[1].id).not.toBe(state.entries[0].id);
    expect(state.openStreamId).toBe(state.entries[1].id);
  });

  it("clears messageId bindings for abandoned seqs so the retry streams again", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [
      event({ type: "message_start", message: assistantMessage(""), messageId: "m1" }),
      event({ type: "message_end", message: assistantMessage("failed", { stopReason: "error", errorMessage: "boom" }), messageId: "m1", seq: 1 }),
    ], 1);
    expect(state.seqByMessageId).toEqual({ m1: 1 });

    state = reduceLiveEvents(state, [event({ type: "turn_retried", seq: 2, abandonedSeqs: [1] })], 2);
    expect(state.seqByMessageId).toEqual({});
    expect(state.entries).toHaveLength(0);

    state = reduceLiveEvents(state, [
      event({ type: "message_start", message: assistantMessage(""), messageId: "m1" }),
      event({ type: "message_update", message: assistantMessage("streaming"), messageId: "m1" }),
    ], 3);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ id: "m1", text: "streaming", streaming: true });
    expect(state.openStreamId).toBe("m1");
  });

  it("extracts tool calls from assistant content on message_end", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [
      event({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "calling" },
            { type: "toolCall", id: "tc1", name: "read_file", arguments: { path: "a" } },
          ],
          timestamp: 3,
        },
        seq: 2,
      }),
    ], 4);

    expect(state.entries[0]).toMatchObject({
      kind: "assistant",
      text: "calling",
      toolCalls: [{ toolCallId: "tc1", toolName: "read_file", args: { path: "a" } }],
    });
  });

  it("creates a tool result entry from message_end for runs without tool events", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [
      event({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "calling" },
            { type: "toolCall", id: "tc1", name: "read_file", arguments: {} },
          ],
        },
        seq: 1,
      }),
      event({
        type: "message_end",
        message: {
          role: "toolResult",
          toolCallId: "tc1",
          toolName: "read_file",
          content: [{ type: "text", text: "data" }],
          isError: false,
        },
        seq: 2,
      }),
    ], 3);

    const result = state.entries.find((entry) => entry.kind === "tool-result") as ToolResultEntry;
    expect(result).toMatchObject({
      toolCallId: "tc1",
      toolName: "read_file",
      result: "data",
      isError: false,
      seq: 2,
    });
    expect(result.ownerId).toBe(state.entries[0].id);
    expect(state.cursor).toBe(2);
  });

  it("keeps the structured live tool result when message_end arrives after tool_execution_end", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [
      event({ type: "tool_execution_start", toolCallId: "tc1", toolName: "run_command", args: { command: "ls" } }),
      event({
        type: "tool_execution_end",
        toolCallId: "tc1",
        toolName: "run_command",
        result: { details: { cardType: "command", command: "ls", stdout: "ok", status: "completed" } },
        isError: false,
      }),
    ], 1);
    state = reduceLiveEvents(state, [
      event({
        type: "message_end",
        message: {
          role: "toolResult",
          toolCallId: "tc1",
          toolName: "run_command",
          content: [{ type: "text", text: "ok" }],
          isError: false,
        },
        seq: 4,
      }),
    ], 2);

    const result = state.entries.find((entry) => entry.kind === "tool-result") as ToolResultEntry;
    expect(result.seq).toBe(4);
    expect(result.result).toMatchObject({ details: { stdout: "ok" } });
  });

  it("advances the cursor and binds seq on non-assistant message_end", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [
      event({
        type: "message_end",
        message: { role: "user", content: "ack" },
        messageId: "m2",
        seq: 6,
      }),
    ], 1);

    expect(state.entries).toHaveLength(0);
    expect(state.cursor).toBe(6);
    expect(state.seqByMessageId).toEqual({ m2: 6 });
  });
});
