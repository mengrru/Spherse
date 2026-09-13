import {
  isAssistantMessage,
  isUserMessage,
  type AgentEvent,
} from "./agent-event-parse";
import { extractMessageText } from "./chat-tool-projection";
import { classifyErrorMessageString } from "./classify-error";
import {
  isAssistantEntry,
  nextTransientId,
  toolResultEntryId,
  type AssistantEntry,
  type ChatEntry,
  type ControlProjection,
  type EntryError,
  type EntryId,
  type ErrorEntry,
  type ToolResultEntry,
} from "./entry";
import {
  advanceCursor,
  dropBindings,
  indexOfId,
  pruneRefs,
  removeSeqs,
  replaceAt,
  settleUserEntry,
  type ChatEntryState,
} from "./entry-state";

export function reduceLiveEvents<T extends ChatEntryState>(
  state: T,
  events: AgentEvent[],
  now: number,
): T {
  let next: ChatEntryState = state;
  for (const event of events) {
    next = applyEvent(next, event, now);
  }
  return next as T;
}

function applyEvent(state: ChatEntryState, event: AgentEvent, now: number): ChatEntryState {
  switch (event.type) {
    case "agent_start":
      return clearRunScopedIdentity({
        ...state,
        streaming: true,
        openStreamId: null,
        ownerAssistantId: null,
      });

    case "run_status":
      if (event.active) {
        return state.streaming ? state : { ...state, streaming: true };
      }
      return clearRun(clearPendingQuestionControls(state));

    case "agent_end":
      return clearRun(advanceCursor(state, event.seq));

    case "message_start":
      return isBoundMessage(state, event.messageId) ? state : applyMessageStart(state, event);
    case "message_update":
      return isBoundMessage(state, event.messageId) ? state : applyMessageUpdate(state, event, now);
    case "message_end":
      return applyMessageEnd(state, event, now);

    case "tool_execution_start":
      return upsertToolResult(state, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      }, now);

    case "tool_execution_update":
      return upsertToolResult(state, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        partialResult: event.partialResult,
      }, now);

    case "tool_execution_end":
      return upsertToolResult(state, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      }, now);

    case "control_request":
      return upsertToolResult(state, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: toArgsRecord(event.args),
        control: {
          requestId: event.requestId,
          kind: event.kind,
          status: "pending",
        },
      }, now);

    case "control_resolved":
      return applyControlResolved(state, event);

    case "error":
      return applyError(state, event.message, event.code, now);

    case "user_message":
      return applyUserMessage(state, event, now);
    case "turn_retried":
      return removeSeqs(state, new Set(event.abandonedSeqs), event.seq);
    case "turn_withdrawn":
      return applyWithdraw(state, event.seq);

    case "turn_start":
    case "turn_end":
    case "pong":
    case "session_ready":
    case "replay_events":
    case "replay_done":
      return state;
  }
}

export function markRetrying<T extends ChatEntryState>(state: T): T {
  const index = state.entries.length - 1;
  const entry = state.entries[index];
  if (!entry || !isAssistantEntry(entry) || !entry.error) return state;
  const { error: _error, ...rest } = entry;
  const updated: AssistantEntry = { ...rest, streaming: true };
  return { ...state, entries: replaceAt(state.entries, index, updated) } as T;
}

function applyUserMessage(
  state: ChatEntryState,
  event: Extract<AgentEvent, { type: "user_message" }>,
  now: number,
): ChatEntryState {
  const withCursor = advanceCursor(state, event.seq);
  const text = isUserMessage(event.message) ? extractMessageText(event.message.content) : "";
  const entries = settleUserEntry(
    withCursor.entries,
    {
      seq: event.seq,
      text,
      time: event.message.timestamp ?? now,
      ...(event.clientId !== undefined ? { clientId: event.clientId } : {}),
      ...(event.source === "triggered" ? { source: event.source } : {}),
      ...(event.source === "triggered" && event.triggerName !== undefined
        ? { triggerName: event.triggerName }
        : {}),
    },
    event.clientId !== undefined ? { clientId: event.clientId } : {},
  );
  return entries === withCursor.entries ? withCursor : { ...withCursor, entries };
}

function toArgsRecord(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null ? args as Record<string, unknown> : {};
}

function applyMessageStart(state: ChatEntryState, event: Extract<AgentEvent, { type: "message_start" }>): ChatEntryState {
  if (!isAssistantMessage(event.message)) return state;
  const reuseIndex = findReusableStreamIndex(state.entries, event.messageId);
  if (reuseIndex >= 0) {
    const entry = state.entries[reuseIndex];
    if (!isAssistantEntry(entry)) return state;
    const updated: AssistantEntry = {
      ...entry,
      streaming: true,
      streamId: event.messageId ?? entry.streamId ?? nextTransientId("s"),
    };
    return {
      ...state,
      entries: replaceAt(state.entries, reuseIndex, updated),
      openStreamId: updated.id,
      ownerAssistantId: updated.id,
      streaming: true,
    };
  }
  const streamId = event.messageId ?? nextTransientId("s");
  const entry: AssistantEntry = {
    kind: "assistant",
    id: transientEntryId(state, streamId),
    streamId,
    text: "",
    toolCalls: [],
    streaming: true,
  };
  return {
    ...state,
    entries: [...state.entries, entry],
    openStreamId: entry.id,
    ownerAssistantId: entry.id,
    streaming: true,
  };
}

function applyMessageUpdate(state: ChatEntryState, event: Extract<AgentEvent, { type: "message_update" }>, now: number): ChatEntryState {
  if (!isAssistantMessage(event.message)) return state;
  const text = extractMessageText(event.message.content);
  const targetIndex = findStreamTargetIndex(state, event.messageId);
  if (targetIndex >= 0) {
    const entry = state.entries[targetIndex];
    if (!isAssistantEntry(entry)) return state;
    if (entry.text === text && entry.streaming === true && state.openStreamId === entry.id) return state;
    const updated: AssistantEntry = { ...entry, text, streaming: true };
    return {
      ...state,
      entries: replaceAt(state.entries, targetIndex, updated),
      openStreamId: updated.id,
      ownerAssistantId: state.ownerAssistantId ?? updated.id,
      streaming: true,
    };
  }
  const last = state.entries[state.entries.length - 1];
  if (!text && last?.kind === "assistant") return state;
  const streamId = event.messageId ?? nextTransientId("s");
  const entry: AssistantEntry = {
    kind: "assistant",
    id: transientEntryId(state, streamId),
    streamId,
    text,
    toolCalls: [],
    streaming: true,
    time: now,
  };
  return {
    ...state,
    entries: [...state.entries, entry],
    openStreamId: entry.id,
    ownerAssistantId: entry.id,
    streaming: true,
  };
}

function applyMessageEnd(state: ChatEntryState, event: Extract<AgentEvent, { type: "message_end" }>, now: number): ChatEntryState {
  const { messageId, seq } = event;
  const seqByMessageId = messageId !== undefined && seq !== undefined
    ? { ...state.seqByMessageId, [messageId]: seq }
    : state.seqByMessageId;
  const cursor = seq !== undefined ? Math.max(state.cursor, seq) : state.cursor;
  if (!isAssistantMessage(event.message)) {
    if (cursor === state.cursor && seqByMessageId === state.seqByMessageId) return state;
    return { ...state, cursor, seqByMessageId };
  }
  const text = extractMessageText(event.message.content);
  const isError = event.message.stopReason === "error";
  const error: EntryError | undefined = isError
    ? {
        message: event.message.errorMessage ?? "Unknown error",
        code: classifyErrorMessageString(event.message.errorMessage ?? "Unknown error"),
      }
    : undefined;
  const time = event.message.timestamp ?? now;

  const seqIndex = seq !== undefined ? state.entries.findIndex((entry) => entry.seq === seq) : -1;
  if (seqIndex >= 0) {
    const existing = state.entries[seqIndex];
    if (!isAssistantEntry(existing)) return { ...state, cursor, seqByMessageId };
    const transientIndex = messageId !== undefined ? findEntryByStreamId(state.entries, messageId) : -1;
    const openIndex = indexOfId(state.entries, state.openStreamId);
    if (transientIndex === seqIndex || openIndex === seqIndex) {
      const updated: AssistantEntry = {
        ...existing,
        text,
        streaming: false,
        time,
        ...(messageId !== undefined ? { streamId: messageId } : {}),
        ...(event.message.stopReason !== undefined ? { stopReason: event.message.stopReason } : {}),
        ...(error ? { error } : {}),
      };
      return {
        ...state,
        entries: replaceAt(state.entries, seqIndex, updated),
        openStreamId: null,
        ownerAssistantId: existing.id,
        cursor,
        seqByMessageId,
      };
    }
    let entries = state.entries;
    const dropIndex = transientIndex >= 0 ? transientIndex : openIndex;
    if (dropIndex >= 0) {
      entries = entries.filter((_, index) => index !== dropIndex);
    }
    return { ...state, entries, openStreamId: null, ownerAssistantId: existing.id, cursor, seqByMessageId };
  }

  const targetIndex = findStreamTargetIndex(state, messageId);
  if (targetIndex >= 0) {
    const entry = state.entries[targetIndex];
    if (!isAssistantEntry(entry)) return { ...state, cursor, seqByMessageId };
    const updated: AssistantEntry = {
      ...entry,
      text,
      streaming: false,
      time,
      ...(messageId !== undefined ? { streamId: messageId } : {}),
      ...(seq !== undefined ? { seq } : {}),
      ...(event.message.stopReason !== undefined ? { stopReason: event.message.stopReason } : {}),
      ...(error ? { error } : {}),
    };
    return {
      ...state,
      entries: replaceAt(state.entries, targetIndex, updated),
      openStreamId: null,
      ownerAssistantId: entry.id,
      cursor,
      seqByMessageId,
    };
  }
  const last = state.entries[state.entries.length - 1];
  if (!text && !error && last?.kind === "assistant") return { ...state, cursor, seqByMessageId };
  const streamId = messageId ?? nextTransientId("s");
  const entry: AssistantEntry = {
    kind: "assistant",
    id: transientEntryId(state, streamId),
    streamId,
    text,
    toolCalls: [],
    streaming: false,
    time,
    ...(seq !== undefined ? { seq } : {}),
    ...(event.message.stopReason !== undefined ? { stopReason: event.message.stopReason } : {}),
    ...(error ? { error } : {}),
  };
  return {
    ...state,
    entries: [...state.entries, entry],
    openStreamId: null,
    ownerAssistantId: entry.id,
    cursor,
    seqByMessageId,
  };
}

interface ToolResultPatch {
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  partialResult?: unknown;
  result?: unknown;
  isError?: boolean;
  control?: ControlProjection;
}

function upsertToolResult(state: ChatEntryState, patch: ToolResultPatch, now: number): ChatEntryState {
  let entries = state.entries;
  let ownerAssistantId = state.ownerAssistantId;
  const ownerIndex = indexOfId(entries, ownerAssistantId);
  if (ownerIndex < 0 || !isAssistantEntry(entries[ownerIndex])) {
    const fallback = lastAssistantIndex(entries);
    if (fallback >= 0) {
      ownerAssistantId = entries[fallback].id;
    } else {
      const streamId = nextTransientId("s");
      const created: AssistantEntry = {
        kind: "assistant",
        id: streamId,
        streamId,
        text: "",
        toolCalls: [],
        streaming: true,
        time: now,
      };
      entries = [...entries, created];
      ownerAssistantId = created.id;
    }
  }
  const resolvedOwnerIndex = indexOfId(entries, ownerAssistantId);
  const owner = entries[resolvedOwnerIndex];
  if (isAssistantEntry(owner)) {
    const callIndex = owner.toolCalls.findIndex((call) => call.toolCallId === patch.toolCallId);
    const toolCalls = callIndex >= 0
      ? owner.toolCalls.map((call, index) => (
          index === callIndex
            ? { ...call, toolName: patch.toolName, ...(patch.args !== undefined ? { args: patch.args } : {}) }
            : call
        ))
      : [...owner.toolCalls, { toolCallId: patch.toolCallId, toolName: patch.toolName, args: patch.args ?? {} }];
    entries = replaceAt(entries, resolvedOwnerIndex, { ...owner, toolCalls });
  }

  const resultIndex = entries.findIndex((entry) => entry.kind === "tool-result" && entry.toolCallId === patch.toolCallId);
  if (resultIndex >= 0) {
    const previous = entries[resultIndex] as ToolResultEntry;
    const updated: ToolResultEntry = {
      ...previous,
      ownerId: ownerAssistantId ?? undefined,
      toolName: patch.toolName,
      ...(patch.args !== undefined ? { args: patch.args } : {}),
      ...(patch.partialResult !== undefined ? { partialResult: patch.partialResult } : {}),
      ...(patch.result !== undefined ? { result: patch.result } : {}),
      ...(patch.isError !== undefined ? { isError: patch.isError } : {}),
      ...(patch.control !== undefined ? { control: patch.control } : {}),
    };
    entries = replaceAt(entries, resultIndex, updated);
  } else {
    const created: ToolResultEntry = {
      kind: "tool-result",
      id: toolResultEntryId(patch.toolCallId),
      toolCallId: patch.toolCallId,
      ...(ownerAssistantId !== null ? { ownerId: ownerAssistantId } : {}),
      toolName: patch.toolName,
      ...(patch.args !== undefined ? { args: patch.args } : {}),
      ...(patch.partialResult !== undefined ? { partialResult: patch.partialResult } : {}),
      ...(patch.result !== undefined ? { result: patch.result } : {}),
      ...(patch.isError !== undefined ? { isError: patch.isError } : {}),
      ...(patch.control !== undefined ? { control: patch.control } : {}),
      time: now,
    };
    entries = [...entries, created];
  }

  return {
    ...state,
    entries,
    ownerAssistantId,
    openStreamId: state.openStreamId,
  };
}

function applyControlResolved(state: ChatEntryState, event: Extract<AgentEvent, { type: "control_resolved" }>): ChatEntryState {
  const index = state.entries.findIndex(
    (entry) => entry.kind === "tool-result" && entry.control?.requestId === event.requestId,
  );
  if (index < 0) return state;
  const entry = state.entries[index] as ToolResultEntry;
  const control: ControlProjection = event.kind === "approval"
    ? {
        requestId: event.requestId,
        kind: "approval",
        status: event.approved ? "approved" : "rejected",
        approved: event.approved,
        ...(event.reason !== undefined ? { reason: event.reason } : {}),
      }
    : {
        requestId: event.requestId,
        kind: "question",
        status: event.timedOut ? "timeout" : "answered",
        ...(event.answer !== undefined ? { answer: event.answer } : {}),
        timedOut: event.timedOut,
      };
  return { ...state, entries: replaceAt(state.entries, index, { ...entry, control }) };
}

function applyError(state: ChatEntryState, message: string, code: ErrorEntry["code"] | undefined, now: number): ChatEntryState {
  const error: EntryError = {
    message,
    ...(code !== undefined ? { code } : {}),
    ...(state.pendingWithdraw ? { retrySuppressed: true } : {}),
  };
  const openIndex = indexOfId(state.entries, state.openStreamId);
  if (openIndex >= 0) {
    const entry = state.entries[openIndex];
    if (!isAssistantEntry(entry)) return state;
    const updated: AssistantEntry = { ...entry, streaming: false, error };
    return {
      ...state,
      entries: replaceAt(state.entries, openIndex, updated),
      openStreamId: null,
      ownerAssistantId: entry.id,
      streaming: false,
      pendingWithdraw: false,
    };
  }
  const entry: ErrorEntry = {
    kind: "error",
    id: nextTransientId("x"),
    message,
    ...(code !== undefined ? { code } : {}),
    ...(state.pendingWithdraw ? { retrySuppressed: true } : {}),
    time: now,
  };
  return {
    ...state,
    entries: [...state.entries, entry],
    streaming: false,
    pendingWithdraw: false,
  };
}

function applyWithdraw(state: ChatEntryState, fromSeq: number): ChatEntryState {
  let firstIndex = state.entries.findIndex(
    (entry) => entry.seq !== undefined && entry.seq >= fromSeq,
  );
  if (firstIndex < 0) {
    firstIndex = findLastUserIndex(state.entries);
  }
  const entries = firstIndex >= 0 ? state.entries.slice(0, firstIndex) : state.entries;
  const removed = new Set<number>();
  if (firstIndex >= 0) {
    for (const entry of state.entries.slice(firstIndex)) {
      if (entry.seq !== undefined) removed.add(entry.seq);
    }
  }
  return advanceCursor(
    {
      ...state,
      entries,
      pendingWithdraw: false,
      seqByMessageId: dropBindings(state.seqByMessageId, removed),
      ...pruneRefs(state, entries),
    },
    fromSeq,
  );
}

export function clearRun<T extends ChatEntryState>(state: T): T {
  const openIndex = indexOfId(state.entries, state.openStreamId);
  let entries = state.entries;
  if (openIndex >= 0) {
    const entry = entries[openIndex];
    if (isAssistantEntry(entry) && entry.streaming) {
      entries = replaceAt(entries, openIndex, { ...entry, streaming: false });
    }
  }
  return {
    ...state,
    entries,
    openStreamId: null,
    ownerAssistantId: null,
    streaming: false,
  } as T;
}

function clearPendingQuestionControls(state: ChatEntryState): ChatEntryState {
  let changed = false;
  const entries = state.entries.map((entry) => {
    if (entry.kind !== "tool-result") return entry;
    if (entry.control?.kind !== "question" || entry.control.status !== "pending") return entry;
    changed = true;
    const { control: _control, ...rest } = entry;
    return rest;
  });
  return changed ? { ...state, entries } : state;
}

function isBoundMessage(state: ChatEntryState, messageId: string | undefined): boolean {
  return messageId !== undefined && state.seqByMessageId[messageId] !== undefined;
}

function findReusableStreamIndex(entries: ChatEntry[], messageId: string | undefined): number {
  if (messageId !== undefined) {
    return findEntryByStreamId(entries, messageId);
  }
  const last = entries[entries.length - 1];
  if (last && isAssistantEntry(last) && last.streaming) return entries.length - 1;
  return -1;
}

function findStreamTargetIndex(state: ChatEntryState, messageId: string | undefined): number {
  if (messageId !== undefined) {
    const exact = findEntryByStreamId(state.entries, messageId);
    if (exact >= 0) return exact;
  }
  return indexOfId(state.entries, state.openStreamId);
}

function findEntryByStreamId(entries: ChatEntry[], messageId: string): number {
  return entries.findIndex(
    (entry) => entry.kind === "assistant" && entry.streamId === messageId,
  );
}

function transientEntryId(state: ChatEntryState, streamId: string): EntryId {
  return state.entries.some((entry) => entry.id === streamId)
    ? nextTransientId("s")
    : streamId;
}

function clearRunScopedIdentity(state: ChatEntryState): ChatEntryState {
  const hasBindings = Object.keys(state.seqByMessageId).length > 0;
  const hasStreams = state.entries.some((entry) => entry.streamId !== undefined);
  if (!hasBindings && !hasStreams) return state;
  return {
    ...state,
    seqByMessageId: hasBindings ? {} : state.seqByMessageId,
    entries: hasStreams
      ? state.entries.map((entry) => {
          if (entry.streamId === undefined) return entry;
          const { streamId: _streamId, ...rest } = entry;
          return rest as ChatEntry;
        })
      : state.entries,
  };
}

function lastAssistantIndex(entries: ChatEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].kind === "assistant") return index;
  }
  return -1;
}

function findLastUserIndex(entries: ChatEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].kind === "user") return index;
  }
  return -1;
}
