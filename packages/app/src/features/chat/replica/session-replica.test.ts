import { describe, expect, it } from "vitest";
import { ErrorEventCode } from "@spherse/contracts";
import type { AgentMessage } from "@spherse/core";
import {
  initialReplica,
  planSend,
  queueInitialIntent,
  reduceReplica,
} from "./session-replica";
import { deriveReplica } from "./derive";

const NOW = 1000;

function userMessage(content: string, timestamp = 1): AgentMessage {
  return { role: "user", content, timestamp };
}

function assistantMessage(text: string, extra?: { stopReason?: string; errorMessage?: string }): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: 2,
    ...extra,
  } as unknown as AgentMessage;
}

function assistantEvent(text: string): AgentMessage {
  return assistantMessage(text);
}

function run(frames: Parameters<typeof reduceReplica>[1][], from = initialReplica()) {
  let state = from;
  for (const frame of frames) {
    state = reduceReplica(state, frame, NOW);
  }
  return state;
}

describe("session replica: confirm frames", () => {
  it("settles user/assistant/toolResult frames by seq and renders them in order", () => {
    const state = run([
      { type: "message_settled", seq: 0, message: userMessage("q"), intentId: "i1" },
      { type: "message_settled", seq: 1, message: assistantMessage("a") },
    ]);
    expect(state.durable.entries.map((entry) => entry.seq)).toEqual([0, 1]);
    expect(state.durable.highSeq).toBe(1);
  });

  it("is idempotent across message_end{seq} and message_settled{seq} in any order and repetition", () => {
    const end = { type: "message_end" as const, message: assistantMessage("a"), seq: 2 };
    const settled = { type: "message_settled" as const, seq: 2, message: assistantMessage("a") };

    const settledFirst = run([settled, end, settled]);
    const endFirst = run([end, settled, end]);

    expect(settledFirst.durable.entries).toHaveLength(1);
    expect(endFirst.durable.entries).toHaveLength(1);
    const view = deriveReplica(settledFirst);
    expect(view.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
  });

  it("hands settle ownership from the run draft to durable without duplication", () => {
    const state = run([
      { type: "agent_start" },
      { type: "message_start", message: assistantEvent("") },
      { type: "message_update", message: assistantEvent("hi") },
      { type: "message_end", message: assistantEvent("hi"), seq: 3 },
      { type: "message_settled", seq: 3, message: assistantMessage("hi") },
    ]);
    expect(state.run.draft).toBeNull();
    const view = deriveReplica(state);
    expect(view.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(view.messages.filter((message) => message.role === "assistant")[0]).toMatchObject({ content: "hi" });
  });

  it("closes the streaming draft on a bare message_settled frame (missed transient end)", () => {
    const state = run([
      { type: "agent_start" },
      { type: "message_start", message: assistantEvent("") },
      { type: "message_update", message: assistantEvent("x") },
      { type: "message_settled", seq: 2, message: assistantMessage("x") },
    ]);
    expect(state.run.draft).toBeNull();
    const view = deriveReplica(state);
    expect(view.messages).toHaveLength(1);
    expect(view.messages[0]).toMatchObject({ content: "x" });
    expect(view.messages[0]._streaming).toBeFalsy();
  });
});

describe("session replica: intents", () => {
  it("removes the pending intent when its user message settles with the intentId", () => {
    const plan = planSend(initialReplica(), {
      content: "hello",
      intentId: "i1",
      socketOpen: true,
      now: NOW,
    });
    expect(plan?.intent.state).toBe("sending");
    expect(plan?.frame).toMatchObject({ type: "message", content: "hello", intentId: "i1" });

    let state = run([{ type: "connected" }], initialReplica());
    state = { ...state, pending: { ...state.pending, intents: [plan!.intent], lastSendingId: "i1" } };
    const view = deriveReplica(state);
    expect(view.messages.at(-1)).toMatchObject({ role: "user", content: "hello", _optimistic: true });
    expect(view.streaming).toBe(true);

    state = run([{ type: "message_settled", seq: 0, message: userMessage("hello"), intentId: "i1" }], state);
    expect(state.pending.intents).toHaveLength(0);
    expect(deriveReplica(state).messages.at(-1)).toMatchObject({ role: "user", content: "hello", _messageId: 0 });
    expect(deriveReplica(state).messages.at(-1)?._optimistic).toBeUndefined();
  });

  it("marks the sending intent failed when a send error arrives with no run active", () => {
    const plan = planSend(initialReplica(), { content: "hi", intentId: "i1", socketOpen: true, now: NOW });
    let state = initialReplica();
    state = { ...state, pending: { ...state.pending, intents: [plan!.intent], lastSendingId: "i1" } };

    state = run([{ type: "error", message: "session busy", code: ErrorEventCode.Permanent }], state);

    expect(state.pending.intents[0].state).toBe("failed");
    const view = deriveReplica(state);
    expect(view.messages).toHaveLength(2);
    expect(view.messages[0]).toMatchObject({ role: "user", content: "hi", _sendFailed: true });
    expect(view.messages[1]).toMatchObject({ role: "assistant", _error: "session busy" });
    expect(view.streaming).toBe(false);
  });

  it("creates the intent as failed immediately when the socket is not open", () => {
    const plan = planSend(initialReplica(), { content: "hi", intentId: "i1", socketOpen: false, now: NOW });
    expect(plan?.intent.state).toBe("failed");
    expect(plan?.frame).toBeNull();
  });

  it("queues the initial message as a queued intent that only renders once sent", () => {
    let state = initialReplica();
    const queued = queueInitialIntent(state, { content: "first", intentId: "i0", now: NOW });
    state = queued.state;
    expect(deriveReplica(state).messages).toHaveLength(0);

    state = { ...state, pending: { ...state.pending, intents: state.pending.intents.map((intent) => intent.intentId === "i0" ? { ...intent, state: "sending" as const } : intent), lastSendingId: "i0" } };
    expect(deriveReplica(state).messages.at(-1)).toMatchObject({ content: "first", _optimistic: true });
  });
});

describe("session replica: withdraw / retry", () => {
  it("applies turn_withdrawn by deleting the [seq, upTo) range and clearing withdrawInFlight", () => {
    let state = initialReplica();
    state = run([
      { type: "message_settled", seq: 0, message: userMessage("q1") },
      { type: "message_settled", seq: 1, message: assistantMessage("a1") },
      { type: "message_settled", seq: 2, message: userMessage("q2") },
      { type: "message_settled", seq: 3, message: assistantMessage("a2") },
    ], state);
    state = { ...state, pending: { ...state.pending, withdrawInFlight: true } };

    state = run([{ type: "turn_withdrawn", seq: 2, upTo: 4 }], state);

    expect(state.durable.entries.map((entry) => entry.seq)).toEqual([0, 1]);
    expect(state.pending.withdrawInFlight).toBe(false);
    expect(deriveReplica(state).messages).toHaveLength(2);
  });

  it("applies turn_retried by deleting abandoned seqs", () => {
    let state = run([
      { type: "message_settled", seq: 0, message: userMessage("q") },
      { type: "message_settled", seq: 1, message: assistantMessage("bad", { stopReason: "error", errorMessage: "timeout" }) },
    ]);
    state = run([{ type: "turn_retried", seq: 2, abandonedSeqs: [1] }], state);
    expect(state.durable.entries.map((entry) => entry.seq)).toEqual([0]);
    expect(state.run.retrying).toBe(false);
  });

  it("records a withdrawFailed notice when the withdraw errors, suppressing retry", () => {
    let state = run([{ type: "message_settled", seq: 0, message: userMessage("q") }]);
    state = { ...state, pending: { ...state.pending, withdrawInFlight: true } };

    state = run([{ type: "error", message: "nothing to withdraw", code: ErrorEventCode.Permanent }], state);

    expect(state.pending.withdrawInFlight).toBe(false);
    expect(state.notices.items[0].kind).toBe("withdrawFailed");
    const view = deriveReplica(state);
    expect(view.messages.at(-1)).toMatchObject({ _error: "nothing to withdraw", _withdrawError: true });
  });
});

describe("session replica: notices", () => {
  it("attaches a mid-turn error to the streaming draft with turnError semantics", () => {
    const state = run([
      { type: "agent_start" },
      { type: "message_start", message: assistantEvent("") },
      { type: "message_update", message: assistantEvent("partial") },
      { type: "error", message: "model overloaded", code: ErrorEventCode.Transient },
    ]);
    const view = deriveReplica(state);
    expect(view.messages.at(-1)).toMatchObject({
      content: "partial",
      _streaming: false,
      _error: "model overloaded",
      _turnError: true,
    });
  });

  it("clears the error notice once a later durable error entry settles", () => {
    let state = run([
      { type: "message_settled", seq: 0, message: userMessage("q") },
      { type: "error", message: "boom", code: ErrorEventCode.Transient },
    ]);
    expect(state.notices.items).toHaveLength(1);

    state = run([
      { type: "message_settled", seq: 1, message: assistantMessage("", { stopReason: "error", errorMessage: "boom" }) },
    ], state);
    expect(state.notices.items).toHaveLength(0);
  });

  it("clears error notices when any subsequent user message settles (fallback rule)", () => {
    let state = run([{ type: "error", message: "boom", code: ErrorEventCode.Transient }]);
    state = run([{ type: "message_settled", seq: 3, message: userMessage("again") }], state);
    expect(state.notices.items).toHaveLength(0);
  });

  it("clears notices covered by a withdrawal deletion range", () => {
    let state = run([
      { type: "message_settled", seq: 0, message: userMessage("q") },
      { type: "error", message: "boom", code: ErrorEventCode.Transient },
    ]);
    state = run([{ type: "turn_withdrawn", seq: 0, upTo: 1 }], state);
    expect(state.notices.items).toHaveLength(0);
  });
});

describe("session replica: lifecycle frames", () => {
  it("tracks connection status through internal frames", () => {
    let state = run([{ type: "connecting" }]);
    expect(state.connectionStatus).toBe("connecting");
    state = run([{ type: "connected" }], state);
    expect(state.connectionStatus).toBe("open");
    state = run([{ type: "disconnected", fatal: false }], state);
    expect(state.connectionStatus).toBe("disconnected");
  });

  it("keeps the run streaming across a non-fatal disconnect but freezes it on a fatal close", () => {
    let state = run([
      { type: "agent_start" },
      { type: "message_start", message: assistantEvent("") },
      { type: "message_update", message: assistantEvent("x") },
    ]);
    const afterSoftClose = run([{ type: "disconnected", fatal: false }], state);
    expect(afterSoftClose.run.active).toBe(true);
    expect(deriveReplica(afterSoftClose).streaming).toBe(true);

    const afterFatal = run([{ type: "disconnected", fatal: true }], state);
    expect(afterFatal.run.active).toBe(false);
    expect(afterFatal.run.draft?._streaming).toBe(false);
  });

  it("syncSucceeded fails still-sending intents and discards a stale run tail when inactive", () => {
    let state = run([
      { type: "agent_start" },
      { type: "message_start", message: assistantEvent("") },
      { type: "message_update", message: assistantEvent("orphan") },
      { type: "run_status", active: false },
    ]);
    state = { ...state, pending: { ...state.pending, intents: [{ intentId: "i9", content: "lost", state: "sending", createdAt: 1, seenDisconnect: true }], lastSendingId: "i9" } };

    state = run([{ type: "syncSucceeded" }], state);

    expect(state.pending.intents[0].state).toBe("failed");
    expect(state.run.draft).toBeNull();
    expect(state.historyStatus).toBe("ready");
    expect(state.everReady).toBe(true);
  });

  it("keeps the run tail when the sync succeeds during an active run", () => {
    let state = run([
      { type: "agent_start" },
      { type: "message_start", message: assistantEvent("") },
    ]);
    state = run([{ type: "syncSucceeded" }], state);
    expect(state.run.active).toBe(true);
    expect(state.run.draft).not.toBeNull();
  });

  it("maps sync failure onto the pre-ready error surface only", () => {
    let state = run([{ type: "syncStarted" }]);
    expect(state.historyStatus).toBe("syncing");
    state = run([{ type: "syncFailed" }], state);
    expect(state.historyStatus).toBe("pending");
    expect(state.historyError).toBe(true);

    state = run([{ type: "syncStarted" }, { type: "syncSucceeded" }, { type: "syncStarted" }, { type: "syncFailed" }], state);
    expect(state.historyStatus).toBe("ready");
    expect(state.historyError).toBe(false);
  });

  it("marks legacy snapshot mode and drops snapshot entries on the first eventized frame", () => {
    let state = run([
      {
        type: "snapshotApplied",
        snapshot: {
          entries: [
            { id: 5, message: userMessage("legacy"), source: "triggered", triggerName: "cron" },
            { id: 6, message: assistantMessage("legacy reply") },
          ],
          hasMore: false,
          oldestId: 5,
        },
        full: false,
      },
      { type: "legacySnapshotMode" },
    ]);
    expect(state.durable.mode).toBe("snapshot");
    expect(state.durable.highSeq).toBeNull();
    expect(deriveReplica(state).messages).toHaveLength(2);

    state = run([{ type: "message_settled", seq: 0, message: userMessage("fresh") }], state);
    expect(state.durable.entries.map((entry) => entry.seq)).toEqual([0]);
    expect(deriveReplica(state).messages).toHaveLength(1);
  });
});
