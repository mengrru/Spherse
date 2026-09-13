import { describe, expect, it } from "vitest";
import { ErrorEventCode } from "@spherse/contracts";
import type { AssistantEntry, ErrorEntry, ToolResultEntry, UserEntry } from "./entry";
import {
  createEntryState,
  markRetrying,
  reduceLiveEvents,
  type ChatEntryState,
} from "./entry-reducer";
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
    expect(reduceLiveEvents(state, [event({ type: "user_message", seq: 0, message: {} })], 1)).toBe(state);
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

  it("clears pending withdraw on turn_withdrawn and truncates the last user turn", () => {
    const user: UserEntry = { kind: "user", id: "u1", text: "q1" };
    const answer = assistantEntry({ id: "a1", text: "a1" });
    const second: UserEntry = { kind: "user", id: "u2", text: "q2" };
    const trailing = assistantEntry({ id: "a2", text: "a2" });
    let state = stateWith([user, answer, second, trailing]);
    state = { ...state, pendingWithdraw: true };
    state = reduceLiveEvents(state, [event({ type: "turn_withdrawn", seq: 2 })], 1);
    expect(state.entries.map((entry) => entry.id)).toEqual(["u1", "a1"]);
    expect(state.pendingWithdraw).toBe(false);
    expect(state.openStreamId).toBeNull();
    expect(state.ownerAssistantId).toBeNull();
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
});
