import type { ChatReplayEvent } from "@spherse/contracts";
import { isUserMessage } from "./agent-event-parse";
import { extractMessageText, extractToolCalls } from "./chat-tool-projection";
import { classifyErrorMessageString } from "./classify-error";
import {
  isAssistantEntry,
  persistedEntryId,
  toolResultEntryId,
  type AssistantEntry,
  type ControlProjection,
  type ToolCallRef,
  type ToolResultEntry,
} from "./entry";
import {
  advanceCursor,
  attachToolResultOwner,
  clearPendingControls,
  findToolCallOwner,
  pruneRefs,
  removeSeqInterval,
  removeSeqs,
  replaceAt,
  settleUserEntry,
  type ChatEntryState,
} from "./entry-state";

export function applyPersistedEvents<T extends ChatEntryState>(
  state: T,
  events: ChatReplayEvent[],
  now: number,
): T {
  let next: ChatEntryState = state;
  for (const event of events) {
    next = applyPersistedEvent(next, event, now);
  }
  return next as T;
}

function applyPersistedEvent(
  state: ChatEntryState,
  event: ChatReplayEvent,
  now: number,
): ChatEntryState {
  const withCursor = advanceCursor(state, event.seq);
  switch (event.type) {
    case "user/message":
      return applyPersistedUserMessage(withCursor, event, now);
    case "assistant/message":
      return upsertPersistedAssistant(withCursor, event.seq, event.data.message, now);
    case "tool/result":
      return upsertPersistedToolResult(withCursor, event.seq, event.data.message, now);
    case "turn/withdrawn": {
      const removed = removeSeqInterval(withCursor, event.data.seq, event.seq);
      return removed === withCursor && !withCursor.pendingWithdraw
        ? withCursor
        : { ...removed, pendingWithdraw: false };
    }
    case "turn/retried":
      return removeSeqs(withCursor, new Set(event.data.abandonedSeqs), event.seq);
    case "control/requested":
      return upsertPersistedControlRequest(withCursor, event);
    case "control/resolved":
      return applyPersistedControlResolved(withCursor, event);
    case "turn/start":
    case "compaction/applied":
      return withCursor;
    case "turn/end":
      return clearPendingControls(withCursor);
  }
}

export function dropTransientProjections<T extends ChatEntryState>(state: T): T {
  const entries = state.entries.filter(
    (entry) => entry.seq !== undefined || (entry.kind !== "assistant" && entry.kind !== "tool-result"),
  );
  if (entries.length === state.entries.length) return state;
  return { ...state, entries, ...pruneRefs(state, entries) } as T;
}

function applyPersistedUserMessage(
  state: ChatEntryState,
  event: Extract<ChatReplayEvent, { type: "user/message" }>,
  now: number,
): ChatEntryState {
  const message = event.data.message;
  const text = isUserMessage(message) ? extractMessageText(message.content) : "";
  const entries = settleUserEntry(
    state.entries,
    {
      seq: event.seq,
      text,
      time: message.timestamp ?? now,
      ...(event.data.source === "triggered" ? { source: event.data.source } : {}),
      ...(event.data.source === "triggered" && event.data.triggerName !== undefined
        ? { triggerName: event.data.triggerName }
        : {}),
    },
    { text },
  );
  return entries === state.entries ? state : { ...state, entries };
}

function upsertPersistedAssistant(
  state: ChatEntryState,
  seq: number,
  message: Extract<ChatReplayEvent, { type: "assistant/message" }>["data"]["message"],
  now: number,
): ChatEntryState {
  const text = extractMessageText(message.content);
  const toolCalls: ToolCallRef[] = (extractToolCalls(message) ?? []).map((toolCall) => ({
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    args: toolCall.args,
  }));
  const error = message.stopReason === "error"
    ? {
        message: message.errorMessage ?? "Unknown error",
        code: classifyErrorMessageString(message.errorMessage ?? "Unknown error"),
      }
    : undefined;
  const time = message.timestamp ?? now;
  const index = state.entries.findIndex((entry) => entry.seq === seq);
  if (index >= 0) {
    const previous = state.entries[index];
    if (!isAssistantEntry(previous)) return state;
    const updated: AssistantEntry = {
      kind: "assistant",
      id: previous.id,
      seq,
      text,
      toolCalls,
      streaming: false,
      ...(previous.streamId !== undefined ? { streamId: previous.streamId } : {}),
      time,
      ...(message.stopReason !== undefined ? { stopReason: message.stopReason } : {}),
      ...(error ? { error } : {}),
    };
    return { ...state, entries: replaceAt(state.entries, index, updated) };
  }
  const entry: AssistantEntry = {
    kind: "assistant",
    id: persistedEntryId(seq),
    seq,
    text,
    toolCalls,
    streaming: false,
    time,
    ...(message.stopReason !== undefined ? { stopReason: message.stopReason } : {}),
    ...(error ? { error } : {}),
  };
  return { ...state, entries: [...state.entries, entry] };
}

function upsertPersistedToolResult(
  state: ChatEntryState,
  seq: number,
  message: Extract<ChatReplayEvent, { type: "tool/result" }>["data"]["message"],
  now: number,
): ChatEntryState {
  const text = extractMessageText(message.content);
  const time = message.timestamp ?? now;
  const index = state.entries.findIndex((entry) => entry.seq === seq);
  if (index >= 0) {
    const previous = state.entries[index];
    if (previous.kind !== "tool-result") return state;
    const updated: ToolResultEntry = {
      ...previous,
      toolCallId: message.toolCallId,
      result: text,
      ...(message.isError !== undefined ? { isError: message.isError } : {}),
      ...(message.details !== undefined ? { details: message.details } : {}),
      time,
    };
    return { ...state, entries: replaceAt(state.entries, index, updated) };
  }
  const transientIndex = state.entries.findIndex(
    (entry) => entry.kind === "tool-result" && entry.toolCallId === message.toolCallId && entry.seq === undefined,
  );
  if (transientIndex >= 0) {
    const previous = state.entries[transientIndex] as ToolResultEntry;
    const updated: ToolResultEntry = {
      ...previous,
      seq,
      result: text,
      ...(message.isError !== undefined ? { isError: message.isError } : {}),
      ...(message.details !== undefined ? { details: message.details } : {}),
      time,
    };
    const entries = attachToolResultOwner(replaceAt(state.entries, transientIndex, updated), transientIndex);
    return { ...state, entries };
  }
  const entry: ToolResultEntry = {
    kind: "tool-result",
    id: persistedEntryId(seq),
    seq,
    toolCallId: message.toolCallId,
    result: text,
    ...(message.isError !== undefined ? { isError: message.isError } : {}),
    ...(message.details !== undefined ? { details: message.details } : {}),
    time,
  };
  const entries = attachToolResultOwner([...state.entries, entry], state.entries.length);
  return { ...state, entries };
}

function upsertPersistedControlRequest(
  state: ChatEntryState,
  event: Extract<ChatReplayEvent, { type: "control/requested" }>,
): ChatEntryState {
  const { requestId, kind, toolCallId, toolName, args } = event.data;
  const existing = state.entries.find(
    (entry) => entry.kind === "tool-result" && entry.control?.requestId === requestId,
  );
  if (existing !== undefined) return state;
  const control: ControlProjection = { requestId, kind, status: "pending" };
  const argsRecord = isRecord(args) ? args : {};
  const index = state.entries.findIndex(
    (entry) => entry.kind === "tool-result" && entry.toolCallId === toolCallId,
  );
  if (index >= 0) {
    const previous = state.entries[index] as ToolResultEntry;
    const updated: ToolResultEntry = {
      ...previous,
      toolName,
      ...(Object.keys(argsRecord).length > 0 ? { args: argsRecord } : {}),
      control,
    };
    return { ...state, entries: replaceAt(state.entries, index, updated) };
  }
  const ownerId = findToolCallOwner(state.entries, toolCallId);
  const entry: ToolResultEntry = {
    kind: "tool-result",
    id: toolResultEntryId(toolCallId),
    toolCallId,
    ...(ownerId !== undefined ? { ownerId } : {}),
    toolName,
    ...(Object.keys(argsRecord).length > 0 ? { args: argsRecord } : {}),
    control,
    time: event.time,
  };
  return { ...state, entries: [...state.entries, entry] };
}

function applyPersistedControlResolved(
  state: ChatEntryState,
  event: Extract<ChatReplayEvent, { type: "control/resolved" }>,
): ChatEntryState {
  const index = state.entries.findIndex(
    (entry) => entry.kind === "tool-result" && entry.control?.requestId === event.data.requestId,
  );
  if (index < 0) return state;
  const previous = state.entries[index] as ToolResultEntry;
  const control: ControlProjection = event.data.kind === "approval"
    ? {
        requestId: event.data.requestId,
        kind: "approval",
        status: event.data.approved ? "approved" : "rejected",
        approved: event.data.approved ?? false,
        ...(event.data.reason !== undefined ? { reason: event.data.reason } : {}),
      }
    : {
        requestId: event.data.requestId,
        kind: "question",
        status: event.data.timedOut ? "timeout" : "answered",
        ...(event.data.answer !== undefined ? { answer: event.data.answer } : {}),
        timedOut: event.data.timedOut ?? false,
      };
  return { ...state, entries: replaceAt(state.entries, index, { ...previous, control }) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
