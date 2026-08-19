import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface MessageEntry {
  readonly dbId: number | null;
  readonly message: AgentMessage;
}

export interface MessageLog {
  readonly entries: ReadonlyArray<MessageEntry>;
}

export function createLog(entries: ReadonlyArray<MessageEntry> = []): MessageLog {
  return { entries: [...entries] };
}

export function emptyLog(): MessageLog {
  return createLog();
}

export function appendEntry(log: MessageLog, message: AgentMessage, dbId: number | null): MessageLog {
  return createLog([...log.entries, { dbId, message }]);
}

export function dropLast(log: MessageLog): MessageLog {
  return createLog(log.entries.slice(0, -1));
}

export function replaceMessage(
  log: MessageLog,
  target: AgentMessage,
  replacement: AgentMessage,
): MessageLog {
  return createLog(
    log.entries.map((entry) => (entry.message === target ? { ...entry, message: replacement } : entry)),
  );
}

export function messagesOf(log: MessageLog): AgentMessage[] {
  return log.entries.map((entry) => entry.message);
}

export interface LogCompaction {
  readonly anchorIndex: number;
  readonly digestMessage: AgentMessage;
  readonly tail: ReadonlyArray<{ index: number; message: AgentMessage }>;
}

export function compactLog(log: MessageLog, compaction: LogCompaction): MessageLog {
  const anchor = log.entries[compaction.anchorIndex];
  const entries: MessageEntry[] = [
    { dbId: anchor?.dbId ?? null, message: compaction.digestMessage },
  ];
  for (const item of compaction.tail) {
    const dbId = log.entries[compaction.anchorIndex + 1 + item.index]?.dbId ?? null;
    entries.push({ dbId, message: item.message });
  }
  return createLog(entries);
}
