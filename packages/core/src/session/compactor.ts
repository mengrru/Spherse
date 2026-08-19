import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import {
  appendEntry,
  createLog,
  emptyLog,
  type MessageLog,
} from "../kernel/message-log.js";
import { sanitizeToolCallPairs, wrapDigestContent } from "../context/compaction.js";
export function logFromRows(rows: Array<{ id: number; message: AgentMessage }>): MessageLog {
  return createLog(rows.map((r) => ({ dbId: r.id, message: r.message })));
}

export function logFromCompaction(
  anchorMessageId: number,
  digestContent: string,
  createdAt: number,
  tailRows: Array<{ id: number; message: AgentMessage }>,
): MessageLog {
  const digestMessage: AgentMessage = {
    role: "user",
    content: wrapDigestContent(digestContent),
    timestamp: createdAt,
  } as unknown as AgentMessage;

  const { messages: sanitizedTail, keptIndices } = sanitizeToolCallPairs(
    tailRows.map((r) => r.message) as Message[],
  );

  let log = appendEntry(emptyLog(), digestMessage, anchorMessageId);
  keptIndices.forEach((tailIndex, sanitizedIndex) => {
    const row = tailRows[tailIndex];
    if (row) log = appendEntry(log, sanitizedTail[sanitizedIndex] as AgentMessage, row.id);
  });
  return log;
}
