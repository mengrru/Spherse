import { describe, expect, it } from "vitest";
import { ErrorEventCode } from "@spherse/contracts";
import {
  applyAbort,
  applyFatalClose,
  applyHistoryResult,
  applyRetryLast,
  createInitialSessionData,
  createOutboxEntry,
  reduceSessionEvents,
  truncateForResend,
} from "./session-events";
import { buildRenderList } from "./render-list";
import { isSessionStreaming, type ChatSessionData, type ToolCallInfo } from "../types";
import type { AgentEvent } from "./agent-event-parse";

function session(overrides: Partial<ChatSessionData> = {}): ChatSessionData {
  return { ...createInitialSessionData(), lastActivityAt: 1, ...overrides };
}

function messagesOf(state: ChatSessionData) {
  return buildRenderList(state).map((item) => item.message);
}

function firstToolCall(state: ChatSessionData): ToolCallInfo {
  const toolCalls = buildRenderList(state).flatMap((item) => item.message._toolCalls ?? []);
  return toolCalls[0];
}

describe("session event routing", () => {
  it("keeps the same session object for ignored events", () => {
    const current = session();
    current.runs.push({ id: 1, active: false, segments: [{ content: "hello", toolCalls: [], finished: true }] });

    const next = reduceSessionEvents(current, [{ type: "turn_start" }], 200);

    expect(next).toBe(current);
  });

  it("turn_withdrawn drops the last user turn including trailing transient messages", () => {
    const current = session();
    current.history.messages.push(
      { role: "user", content: "q1", _messageId: 1 },
      { role: "assistant", content: "a1", _messageId: 2 },
    );
    const { session: withOutbox } = createOutboxEntry(current, "q2", undefined, false, "o1");
    withOutbox.seq += 1;
    withOutbox.runs.push({
      id: withOutbox.seq,
      active: false,
      segments: [{ content: "a2", toolCalls: [], finished: true }],
    });

    const next = reduceSessionEvents(withOutbox, [{ type: "turn_withdrawn", seq: 2 }], 200);

    expect(messagesOf(next)).toEqual([
      { role: "user", content: "q1", _messageId: 1 },
      { role: "assistant", content: "a1", _messageId: 2 },
    ]);
    expect(isSessionStreaming(next)).toBe(false);
  });

  it("turn_withdrawn drops a trailing error bubble attached to the withdrawn turn", () => {
    const current = session();
    current.history.messages.push({ role: "user", content: "q1", _messageId: 1 });
    current.runs.push({
      id: 1,
      active: false,
      segments: [{ content: "", toolCalls: [], finished: true, error: { message: "boom", turnError: true } }],
    });

    const next = reduceSessionEvents(current, [{ type: "turn_withdrawn", seq: 0 }], 200);

    expect(messagesOf(next)).toEqual([]);
  });

  it("turn_withdrawn is a no-op when there is no user message", () => {
    const current = session();
    current.runs.push({ id: 1, active: false, segments: [{ content: "hello", toolCalls: [], finished: true }] });

    const next = reduceSessionEvents(current, [{ type: "turn_withdrawn", seq: 0 }], 200);

    expect(messagesOf(next)).toEqual([{ role: "assistant", content: "hello" }]);
  });

  it("turn_withdrawn clears pending interactions", () => {
    const base = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "tool_execution_start", toolCallId: "tc1", toolName: "ask_user", args: { question: "q?" } },
      { type: "control_request", requestId: "q1", kind: "question", toolCallId: "tc1", toolName: "ask_user", args: { question: "q?" } },
    ] as unknown as AgentEvent[], 1);
    base.history.messages.push({ role: "user", content: "q1", _messageId: 1 });

    const next = reduceSessionEvents(base, [{ type: "turn_withdrawn", seq: 0 }], 2);

    expect(next.interactions).toEqual({});
  });
});

describe("error placement", () => {
  it("attaches stream errors to the current streaming assistant message with turnError", () => {
    const base = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "partial" }] } },
    ] as unknown as AgentEvent[], 1);

    const next = reduceSessionEvents(base, [{ type: "error", message: "broken" }], 2);

    const items = buildRenderList(next);
    const last = items[items.length - 1];
    expect(last.message._error).toBe("broken");
    expect(last.message._turnError).toBe(true);
    expect(last.message.content).toBe("partial");
    expect(last.streaming).toBeFalsy();
  });

  it("attaches errorCode when the error event carries a code", () => {
    const next = reduceSessionEvents(session(), [
      { type: "error", message: "no model", code: ErrorEventCode.ModelNotConfigured },
    ] as unknown as AgentEvent[], 2);

    const items = buildRenderList(next);
    expect(items[items.length - 1].message).toMatchObject({
      role: "assistant",
      content: "",
      _error: "no model",
      _errorCode: ErrorEventCode.ModelNotConfigured,
    });
  });

  it("leaves errorCode undefined when the error event has no code", () => {
    const next = reduceSessionEvents(session(), [{ type: "error", message: "broken" }], 2);
    const items = buildRenderList(next);
    expect(items[items.length - 1].message._errorCode).toBeUndefined();
    expect(items[items.length - 1].message._error).toBe("broken");
  });

  it("does NOT set turnError for a new pre-prompt error bubble (Source 1)", () => {
    const { session: withOutbox } = createOutboxEntry(session(), "start", undefined, false, "o1");
    const next = reduceSessionEvents(withOutbox, [{ type: "error", message: "no model" }], 2);

    const items = buildRenderList(next);
    expect(items[items.length - 1].message._turnError).toBeFalsy();
    expect(items[items.length - 1].message._error).toBe("no model");
  });

  it("error events settle pending outbox entries and clear streaming", () => {
    const { session: withOutbox } = createOutboxEntry(session(), "hi", undefined, false, "o1");

    const next = reduceSessionEvents(withOutbox, [{ type: "error", message: "conflict" }], 2);

    expect(next.outbox[0].status).toBe("sent");
    expect(isSessionStreaming(next)).toBe(false);
  });

  it("error events mark active runs inactive", () => {
    const base = reduceSessionEvents(session(), [{ type: "agent_start" }], 1);

    const next = reduceSessionEvents(base, [{ type: "error", message: "broken" }], 2);

    expect(isSessionStreaming(next)).toBe(false);
    expect(next.runs[0].active).toBe(false);
  });

  it("error during pendingWithdraw flags withdrawError", () => {
    const current = session({ pendingWithdraw: true });

    const next = reduceSessionEvents(current, [{ type: "error", message: "nope" }], 2);

    expect(next.pendingWithdraw).toBe(false);
    expect(next.withdrawError).toBe(true);
  });
});

describe("run lifecycle", () => {
  it("run_status active:false reconciles a run that ended while disconnected", () => {
    const base = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "partial" }] } },
    ] as unknown as AgentEvent[], 1);

    const next = reduceSessionEvents(base, [{ type: "run_status", active: false }], 300);

    expect(isSessionStreaming(next)).toBe(false);
    expect(buildRenderList(next)[0].streaming).toBeFalsy();
  });

  it("run_status active:true settles pending outbox and reactivates streaming", () => {
    const { session: withOutbox } = createOutboxEntry(session(), "hi", undefined, false, "o1");

    const next = reduceSessionEvents(withOutbox, [{ type: "run_status", active: true }], 2);

    expect(next.outbox[0].status).toBe("sent");
    expect(isSessionStreaming(next)).toBe(true);
  });

  it("agent_start is idempotent while a run is active (replay)", () => {
    const base = reduceSessionEvents(session(), [{ type: "agent_start" }], 1);

    const next = reduceSessionEvents(base, [{ type: "agent_start" }], 2);

    expect(next.runs).toHaveLength(1);
    expect(next.runs[0].id).toBe(base.runs[0].id);
  });

  it("agent_end settles pending outbox and deactivates the run", () => {
    const base = reduceSessionEvents(session(), [{ type: "agent_start" }], 1);
    const { session: withOutbox } = createOutboxEntry(base, "hi", undefined, false, "o1");

    const next = reduceSessionEvents(withOutbox, [{ type: "agent_end", messages: [] }], 2);

    expect(next.outbox[0].status).toBe("sent");
    expect(isSessionStreaming(next)).toBe(false);
  });

  it("handles the complete pi-agent lifecycle without duplicating user messages", () => {
    const current = session();
    current.history.messages.push({ role: "user", content: "Hello", _messageId: 1 });

    const afterAgentEnd = reduceSessionEvents(current, [
      { type: "agent_start" },
      { type: "turn_start" },
      { type: "message_start", message: { role: "user", content: [{ type: "text", text: "Hello" }] } },
      { type: "message_end", message: { role: "user", content: [{ type: "text", text: "Hello" }] } },
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] } },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hi there" }] } },
      { type: "turn_end", message: {}, toolResults: [] },
      { type: "agent_end", messages: [] },
    ] as unknown as AgentEvent[], 200);

    expect(isSessionStreaming(afterAgentEnd)).toBe(false);
    expect(messagesOf(afterAgentEnd)).toEqual([
      { role: "user", content: "Hello", _messageId: 1 },
      { role: "assistant", content: "Hi there", timestamp: 200 },
    ]);
  });
});

describe("message events", () => {
  it("creates an assistant segment on message_start after run activation", () => {
    const current = session();
    current.history.messages.push({ role: "user", content: "Hello", _messageId: 1 });

    const next = reduceSessionEvents(current, [
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
    ] as unknown as AgentEvent[], 200);

    const items = buildRenderList(next);
    expect(items[1].message).toMatchObject({ role: "assistant", content: "" });
    expect(items[1].streaming).toBe(true);
  });

  it("message_end writes timestamp from event.message.timestamp", () => {
    const next = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hi" }], timestamp: 9999 } },
    ] as unknown as AgentEvent[], 200);

    expect(messagesOf(next)[0].timestamp).toBe(9999);
  });

  it("message_end falls back to now when event lacks timestamp", () => {
    const next = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] } },
    ] as unknown as AgentEvent[], 4242);

    expect(messagesOf(next)[0].timestamp).toBe(4242);
  });

  it("sets error when message_end has stopReason error", () => {
    const next = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Rate limit exceeded" } },
    ] as unknown as AgentEvent[], 200);

    expect(messagesOf(next)[0]).toMatchObject({
      role: "assistant",
      content: "",
      _error: "Rate limit exceeded",
      _errorCode: "TRANSIENT",
      _turnError: true,
      timestamp: 200,
    });
  });

  it("sets error with fallback when errorMessage is missing", () => {
    const next = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_end", message: { role: "assistant", content: [], stopReason: "error" } },
    ] as unknown as AgentEvent[], 200);

    expect(messagesOf(next)[0]._error).toBe("Unknown error");
  });

  it("does not set error for non-error stopReason", () => {
    const next = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hi" }], stopReason: "stop" } },
    ] as unknown as AgentEvent[], 200);

    expect(messagesOf(next)[0]._error).toBeUndefined();
  });
});

describe("run_command approval + command card lifecycle", () => {
  it("flows pending_approval -> running -> completed with streamed output", () => {
    const start = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "tool_execution_start", toolCallId: "tc1", toolName: "run_command", args: { command: "echo hi", cwd: "." } },
    ] as unknown as AgentEvent[], 1);
    expect(firstToolCall(start).status).toBe("running");
    expect(firstToolCall(start)._card).toBeUndefined();

    const pending = reduceSessionEvents(start, [
      { type: "control_request", requestId: "r1", kind: "approval", toolCallId: "tc1", toolName: "run_command", args: { command: "echo hi" } },
    ] as unknown as AgentEvent[], 2);
    expect(firstToolCall(pending)._card).toMatchObject({
      type: "command",
      status: "pending_approval",
      command: "echo hi",
      requestId: "r1",
    });

    const running = reduceSessionEvents(pending, [
      { type: "control_resolved", requestId: "r1", kind: "approval", approved: true },
    ] as unknown as AgentEvent[], 3);
    expect(firstToolCall(running)._card).toMatchObject({ type: "command", status: "running" });

    const streamed = reduceSessionEvents(running, [
      {
        type: "tool_execution_update",
        toolCallId: "tc1",
        toolName: "run_command",
        args: {},
        partialResult: { details: { cardType: "command", status: "running", command: "echo hi", stdout: "hi\n", stderr: "" } },
      },
    ] as unknown as AgentEvent[], 4);
    expect(firstToolCall(streamed)._card).toMatchObject({ stdout: "hi\n" });

    const done = reduceSessionEvents(streamed, [
      {
        type: "tool_execution_end",
        toolCallId: "tc1",
        toolName: "run_command",
        isError: false,
        result: { details: { cardType: "command", status: "completed", command: "echo hi", stdout: "hi\n", stderr: "", exitCode: 0, durationMs: 12 } },
      },
    ] as unknown as AgentEvent[], 5);
    expect(firstToolCall(done)._card).toMatchObject({ type: "command", status: "completed", exitCode: 0, durationMs: 12 });
    expect(firstToolCall(done).status).toBe("completed");
  });

  it("marks the command card as rejected when approval is denied", () => {
    const seeded = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "tool_execution_start", toolCallId: "tc2", toolName: "run_command", args: { command: "rm -rf x" } },
      { type: "control_request", requestId: "r2", kind: "approval", toolCallId: "tc2", toolName: "run_command", args: { command: "rm -rf x" } },
    ] as unknown as AgentEvent[], 1);

    const denied = reduceSessionEvents(seeded, [
      { type: "control_resolved", requestId: "r2", kind: "approval", approved: false },
    ] as unknown as AgentEvent[], 2);

    expect(firstToolCall(denied)._card).toMatchObject({ type: "command", status: "error", rejected: true });
  });

  it("ignores control requests whose toolCallId matches no tool call", () => {
    const next = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "control_request", requestId: "r9", kind: "approval", toolCallId: "missing", toolName: "run_command", args: {} },
    ] as unknown as AgentEvent[], 1);

    expect(next.interactions).toEqual({});
  });
});

describe("question card lifecycle", () => {
  function pendingQuestion(args: Record<string, unknown>) {
    const start = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "tool_execution_start", toolCallId: "tq1", toolName: "ask_user", args },
    ] as unknown as AgentEvent[], 1);
    return reduceSessionEvents(start, [
      { type: "control_request", requestId: "q1", kind: "question", toolCallId: "tq1", toolName: "ask_user", args },
    ] as unknown as AgentEvent[], 2);
  }

  it("attaches a pending question card with sanitized options", () => {
    const pending = pendingQuestion({ question: "Deploy?", options: ["yes", "no", 42, null] });
    expect(firstToolCall(pending)._card).toMatchObject({
      type: "question",
      status: "pending",
      question: "Deploy?",
      options: ["yes", "no"],
      requestId: "q1",
    });
  });

  it("drops options entirely when fewer than 2 survive filtering", () => {
    const pending = pendingQuestion({ question: "Proceed?", options: ["only-one", 7] });
    const card = firstToolCall(pending)._card;
    expect(card).toMatchObject({ type: "question", status: "pending", question: "Proceed?" });
    expect((card as { options?: string[] }).options).toBeUndefined();
  });

  it("defaults question to empty string against illegal args", () => {
    const pending = pendingQuestion({ question: 42 });
    const card = firstToolCall(pending)._card;
    expect(card).toMatchObject({ type: "question", status: "pending", question: "" });
  });

  it("marks the card answered with the answer and clears the request id", () => {
    const answered = reduceSessionEvents(pendingQuestion({ question: "Deploy?" }), [
      { type: "control_resolved", requestId: "q1", kind: "question", answer: "yes", timedOut: false },
    ] as unknown as AgentEvent[], 3);
    expect(firstToolCall(answered)._card).toMatchObject({
      type: "question",
      status: "answered",
      answer: "yes",
    });
    expect((firstToolCall(answered)._card as { requestId?: string }).requestId).toBeUndefined();
  });

  it("marks the card timeout when resolution times out", () => {
    const timedOut = reduceSessionEvents(pendingQuestion({ question: "Deploy?" }), [
      { type: "control_resolved", requestId: "q1", kind: "question", timedOut: true },
    ] as unknown as AgentEvent[], 3);
    expect(firstToolCall(timedOut)._card).toMatchObject({ type: "question", status: "timeout" });
  });

  it("ignores a resolution whose request id does not match", () => {
    const pending = pendingQuestion({ question: "Deploy?" });
    const next = reduceSessionEvents(pending, [
      { type: "control_resolved", requestId: "other", kind: "question", answer: "yes", timedOut: false },
    ] as unknown as AgentEvent[], 3);
    expect(next).toBe(pending);
  });

  it("does not disturb approval interactions with question events", () => {
    const seeded = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "tool_execution_start", toolCallId: "tc1", toolName: "run_command", args: { command: "ls" } },
      { type: "control_request", requestId: "r1", kind: "approval", toolCallId: "tc1", toolName: "run_command", args: { command: "ls" } },
    ] as unknown as AgentEvent[], 1);
    const next = reduceSessionEvents(seeded, [
      { type: "control_resolved", requestId: "r1", kind: "question", answer: "yes", timedOut: false },
    ] as unknown as AgentEvent[], 2);
    expect(firstToolCall(next)._card).toMatchObject({ type: "command", status: "pending_approval", requestId: "r1" });
  });

  it("clears a pending question card when the run ends without resolution (abort)", () => {
    const pending = pendingQuestion({ question: "Deploy?" });
    const next = reduceSessionEvents(pending, [
      { type: "run_status", active: false },
    ] as unknown as AgentEvent[], 3);
    expect(firstToolCall(next)._card).toBeUndefined();
  });

  it("keeps an answered question card when the run ends", () => {
    const answered = reduceSessionEvents(pendingQuestion({ question: "Deploy?" }), [
      { type: "control_resolved", requestId: "q1", kind: "question", answer: "yes", timedOut: false },
    ] as unknown as AgentEvent[], 3);
    const next = reduceSessionEvents(answered, [
      { type: "run_status", active: false },
    ] as unknown as AgentEvent[], 4);
    expect(firstToolCall(next)._card).toMatchObject({
      type: "question",
      status: "answered",
      answer: "yes",
    });
  });

  it("leaves pending approval cards untouched when the run ends", () => {
    const seeded = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "tool_execution_start", toolCallId: "tc1", toolName: "run_command", args: { command: "ls" } },
      { type: "control_request", requestId: "r1", kind: "approval", toolCallId: "tc1", toolName: "run_command", args: { command: "ls" } },
    ] as unknown as AgentEvent[], 1);
    const next = reduceSessionEvents(seeded, [
      { type: "run_status", active: false },
    ] as unknown as AgentEvent[], 2);
    expect(firstToolCall(next)._card).toMatchObject({
      type: "command",
      status: "pending_approval",
      requestId: "r1",
    });
  });
});

describe("generic approval card lifecycle", () => {
  function pendingManageAgent() {
    const start = reduceSessionEvents(session(), [
      { type: "agent_start" },
      {
        type: "tool_execution_start",
        toolCallId: "tc1",
        toolName: "manage_agent",
        args: { action: "create", name: "Reviewer" },
      },
    ] as unknown as AgentEvent[], 1);
    return reduceSessionEvents(start, [
      {
        type: "control_request",
        requestId: "r1",
        kind: "approval",
        toolCallId: "tc1",
        toolName: "manage_agent",
        args: { action: "create", name: "Reviewer" },
      },
    ] as unknown as AgentEvent[], 2);
  }

  it("renders an approval card for non-run_command tools", () => {
    const pending = pendingManageAgent();
    expect(firstToolCall(pending)._card).toMatchObject({
      type: "approval",
      status: "pending",
      toolName: "manage_agent",
      args: { action: "create", name: "Reviewer" },
      requestId: "r1",
    });
  });

  it("marks the card approved and drops the request id", () => {
    const approved = reduceSessionEvents(pendingManageAgent(), [
      { type: "control_resolved", requestId: "r1", kind: "approval", approved: true },
    ] as unknown as AgentEvent[], 3);
    expect(firstToolCall(approved)._card).toMatchObject({ type: "approval", status: "approved" });
    expect((firstToolCall(approved)._card as { requestId?: string }).requestId).toBeUndefined();
  });

  it("marks the card rejected when denied", () => {
    const rejected = reduceSessionEvents(pendingManageAgent(), [
      { type: "control_resolved", requestId: "r1", kind: "approval", approved: false },
    ] as unknown as AgentEvent[], 3);
    expect(firstToolCall(rejected)._card).toMatchObject({ type: "approval", status: "rejected" });
  });
});

describe("retry-last", () => {
  function erroredRun() {
    return reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "partial" }] } },
      { type: "error", message: "timeout", code: ErrorEventCode.Transient },
    ] as unknown as AgentEvent[], 1);
  }

  it("clears the trailing error and reactivates the run", () => {
    const next = applyRetryLast(erroredRun());

    expect(next.retrying).toBe(true);
    expect(next.runs[0].active).toBe(true);
    expect(next.runs[0].segments[0].error).toBeUndefined();
    expect(isSessionStreaming(next)).toBe(true);
    const item = buildRenderList(next)[0];
    expect(item.message._error).toBeUndefined();
    expect(item.streaming).toBe(true);
  });

  it("removes trailing error messages from history when no run hosts the error", () => {
    const current = session();
    current.history.messages.push(
      { role: "user", content: "Hello", _messageId: 1 },
      { role: "assistant", content: "", _messageId: 2, _error: "Rate limit exceeded", _turnError: true },
    );

    const next = applyRetryLast(current);

    expect(next.history.messages).toEqual([
      { role: "user", content: "Hello", _messageId: 1 },
    ]);
    expect(next.retrying).toBe(true);
  });

  it("clears retrying when a new run activates", () => {
    const retrying = applyRetryLast(erroredRun());

    const next = reduceSessionEvents(retrying, [{ type: "run_status", active: true }], 5);

    expect(next.retrying).toBe(false);
  });
});

describe("history result application", () => {
  function page(entries: unknown[], hasMore = false) {
    return {
      entries,
      hasMore,
      oldestId: entries.length,
    };
  }

  it("reconcile drops active non-error runs so replay can rebuild them", () => {
    const base = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "partial" }] } },
    ] as unknown as AgentEvent[], 1);
    const activeRunId = base.runs[0].id;

    const next = applyHistoryResult(base, page([{ id: 1, message: { role: "user", content: "hi" } }]), "reconcile");

    expect(next.runs).toHaveLength(0);
    expect(next.seq).toBe(activeRunId - 1);
    expect(next.history.messages).toEqual([
      { role: "user", content: "hi", _messageId: 1 },
    ]);
  });

  it("loadMore keeps runs untouched (older pages cannot cover them)", () => {
    const base = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
      { type: "run_status", active: false },
    ] as unknown as AgentEvent[], 1);
    expect(base.runs).toHaveLength(1);
    expect(base.runs[0].active).toBe(false);

    const next = applyHistoryResult(base, page([{ id: 1, message: { role: "user", content: "old" } }]), "loadMore");

    expect(next.runs).toBe(base.runs);
    expect(messagesOf(next)).toEqual([
      { role: "user", content: "old", _messageId: 1, timestamp: undefined },
      { role: "assistant", content: "done", timestamp: 1 },
    ]);
  });

  it("keeps inactive error runs whose error is not in loaded history (Source-1 bubble)", () => {
    const errored = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "error", message: "MODEL_NOT_CONFIGURED", code: ErrorEventCode.ModelNotConfigured },
    ] as unknown as AgentEvent[], 1);

    const next = applyHistoryResult(errored, page([{ id: 1, message: { role: "user", content: "hi" } }]), "refresh");

    expect(next.runs).toHaveLength(1);
    const items = buildRenderList(next);
    expect(items[items.length - 1].message._error).toBe("MODEL_NOT_CONFIGURED");
  });

  it("drops inactive error runs whose error is already persisted in history", () => {
    const errored = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Rate limit exceeded" } },
      { type: "run_status", active: false },
    ] as unknown as AgentEvent[], 1);

    const next = applyHistoryResult(errored, page([
      { id: 1, message: { role: "user", content: "hi" } },
      { id: 2, message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Rate limit exceeded" } },
    ]), "refresh");

    expect(next.runs).toHaveLength(0);
  });

  it("reconcile/refresh consume matched outbox entries; loadMore does not", () => {
    const { session: withOutbox } = createOutboxEntry(session(), "hi", undefined, false, "o1");
    const historyPage = page([{ id: 5, message: { role: "user", content: "hi" } }]);

    const refreshed = applyHistoryResult(withOutbox, historyPage, "refresh");
    expect(refreshed.outbox).toHaveLength(0);

    const loadedMore = applyHistoryResult(withOutbox, historyPage, "loadMore");
    expect(loadedMore.outbox).toHaveLength(1);
  });

  it("drops interactions whose host run was dropped", () => {
    const base = reduceSessionEvents(session(), [
      { type: "agent_start" },
      { type: "tool_execution_start", toolCallId: "tc1", toolName: "run_command", args: { command: "ls" } },
      { type: "control_request", requestId: "r1", kind: "approval", toolCallId: "tc1", toolName: "run_command", args: { command: "ls" } },
      { type: "run_status", active: false },
    ] as unknown as AgentEvent[], 1);
    expect(Object.keys(base.interactions)).toHaveLength(1);

    const next = applyHistoryResult(base, page([{ id: 1, message: { role: "user", content: "hi" } }]), "reconcile");

    expect(next.interactions).toEqual({});
  });

  it("reconcile clears retrying when no active run survives", () => {
    const current = session({ retrying: true });

    const next = applyHistoryResult(current, page([]), "reconcile");

    expect(next.retrying).toBe(false);
  });
});

describe("abort / fatal close / resend truncation", () => {
  it("abort finishes active runs and settles pending outbox", () => {
    const base = reduceSessionEvents(session(), [{ type: "agent_start" }], 1);
    const { session: withOutbox } = createOutboxEntry(base, "hi", undefined, false, "o1");

    const next = applyAbort(withOutbox);

    expect(next.runs.every((run) => !run.active)).toBe(true);
    expect(next.outbox[0].status).toBe("sent");
    expect(isSessionStreaming(next)).toBe(false);
  });

  it("fatal close behaves like abort", () => {
    const base = reduceSessionEvents(session(), [{ type: "agent_start" }], 1);
    const next = applyFatalClose(base);
    expect(next.runs.every((run) => !run.active)).toBe(true);
  });

  it("truncateForResend drops the failed turn so the resent message does not duplicate", () => {
    const current = session();
    current.history.messages.push(
      { role: "user", content: "q1", _messageId: 1 },
      { role: "assistant", content: "a1", _messageId: 2 },
    );
    const { session: withOutbox } = createOutboxEntry(current, "q2", undefined, false, "o1");
    withOutbox.seq += 1;
    withOutbox.runs.push({
      id: withOutbox.seq,
      active: false,
      segments: [{ content: "", toolCalls: [], finished: true, error: { message: "no model", turnError: false } }],
    });

    const next = truncateForResend(withOutbox);

    expect(messagesOf(next)).toEqual([
      { role: "user", content: "q1", _messageId: 1 },
      { role: "assistant", content: "a1", _messageId: 2 },
    ]);
  });
});
