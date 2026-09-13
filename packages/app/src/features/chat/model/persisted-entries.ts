import type { ChatReplayEvent } from "@spherse/contracts";
import { isUserMessage } from "./agent-event-parse";
import { extractMessageText, extractToolCalls } from "./chat-tool-projection";
import { classifyErrorMessageString } from "./classify-error";
import {
  isAssistantEntry,
  persistedEntryId,
  type AssistantEntry,
  type ChatEntry,
  type EntryId,
  type ToolCallRef,
  type ToolResultEntry,
} from "./entry";
import {
  advanceCursor,
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
    case "turn/start":
    case "turn/end":
    case "compaction/applied":
      return withCursor;
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

function attachToolResultOwner(entries: ChatEntry[], index: number): ChatEntry[] {
  const entry = entries[index];
  if (entry.kind !== "tool-result" || entry.ownerId !== undefined) return entries;
  const ownerId = findToolCallOwner(entries, entry.toolCallId);
  return ownerId !== undefined ? replaceAt(entries, index, { ...entry, ownerId }) : entries;
}

function findToolCallOwner(entries: ChatEntry[], toolCallId: string): EntryId | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.kind !== "assistant") continue;
    if (entry.toolCalls.some((toolCall) => toolCall.toolCallId === toolCallId)) return entry.id;
  }
  return undefined;
}
