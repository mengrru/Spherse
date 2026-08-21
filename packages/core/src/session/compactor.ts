import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message, ToolCall } from "@earendil-works/pi-ai";
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

const INTERRUPTED_TOOL_TEXT = "The tool call was interrupted and did not execute.";

export function synthesizeInterruptedToolResults(log: MessageLog): AgentMessage[] {
  const answered = new Set<string>();
  let lastToolCallAssistant: { toolCalls: ToolCall[] } | null = null;

  for (const entry of log.entries) {
    const message = entry.message as Message;
    if (message.role === "toolResult") {
      answered.add(message.toolCallId);
    } else if (message.role === "assistant") {
      const toolCalls = message.content.filter(
        (block): block is ToolCall => block.type === "toolCall",
      );
      if (toolCalls.length > 0) lastToolCallAssistant = { toolCalls };
    }
  }
  if (!lastToolCallAssistant) return [];

  const unanswered = lastToolCallAssistant.toolCalls.filter((c) => !answered.has(c.id));
  const now = Date.now();
  return unanswered.map((call) => {
    const message = {
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: [{ type: "text", text: INTERRUPTED_TOOL_TEXT }],
      isError: true,
      timestamp: now,
    } as unknown as AgentMessage;
    return message;
  });
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
