import type { ErrorEventCode } from "@spherse/contracts";
import type { AgentEvent } from "./agent-event-parse";
import { isAssistantMessage } from "./agent-event-parse";
import { consumeOutbox, mergeHistoryPage, parseHistoryMessages } from "./history";
import { classifyErrorMessageString } from "./classify-error";
import { extractEventDetails, extractMessageText } from "./tool-card";
import type {
  ChatSessionData,
  HistoryState,
  InteractionState,
  OutboxEntry,
  RunState,
  ToolCallInfo,
} from "../types";

export type HistoryApplyMode = "reconcile" | "refresh" | "loadMore";

export interface HistoryPageResult {
  entries: unknown[];
  hasMore: boolean;
  oldestId: number | null;
}

export function createInitialSessionData(): ChatSessionData {
  return {
    history: {
      messages: [],
      hasMore: false,
      oldestLoadedId: null,
      historyStatus: "pending",
      historyError: false,
    },
    runs: [],
    outbox: [],
    interactions: {},
    seq: 0,
    pendingWithdraw: false,
    retrying: false,
    withdrawError: false,
    lastActivityAt: 0,
    scrollPosition: 0,
  };
}

export function reduceSessionEvents<T extends ChatSessionData>(
  session: T,
  events: AgentEvent[],
  now: number,
): T {
  let next: ChatSessionData = session;
  for (const event of events) {
    next = applyEvent(next, event, now);
  }
  if (next === session) return session;
  return { ...next, lastActivityAt: now } as T;
}

function applyEvent(
  session: ChatSessionData,
  event: AgentEvent,
  now: number,
): ChatSessionData {
  switch (event.type) {
    case "agent_start":
      return activateRun(settlePendingOutbox(session));
    case "run_status":
      if (event.active) return activateRun(settlePendingOutbox(session));
      return finishActiveRuns(
        dropPendingQuestionInteractions(settlePendingOutbox(session)),
      );
    case "agent_end":
      return finishActiveRuns(settlePendingOutbox(session));
    case "message_start":
    case "message_update":
    case "message_end":
      return applyMessageEvent(session, event, now);
    case "tool_execution_start":
      return applyToolStart(session, event);
    case "tool_execution_update":
      return applyToolUpdate(session, event);
    case "tool_execution_end":
      return applyToolEnd(session, event);
    case "control_request":
      return applyControlRequest(session, event);
    case "control_resolved":
      return applyControlResolved(session, event);
    case "turn_withdrawn":
      return applyTurnWithdrawn(session);
    case "error":
      return applyErrorEvent(session, event);
    default:
      return session;
  }
}

function activateRun(session: ChatSessionData): ChatSessionData {
  const activeIndex = session.runs.findIndex((run) => run.active);
  if (activeIndex >= 0) {
    if (!session.retrying && !session.withdrawError) return session;
    return { ...session, retrying: false, withdrawError: false };
  }
  const seq = session.seq + 1;
  const run: RunState = { id: seq, active: true, segments: [] };
  return {
    ...session,
    runs: [...session.runs, run],
    seq,
    retrying: false,
    withdrawError: false,
  };
}

function finishActiveRuns(session: ChatSessionData): ChatSessionData {
  if (!session.runs.some((run) => run.active)) {
    return session.retrying ? { ...session, retrying: false } : session;
  }
  const runs = session.runs.map((run) => (run.active ? { ...run, active: false } : run));
  return { ...session, runs, retrying: false };
}

function settlePendingOutbox(session: ChatSessionData): ChatSessionData {
  if (!session.outbox.some((entry) => entry.status === "pending")) return session;
  const outbox = session.outbox.map((entry) =>
    entry.status === "pending" ? { ...entry, status: "sent" as const } : entry,
  );
  return { ...session, outbox };
}

function lastRun(session: ChatSessionData): RunState | undefined {
  return session.runs[session.runs.length - 1];
}

function ensureTailRun(session: ChatSessionData): { session: ChatSessionData; run: RunState } {
  const run = lastRun(session);
  if (run) return { session, run };
  const seq = session.seq + 1;
  const created: RunState = { id: seq, active: false, segments: [] };
  return {
    session: { ...session, runs: [...session.runs, created], seq },
    run: created,
  };
}

function updateRun(
  session: ChatSessionData,
  runId: number,
  updater: (run: RunState) => RunState,
): ChatSessionData {
  let changed = false;
  const runs = session.runs.map((run) => {
    if (run.id !== runId) return run;
    const next = updater(run);
    if (next !== run) changed = true;
    return next;
  });
  return changed ? { ...session, runs } : session;
}

function applyMessageEvent(
  session: ChatSessionData,
  event:
    | { type: "message_start"; message: unknown }
    | { type: "message_update"; message: unknown }
    | { type: "message_end"; message: unknown },
  now: number,
): ChatSessionData {
  const message = event.message;
  if (!isAssistantMessage(message)) return session;
  const { session: withRun, run } = ensureTailRun(session);
  const segments = run.segments;

  if (event.type === "message_start") {
    const last = segments[segments.length - 1];
    if (last && !last.finished) return withRun;
    return updateRun(withRun, run.id, (r) => ({
      ...r,
      segments: [...r.segments, { content: "", toolCalls: [], finished: false }],
    }));
  }

  if (event.type === "message_update") {
    const text = extractMessageText(message.content);
    const last = segments[segments.length - 1];
    if (last && !last.finished) {
      if (last.content === text) return withRun;
      return updateRun(withRun, run.id, (r) => ({
        ...r,
        segments: [
          ...r.segments.slice(0, -1),
          { ...last, content: text },
        ],
      }));
    }
    if (!text) return withRun;
    return updateRun(withRun, run.id, (r) => ({
      ...r,
      segments: [...r.segments, { content: text, toolCalls: [], finished: false }],
    }));
  }

  const text = extractMessageText(message.content);
  const isError = message.stopReason === "error";
  const error = isError ? message.errorMessage ?? "Unknown error" : undefined;
  const timestamp = message.timestamp ?? now;
  const last = segments[segments.length - 1];
  if (last && !last.finished) {
    return updateRun(withRun, run.id, (r) => ({
      ...r,
      segments: [
        ...r.segments.slice(0, -1),
        {
          ...last,
          content: text,
          finished: true,
          timestamp,
          ...(error
            ? { error: { message: error, code: classifyErrorMessageString(error), turnError: true } }
            : {}),
        },
      ],
    }));
  }
  if (text || error) {
    return updateRun(withRun, run.id, (r) => ({
      ...r,
      segments: [
        ...r.segments,
        {
          content: text,
          toolCalls: [],
          finished: true,
          timestamp,
          ...(error
            ? { error: { message: error, code: classifyErrorMessageString(error), turnError: true } }
            : {}),
        },
      ],
    }));
  }
  return withRun;
}

function applyToolStart(
  session: ChatSessionData,
  event: Extract<AgentEvent, { type: "tool_execution_start" }>,
): ChatSessionData {
  const { session: withRun, run } = ensureTailRun(session);
  const segments = run.segments;
  const last = segments[segments.length - 1];
  if (last && last.toolCalls.some((tc) => tc.toolCallId === event.toolCallId)) {
    return withRun;
  }
  const toolCall: ToolCallInfo = {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    args: event.args,
    status: "running",
  };
  if (last) {
    return updateRun(withRun, run.id, (r) => ({
      ...r,
      segments: [
        ...r.segments.slice(0, -1),
        { ...last, toolCalls: [...last.toolCalls, toolCall] },
      ],
    }));
  }
  return updateRun(withRun, run.id, (r) => ({
    ...r,
    segments: [{ content: "", toolCalls: [toolCall], finished: false }],
  }));
}

function findToolCallLocation(
  session: ChatSessionData,
  toolCallId: string,
): { runId: number; segmentIndex: number; toolCallIndex: number } | undefined {
  for (let runIndex = session.runs.length - 1; runIndex >= 0; runIndex--) {
    const run = session.runs[runIndex];
    for (let segIndex = run.segments.length - 1; segIndex >= 0; segIndex--) {
      const toolCallIndex = run.segments[segIndex].toolCalls.findIndex(
        (tc) => tc.toolCallId === toolCallId,
      );
      if (toolCallIndex >= 0) {
        return { runId: run.id, segmentIndex: segIndex, toolCallIndex };
      }
    }
  }
  return undefined;
}

function updateToolCall(
  session: ChatSessionData,
  toolCallId: string,
  updater: (toolCall: ToolCallInfo) => ToolCallInfo,
): ChatSessionData {
  const location = findToolCallLocation(session, toolCallId);
  if (!location) return session;
  const { runId, segmentIndex, toolCallIndex } = location;
  return updateRun(session, runId, (run) => {
    const segment = run.segments[segmentIndex];
    const toolCall = segment.toolCalls[toolCallIndex];
    const nextToolCall = updater(toolCall);
    if (nextToolCall === toolCall) return run;
    const toolCalls = segment.toolCalls.slice();
    toolCalls[toolCallIndex] = nextToolCall;
    const segments = run.segments.slice();
    segments[segmentIndex] = { ...segment, toolCalls };
    return { ...run, segments };
  });
}

function applyToolUpdate(
  session: ChatSessionData,
  event: Extract<AgentEvent, { type: "tool_execution_update" }>,
): ChatSessionData {
  const partialDetails = extractEventDetails(event.partialResult);
  return updateToolCall(session, event.toolCallId, (toolCall) => {
    const partialResult =
      typeof event.partialResult === "string"
        ? event.partialResult
        : JSON.stringify(event.partialResult);
    const changed =
      toolCall.partialResult !== partialResult || toolCall.partialDetails !== partialDetails;
    if (!changed) return toolCall;
    return {
      ...toolCall,
      partialResult,
      ...(partialDetails !== undefined ? { partialDetails } : {}),
    };
  });
}

function applyToolEnd(
  session: ChatSessionData,
  event: Extract<AgentEvent, { type: "tool_execution_end" }>,
): ChatSessionData {
  const resultDetails = extractEventDetails(event.result);
  return updateToolCall(session, event.toolCallId, (toolCall) => {
    const result =
      typeof event.result === "string" ? event.result : JSON.stringify(event.result);
    const status = event.isError ? ("error" as const) : ("completed" as const);
    if (
      toolCall.status === status &&
      toolCall.result === result &&
      toolCall.resultDetails === resultDetails &&
      toolCall.isError === event.isError
    ) {
      return toolCall;
    }
    return {
      ...toolCall,
      status,
      result,
      resultDetails,
      isError: event.isError,
    };
  });
}

function applyControlRequest(
  session: ChatSessionData,
  event: Extract<AgentEvent, { type: "control_request" }>,
): ChatSessionData {
  if (event.kind !== "approval" && event.kind !== "question") return session;
  if (!findToolCallLocation(session, event.toolCallId)) return session;
  const interaction: InteractionState = {
    kind: event.kind,
    requestId: event.requestId,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    status: { type: "pending" },
  };
  return { ...session, interactions: { ...session.interactions, [event.requestId]: interaction } };
}

function applyControlResolved(
  session: ChatSessionData,
  event: Extract<AgentEvent, { type: "control_resolved" }>,
): ChatSessionData {
  const existing = session.interactions[event.requestId];
  if (!existing || existing.kind !== event.kind) return session;
  let status: InteractionState["status"];
  if (event.kind === "question") {
    status = event.timedOut
      ? { type: "timeout" }
      : { type: "answered", answer: event.answer ?? "" };
  } else {
    status = event.approved ? { type: "approved" } : { type: "rejected" };
  }
  return {
    ...session,
    interactions: {
      ...session.interactions,
      [event.requestId]: { ...existing, status },
    },
  };
}

function dropPendingQuestionInteractions(session: ChatSessionData): ChatSessionData {
  let changed = false;
  const interactions: Record<string, InteractionState> = {};
  for (const [requestId, interaction] of Object.entries(session.interactions)) {
    if (interaction.kind === "question" && interaction.status.type === "pending") {
      changed = true;
      continue;
    }
    interactions[requestId] = interaction;
  }
  return changed ? { ...session, interactions } : session;
}

function applyErrorEvent(
  session: ChatSessionData,
  event: Extract<AgentEvent, { type: "error" }>,
): ChatSessionData {
  let next = finishActiveRuns(settlePendingOutbox(session));
  if (next.pendingWithdraw) {
    next = { ...next, pendingWithdraw: false, withdrawError: true };
  }
  const { session: withRun, run } = ensureTailRun(next);
  const segments = run.segments;
  const last = segments[segments.length - 1];
  const error = {
    message: event.message,
    ...(event.code ? { code: event.code as ErrorEventCode } : {}),
    turnError: false,
  };
  if (last && !last.finished && !last.error) {
    return updateRun(withRun, run.id, (r) => ({
      ...r,
      segments: [
        ...r.segments.slice(0, -1),
        { ...last, error: { ...error, turnError: true } },
      ],
    }));
  }
  return updateRun(withRun, run.id, (r) => ({
    ...r,
    segments: [...r.segments, { content: "", toolCalls: [], finished: true, error }],
  }));
}

function applyTurnWithdrawn(session: ChatSessionData): ChatSessionData {
  const truncated = truncateAtLastUser(session);
  if (truncated === session) return session;
  return { ...truncated, interactions: {}, pendingWithdraw: false };
}

function truncateAtLastUser(session: ChatSessionData): ChatSessionData {
  for (let i = session.outbox.length - 1; i >= 0; i--) {
    if (session.outbox[i].status === "failed") continue;
    const seq = session.outbox[i].seq;
    return {
      ...session,
      outbox: session.outbox.slice(0, i),
      runs: session.runs.filter((run) => run.id < seq),
    };
  }
  const messages = session.history.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    return {
      ...session,
      history: { ...session.history, messages: messages.slice(0, i) },
      runs: [],
      outbox: [],
    };
  }
  return session;
}

export function applyAbort<T extends ChatSessionData>(session: T): T {
  return finishActiveRuns(settlePendingOutbox(session)) as T;
}

export function applyFatalClose<T extends ChatSessionData>(session: T): T {
  return applyAbort(session);
}

export function createOutboxEntry<T extends ChatSessionData>(
  session: T,
  content: string,
  attachments: OutboxEntry["attachments"],
  failed: boolean,
  id: string,
): { session: T; entry: OutboxEntry } {
  const seq = session.seq + 1;
  const entry: OutboxEntry = {
    id,
    seq,
    content,
    ...(attachments ? { attachments } : {}),
    timestamp: Date.now(),
    status: failed ? "failed" : "pending",
    sentAfterMessageId: session.history.messages.reduce<number | null>(
      (max, message) =>
        message._messageId !== undefined && message._messageId > (max ?? 0)
          ? message._messageId
          : max,
      null,
    ),
  };
  return {
    session: { ...session, outbox: [...session.outbox, entry], seq } as T,
    entry,
  };
}

export function applyHistoryResult<T extends ChatSessionData>(
  session: T,
  result: HistoryPageResult,
  mode: HistoryApplyMode,
): T {
  const incoming = parseHistoryMessages(result.entries);
  const history: HistoryState = {
    messages: mergeHistoryPage(session.history.messages, incoming),
    hasMore: result.hasMore,
    oldestLoadedId: result.oldestId,
    historyStatus: "ready",
    historyError: false,
  };

  let outbox = session.outbox;
  if (mode === "reconcile" || mode === "refresh") {
    outbox = consumeOutbox(outbox, history.messages);
  }

  const errorContents = new Set(
    history.messages
      .filter((message) => message._error !== undefined)
      .map((message) => message._error),
  );

  const keepErrorRun = (run: RunState) =>
    run.segments.some(
      (segment) => segment.error !== undefined && !errorContents.has(segment.error.message),
    );

  let seq = session.seq;
  const runs: RunState[] = [];
  if (mode === "reconcile") {
    const droppedActive = session.runs.find((run) => run.active);
    if (droppedActive) seq = Math.min(seq, droppedActive.id - 1);
    for (const run of session.runs) {
      if (run.active) continue;
      if (keepErrorRun(run)) runs.push(run);
    }
  } else {
    for (const run of session.runs) {
      if (run.active || keepErrorRun(run)) runs.push(run);
    }
  }

  const interactions = filterInteractionsByRuns(session.interactions, runs);
  const retrying = mode === "reconcile" && !runs.some((run) => run.active) ? false : session.retrying;

  return {
    ...session,
    history,
    outbox,
    runs,
    seq,
    interactions,
    retrying,
  } as T;
}

function filterInteractionsByRuns(
  interactions: Record<string, InteractionState>,
  runs: RunState[],
): Record<string, InteractionState> {
  const toolCallIds = new Set<string>();
  for (const run of runs) {
    for (const segment of run.segments) {
      for (const toolCall of segment.toolCalls) {
        toolCallIds.add(toolCall.toolCallId);
      }
    }
  }
  let changed = false;
  const next: Record<string, InteractionState> = {};
  for (const [requestId, interaction] of Object.entries(interactions)) {
    if (toolCallIds.has(interaction.toolCallId)) {
      next[requestId] = interaction;
    } else {
      changed = true;
    }
  }
  return changed ? next : interactions;
}

export function applyRetryLast<T extends ChatSessionData>(session: T): T {
  let next = { ...session, retrying: true } as T;
  for (let runIndex = next.runs.length - 1; runIndex >= 0; runIndex--) {
    const run = next.runs[runIndex];
    const segments = run.segments;
    for (let segIndex = segments.length - 1; segIndex >= 0; segIndex--) {
      if (!segments[segIndex].error) continue;
      const runs = next.runs.slice();
      const nextSegments = segments.slice();
      const { error: _error, ...rest } = segments[segIndex];
      nextSegments[segIndex] = rest.finished ? { ...rest, finished: false } : rest;
      runs[runIndex] = { ...run, segments: nextSegments, active: true };
      return { ...next, runs } as T;
    }
  }
  const messages = next.history.messages;
  let end = messages.length;
  while (end > 0 && messages[end - 1].role === "assistant" && messages[end - 1]._error) {
    end--;
  }
  if (end !== messages.length) {
    next = { ...next, history: { ...next.history, messages: messages.slice(0, end) } } as T;
  }
  return next;
}

export function truncateForResend<T extends ChatSessionData>(session: T): T {
  return truncateAtLastUser(session) as T;
}

export function beginHistorySync<T extends ChatSessionData>(session: T): T {
  if (session.history.historyStatus === "syncing") return session;
  return { ...session, history: { ...session.history, historyStatus: "syncing" } } as T;
}

export function markHistoryInterrupted<T extends ChatSessionData>(
  session: T,
  wasReady: boolean,
): T {
  if (session.history.historyStatus !== "syncing") return session;
  return {
    ...session,
    history: {
      ...session.history,
      historyStatus: wasReady ? "ready" : "pending",
    },
  } as T;
}

export function markHistoryFailed<T extends ChatSessionData>(
  session: T,
  wasReady: boolean,
): T {
  return {
    ...session,
    history: {
      ...session.history,
      historyStatus: wasReady ? "ready" : "pending",
      historyError: !wasReady,
    },
  } as T;
}
