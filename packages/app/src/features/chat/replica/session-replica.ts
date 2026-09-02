import type { AgentMessage } from "@spherse/core";
import type { AgentEvent } from "../model/agent-event-parse";
import { isAssistantMessage } from "../model/agent-event-parse";
import type { SendableImage } from "../types";
import {
  applyLoadMore,
  applySettledFrame,
  applySnapshot,
  enterSnapshotMode,
  type DurableZone,
  initialDurable,
} from "./durable";
import {
  initialRunTail,
  reduceRunTail,
  type RunTail,
} from "./run-tail";
import {
  addIntent,
  failIntent,
  initialPending,
  removeIntent,
  setWithdrawInFlight,
  type PendingIntent,
  type PendingZone,
} from "./intents";
import {
  appendNotice,
  clearNoticesCoveredByDeletion,
  clearNoticesOnDurableError,
  clearRunErrorNotices,
  initialNotices,
  nextNoticeId,
  type NoticesZone,
} from "./notices";

export type ReplicaSnapshotInput = {
  entries: Array<{ id: number; message: AgentMessage; source?: "triggered"; triggerName?: string }>;
  hasMore: boolean;
  oldestId: number | null;
};

export type ReplicaInternalFrame =
  | { type: "connecting" }
  | { type: "connected" }
  | { type: "disconnected"; fatal: boolean }
  | { type: "replayCompleted" }
  | { type: "reconnectFailed" }
  | { type: "syncStarted" }
  | { type: "syncSucceeded" }
  | { type: "syncFailed" }
  | { type: "snapshotApplied"; snapshot: ReplicaSnapshotInput; full: boolean }
  | { type: "loadMoreApplied"; page: ReplicaSnapshotInput }
  | { type: "legacySnapshotMode" }
  | { type: "runKilled" };

export type ReplicaFrame = AgentEvent | ReplicaInternalFrame;

export interface SessionReplica {
  durable: DurableZone;
  run: RunTail;
  pending: PendingZone;
  notices: NoticesZone;
  connectionStatus: "disconnected" | "connecting" | "open";
  historyStatus: "pending" | "syncing" | "ready";
  historyError: boolean;
  reconnectFailed: boolean;
  everReady: boolean;
}

export function initialReplica(): SessionReplica {
  return {
    durable: initialDurable(),
    run: initialRunTail(),
    pending: initialPending(),
    notices: initialNotices(),
    connectionStatus: "disconnected",
    historyStatus: "pending",
    historyError: false,
    reconnectFailed: false,
    everReady: false,
  };
}

export function reduceReplica(state: SessionReplica, frame: ReplicaFrame, now: number): SessionReplica {
  if (isInternalFrame(frame)) {
    return reduceInternal(state, frame);
  }
  return reduceServerEvent(state, frame, now);
}

const INTERNAL_FRAME_TYPES: ReadonlySet<string> = new Set([
  "connecting",
  "connected",
  "disconnected",
  "replayCompleted",
  "reconnectFailed",
  "syncStarted",
  "syncSucceeded",
  "syncFailed",
  "snapshotApplied",
  "loadMoreApplied",
  "legacySnapshotMode",
  "runKilled",
]);

function isInternalFrame(frame: ReplicaFrame): frame is ReplicaInternalFrame {
  return INTERNAL_FRAME_TYPES.has(frame.type);
}

function reduceServerEvent(state: SessionReplica, event: AgentEvent, now: number): SessionReplica {
  let durable = state.durable;
  let run = state.run;
  let pending = state.pending;
  let notices = state.notices;

  switch (event.type) {
    case "message_end": {
      if (event.seq !== undefined) {
        const outcome = applySettledFrame(durable, {
          type: "message_settled",
          seq: event.seq,
          message: event.message,
        });
        durable = outcome.durable;
        if (outcome.entry && isAssistantMessage(event.message) && event.message.stopReason === "error") {
          notices = clearNoticesOnDurableError(notices, event.seq);
        }
      }
      run = reduceRunTail(run, event, { highSeq: durable.highSeq, now });
      return assemble(state, durable, run, pending, notices);
    }
    case "message_settled": {
      const outcome = applySettledFrame(durable, event);
      durable = outcome.durable;
      if (event.intentId !== undefined) {
        pending = removeIntent(pending, event.intentId);
      }
      if (isAssistantMessage(event.message) && event.message.stopReason === "error") {
        notices = clearNoticesOnDurableError(notices, event.seq);
      }
      if (event.message.role === "user") {
        notices = clearRunErrorNotices(notices);
      }
      if (isAssistantMessage(event.message)) {
        run = { ...run, draft: run.draft?._streaming ? null : run.draft };
      }
      return assemble(state, durable, run, pending, notices);
    }
    case "turn_withdrawn": {
      const outcome = applySettledFrame(durable, event);
      durable = outcome.durable;
      pending = setWithdrawInFlight(pending, false);
      notices = clearNoticesCoveredByDeletion(
        notices,
        event.seq,
        event.upTo ?? event.seq + 1,
      );
      return assemble(state, durable, run, pending, notices);
    }
    case "turn_retried": {
      const outcome = applySettledFrame(durable, event);
      durable = outcome.durable;
      run = { ...run, retrying: false };
      return assemble(state, durable, run, pending, notices);
    }
    case "error": {
      if (pending.withdrawInFlight) {
        pending = setWithdrawInFlight(pending, false);
        notices = appendNotice(notices, {
          id: nextNoticeId(),
          kind: "withdrawFailed",
          bornAtSeq: durable.highSeq,
          message: event.message,
          ...(event.code !== undefined ? { code: event.code } : {}),
          turnError: false,
        });
        return assemble(state, durable, run, pending, notices);
      }
      if (!run.active && pending.lastSendingId !== null) {
        pending = failIntent(pending, pending.lastSendingId);
      }
      const turnError = run.draft?._streaming === true;
      if (turnError) {
        run = { ...run, draft: run.draft ? { ...run.draft, _streaming: false } : null };
      }
      notices = appendNotice(notices, {
        id: nextNoticeId(),
        kind: "error",
        bornAtSeq: durable.highSeq,
        message: event.message,
        ...(event.code !== undefined ? { code: event.code } : {}),
        turnError,
      });
      return assemble(state, durable, run, pending, notices);
    }
    default: {
      run = reduceRunTail(run, event, { highSeq: durable.highSeq, now });
      return assemble(state, durable, run, pending, notices);
    }
  }
}

function reduceInternal(state: SessionReplica, frame: ReplicaInternalFrame): SessionReplica {
  switch (frame.type) {
    case "connecting":
      return { ...state, connectionStatus: "connecting", reconnectFailed: false };
    case "connected":
      return { ...state, connectionStatus: "open" };
    case "disconnected": {
      const run = frame.fatal ? endRunForFatal(state.run) : state.run;
      return { ...state, connectionStatus: "disconnected", run };
    }
    case "replayCompleted":
      return state;
    case "reconnectFailed":
      return { ...state, reconnectFailed: true };
    case "syncStarted":
      return { ...state, historyStatus: "syncing" };
    case "syncSucceeded": {
      let pending = state.pending;
      if (pending.lastSendingId !== null) {
        pending = failIntent(pending, pending.lastSendingId);
      }
      const run = state.run.active
        ? state.run
        : { ...state.run, draft: null, tools: [] };
      const durable = state.durable.mode === "unknown"
        ? { ...state.durable, mode: "events" as const }
        : state.durable;
      return { ...state, historyStatus: "ready", historyError: false, everReady: true, pending, run, durable };
    }
    case "syncFailed": {
      return {
        ...state,
        historyStatus: state.everReady ? "ready" : "pending",
        historyError: !state.everReady,
      };
    }
    case "snapshotApplied": {
      const durable = applySnapshot(state.durable, { ...frame.snapshot, full: frame.full });
      return { ...state, durable };
    }
    case "loadMoreApplied": {
      const durable = applyLoadMore(state.durable, frame.page);
      return { ...state, durable };
    }
    case "legacySnapshotMode": {
      const durable = enterSnapshotMode(state.durable);
      return { ...state, durable };
    }
    case "runKilled": {
      const run = state.run.active
        ? { ...state.run, active: false, draft: state.run.draft ? { ...state.run.draft, _streaming: false } : null }
        : state.run;
      return { ...state, run };
    }
  }
}

function endRunForFatal(run: RunTail): RunTail {
  return {
    ...run,
    active: false,
    draft: run.draft ? { ...run.draft, _streaming: false } : null,
  };
}

function assemble(
  state: SessionReplica,
  durable: DurableZone,
  run: RunTail,
  pending: PendingZone,
  notices: NoticesZone,
): SessionReplica {
  if (
    durable === state.durable &&
    run === state.run &&
    pending === state.pending &&
    notices === state.notices
  ) {
    return state;
  }
  return { ...state, durable, run, pending, notices };
}

export interface SendPlan {
  intent: PendingIntent;
  frame: { type: "message"; content: string; attachments?: Array<{ type: string; path: string; mimeType: string }>; intentId: string } | null;
}

export function planSend(
  state: SessionReplica,
  input: { content: string; attachment?: SendableImage; intentId: string; socketOpen: boolean; now: number },
): SendPlan | null {
  const content = input.content.trim();
  if (!content) return null;
  if (state.run.active || state.pending.intents.some((intent) => intent.state === "sending")) return null;
  const attachments = input.attachment
    ? [{ type: "image" as const, path: input.attachment.path, mimeType: input.attachment.mimeType }]
    : undefined;
  const intent: PendingIntent = {
    intentId: input.intentId,
    content,
    ...(input.attachment ? { attachment: input.attachment } : {}),
    state: input.socketOpen ? ("sending" as const) : ("failed" as const),
    createdAt: input.now,
  };
  return {
    intent,
    frame: input.socketOpen
      ? {
          type: "message",
          content,
          ...(attachments ? { attachments } : {}),
          intentId: input.intentId,
        }
      : null,
  };
}

export function queueInitialIntent(
  state: SessionReplica,
  input: { content: string; intentId: string; now: number },
): { state: SessionReplica; intent: PendingIntent } {
  const intent: PendingIntent = {
    intentId: input.intentId,
    content: input.content,
    state: "queued",
    createdAt: input.now,
  };
  return {
    state: { ...state, pending: addIntent(state.pending, intent) },
    intent,
  };
}

export function markIntentSending(pending: PendingZone, intentId: string): PendingZone {
  return {
    ...pending,
    intents: pending.intents.map((intent) => (
      intent.intentId === intentId && intent.state === "queued"
        ? { ...intent, state: "sending" as const }
        : intent
    )),
    lastSendingId: intentId,
  };
}
