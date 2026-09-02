import type { AgentMessage } from "@spherse/core";
import type { SettledFrameContract } from "@spherse/contracts";

export interface DurableEntry {
  seq: number;
  message: AgentMessage;
  source?: "triggered";
  triggerName?: string;
  intentId?: string;
}

export type DurableMode = "unknown" | "events" | "snapshot";

export interface DurableZone {
  mode: DurableMode;
  entries: DurableEntry[];
  highSeq: number | null;
  hasMore: boolean;
  oldestLoadedId: number | null;
  resyncNeeded: boolean;
}

export function initialDurable(): DurableZone {
  return {
    mode: "unknown",
    entries: [],
    highSeq: null,
    hasMore: false,
    oldestLoadedId: null,
    resyncNeeded: false,
  };
}

export interface SettledFrameOutcome {
  durable: DurableZone;
  entry: DurableEntry | null;
  violation: boolean;
}

export function applySettledFrame(durable: DurableZone, frame: SettledFrameContract): SettledFrameOutcome {
  if (durable.mode === "snapshot") {
    durable = { ...initialDurable(), mode: "events" };
  } else if (durable.mode === "unknown") {
    durable = { ...durable, mode: "events" };
  }

  if (frame.type === "message_settled") {
    const existing = durable.entries.find((entry) => entry.seq === frame.seq);
    if (existing) {
      return { durable, entry: null, violation: false };
    }
    if (durable.highSeq !== null && frame.seq <= durable.highSeq) {
      return { durable: { ...durable, resyncNeeded: true }, entry: null, violation: true };
    }
    const entry: DurableEntry = {
      seq: frame.seq,
      message: frame.message,
      ...(frame.intentId !== undefined ? { intentId: frame.intentId } : {}),
    };
    return { durable: insertEntry(durable, entry, frame.seq), entry, violation: false };
  }
  if (frame.type === "turn_withdrawn") {
    const upTo = frame.upTo ?? frame.seq + 1;
    const entries = durable.entries.filter(
      (entry) => entry.seq < frame.seq || entry.seq >= upTo,
    );
    const highSeq = Math.max(durable.highSeq ?? -1, upTo);
    return {
      durable: entries.length === durable.entries.length
        ? { ...durable, highSeq }
        : { ...durable, entries, highSeq },
      entry: null,
      violation: false,
    };
  }
  const abandoned = new Set(frame.abandonedSeqs);
  const entries = durable.entries.filter((entry) => !abandoned.has(entry.seq));
  const highSeq = Math.max(durable.highSeq ?? -1, frame.seq);
  return {
    durable: entries.length === durable.entries.length
      ? { ...durable, highSeq }
      : { ...durable, entries, highSeq },
    entry: null,
    violation: false,
  };
}

export function applySnapshot(
  durable: DurableZone,
  snapshot: {
    entries: Array<{ id: number; message: AgentMessage; source?: "triggered"; triggerName?: string }>;
    hasMore: boolean;
    oldestId: number | null;
    full: boolean;
  },
): DurableZone {
  const projected: DurableEntry[] = snapshot.entries.map((entry) => ({
    seq: entry.id,
    message: entry.message,
    ...(entry.source !== undefined ? { source: entry.source } : {}),
    ...(entry.triggerName !== undefined ? { triggerName: entry.triggerName } : {}),
  }));

  if (snapshot.full) {
    const highSeq = projected.length > 0 ? projected[projected.length - 1].seq : null;
    return {
      ...durable,
      entries: projected,
      highSeq,
      hasMore: snapshot.hasMore,
      oldestLoadedId: snapshot.oldestId,
      resyncNeeded: false,
    };
  }

  const oldestSeq = projected.length > 0 ? projected[0].seq : null;
  if (oldestSeq === null) {
    return { ...durable, hasMore: snapshot.hasMore, oldestLoadedId: snapshot.oldestId };
  }
  const kept = durable.entries.filter((entry) => entry.seq < oldestSeq);
  const entries = mergeSorted(kept, projected);
  const highSeq = Math.max(durable.highSeq ?? -1, projected[projected.length - 1].seq);
  return {
    ...durable,
    entries,
    highSeq: highSeq === -1 ? null : highSeq,
    hasMore: snapshot.hasMore,
    oldestLoadedId: snapshot.oldestId,
    resyncNeeded: false,
  };
}

export function applyLoadMore(
  durable: DurableZone,
  page: {
    entries: Array<{ id: number; message: AgentMessage; source?: "triggered"; triggerName?: string }>;
    hasMore: boolean;
    oldestId: number | null;
  },
): DurableZone {
  const projected: DurableEntry[] = page.entries.map((entry) => ({
    seq: entry.id,
    message: entry.message,
    ...(entry.source !== undefined ? { source: entry.source } : {}),
    ...(entry.triggerName !== undefined ? { triggerName: entry.triggerName } : {}),
  }));
  if (projected.length === 0) {
    return { ...durable, hasMore: page.hasMore, oldestLoadedId: page.oldestId };
  }
  const existing = new Set(durable.entries.map((entry) => entry.seq));
  const additions = projected.filter((entry) => !existing.has(entry.seq));
  if (additions.length === 0) {
    return { ...durable, hasMore: page.hasMore, oldestLoadedId: page.oldestId };
  }
  const entries = mergeSorted(durable.entries, additions);
  return { ...durable, entries, hasMore: page.hasMore, oldestLoadedId: page.oldestId };
}

function mergeSorted(existing: DurableEntry[], additions: DurableEntry[]): DurableEntry[] {
  const out: DurableEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < existing.length && j < additions.length) {
    if (existing[i].seq < additions[j].seq) {
      out.push(existing[i++]);
    } else if (existing[i].seq > additions[j].seq) {
      out.push(additions[j++]);
    } else {
      out.push(existing[i++]);
      j++;
    }
  }
  while (i < existing.length) out.push(existing[i++]);
  while (j < additions.length) out.push(additions[j++]);
  return out;
}

export function enterSnapshotMode(durable: DurableZone): DurableZone {
  return { ...durable, mode: "snapshot", highSeq: null };
}

export function clearResyncNeeded(durable: DurableZone): DurableZone {
  if (!durable.resyncNeeded) return durable;
  return { ...durable, resyncNeeded: false };
}

function insertEntry(durable: DurableZone, entry: DurableEntry, seq: number): DurableZone {
  const entries: DurableEntry[] = [];
  let inserted = false;
  for (const existing of durable.entries) {
    if (!inserted && existing.seq > seq) {
      entries.push(entry);
      inserted = true;
    }
    entries.push(existing);
  }
  if (!inserted) entries.push(entry);
  return { ...durable, entries, highSeq: Math.max(durable.highSeq ?? -1, seq) };
}
