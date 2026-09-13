import {
  findOptimisticUserIndex,
  persistedEntryId,
  type ChatEntry,
  type ControlProjection,
  type EntryId,
  type ToolCallRef,
  type UserEntry,
} from "./entry";

export interface ChatEntryState {
  entries: ChatEntry[];
  openStreamId: EntryId | null;
  ownerAssistantId: EntryId | null;
  streaming: boolean;
  pendingWithdraw: boolean;
  cursor: number;
  seqByMessageId: Record<string, number>;
}

export function createEntryState(): ChatEntryState {
  return {
    entries: [],
    openStreamId: null,
    ownerAssistantId: null,
    streaming: false,
    pendingWithdraw: false,
    cursor: -1,
    seqByMessageId: {},
  };
}

export function advanceCursor<T extends ChatEntryState>(state: T, seq: number | undefined): T {
  if (seq === undefined || seq <= state.cursor) return state;
  return { ...state, cursor: seq };
}

export function dropBindings(
  seqByMessageId: Record<string, number>,
  seqs: ReadonlySet<number>,
): Record<string, number> {
  if (seqs.size === 0) return seqByMessageId;
  let changed = false;
  const next: Record<string, number> = {};
  for (const [messageId, seq] of Object.entries(seqByMessageId)) {
    if (seqs.has(seq)) {
      changed = true;
      continue;
    }
    next[messageId] = seq;
  }
  return changed ? next : seqByMessageId;
}

export function removeSeqs<T extends ChatEntryState>(
  state: T,
  seqs: ReadonlySet<number>,
  cursorSeq: number,
): T {
  const cursor = Math.max(state.cursor, cursorSeq);
  if (seqs.size === 0) {
    return cursor === state.cursor ? state : ({ ...state, cursor } as T);
  }
  const entries = state.entries.filter(
    (entry) => entry.seq === undefined || !seqs.has(entry.seq),
  );
  const seqByMessageId = dropBindings(state.seqByMessageId, seqs);
  if (
    entries.length === state.entries.length &&
    seqByMessageId === state.seqByMessageId &&
    cursor === state.cursor
  ) {
    return state;
  }
  return {
    ...state,
    entries,
    cursor,
    seqByMessageId,
    ...(entries.length !== state.entries.length ? pruneRefs(state, entries) : {}),
  } as T;
}

export function removeSeqInterval<T extends ChatEntryState>(state: T, from: number, to: number): T {
  const removed = new Set<number>();
  const entries = state.entries.filter((entry) => {
    if (entry.seq === undefined) return true;
    if (entry.seq < from || entry.seq >= to) return true;
    removed.add(entry.seq);
    return false;
  });
  if (removed.size === 0) return state;
  return {
    ...state,
    entries,
    seqByMessageId: dropBindings(state.seqByMessageId, removed),
    ...pruneRefs(state, entries),
  } as T;
}

export function settleUserEntry(
  entries: ChatEntry[],
  settlement: {
    seq: number;
    text: string;
    time?: number;
    clientId?: string;
    source?: "triggered";
    triggerName?: string;
  },
  match: { clientId?: string; text?: string },
): ChatEntry[] {
  if (entries.some((entry) => entry.seq === settlement.seq)) return entries;
  const optimisticIndex = findOptimisticUserIndex(entries, match);
  if (optimisticIndex >= 0) {
    const previous = entries[optimisticIndex] as UserEntry;
    const { optimistic: _optimistic, sendFailed: _sendFailed, ...rest } = previous;
    const updated: UserEntry = {
      ...rest,
      seq: settlement.seq,
      text: settlement.text.length > 0 ? settlement.text : previous.text,
      ...(settlement.source === "triggered" ? { triggered: true as const } : {}),
      ...(settlement.source === "triggered" && settlement.triggerName !== undefined
        ? { triggerName: settlement.triggerName }
        : {}),
      ...(settlement.time !== undefined ? { time: settlement.time } : {}),
    };
    return replaceAt(entries, optimisticIndex, updated);
  }
  const entry: UserEntry = {
    kind: "user",
    id: persistedEntryId(settlement.seq),
    seq: settlement.seq,
    text: settlement.text,
    ...(settlement.clientId !== undefined ? { clientId: settlement.clientId } : {}),
    ...(settlement.source === "triggered" ? { triggered: true as const } : {}),
    ...(settlement.source === "triggered" && settlement.triggerName !== undefined
      ? { triggerName: settlement.triggerName }
      : {}),
    ...(settlement.time !== undefined ? { time: settlement.time } : {}),
  };
  return [...entries, entry];
}

export function indexOfId(entries: ChatEntry[], id: EntryId | null): number {
  if (id === null) return -1;
  return entries.findIndex((entry) => entry.id === id);
}

export function findToolCallOwner(entries: ChatEntry[], toolCallId: string): EntryId | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.kind !== "assistant") continue;
    if (entry.toolCalls.some((toolCall) => toolCall.toolCallId === toolCallId)) return entry.id;
  }
  return undefined;
}

export function attachToolResultOwner(entries: ChatEntry[], index: number): ChatEntry[] {
  const entry = entries[index];
  if (entry.kind !== "tool-result" || entry.ownerId !== undefined) return entries;
  const ownerId = findToolCallOwner(entries, entry.toolCallId);
  return ownerId !== undefined ? replaceAt(entries, index, { ...entry, ownerId }) : entries;
}

export function mergeToolCalls(
  existing: ToolCallRef[],
  incoming: ToolCallRef[],
): ToolCallRef[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((call) => [call.toolCallId, call]));
  for (const call of incoming) {
    const previous = byId.get(call.toolCallId);
    byId.set(call.toolCallId, previous ? { ...previous, toolName: call.toolName, args: call.args } : call);
  }
  return [...byId.values()];
}

export function clearPendingControls<T extends ChatEntryState>(
  state: T,
  kind?: ControlProjection["kind"],
): T {
  let changed = false;
  const entries = state.entries.map((entry) => {
    if (entry.kind !== "tool-result") return entry;
    const control = entry.control;
    if (!control || control.status !== "pending") return entry;
    if (kind !== undefined && control.kind !== kind) return entry;
    changed = true;
    const { control: _control, ...rest } = entry;
    return rest;
  });
  return changed ? ({ ...state, entries } as T) : state;
}

export function replaceAt(entries: ChatEntry[], index: number, entry: ChatEntry): ChatEntry[] {
  const next = entries.slice();
  next[index] = entry;
  return next;
}

export function pruneRefs(
  state: ChatEntryState,
  entries: ChatEntry[],
): Pick<ChatEntryState, "openStreamId" | "ownerAssistantId"> {
  const ids = new Set(entries.map((entry) => entry.id));
  return {
    openStreamId: pickIfPresent(state.openStreamId, ids),
    ownerAssistantId: pickIfPresent(state.ownerAssistantId, ids),
  };
}

function pickIfPresent(id: EntryId | null, ids: ReadonlySet<EntryId>): EntryId | null {
  return id !== null && ids.has(id) ? id : null;
}
