import type { AssistantMessage, ToolCall as AgentToolCall } from "@spherse/core";
import {
  isAssistantMessage,
  isToolCall,
  isToolResultMessage,
  isUserMessage,
} from "./agent-event-parse";
import {
  buildCardFromToolResult,
  extractMessageText,
  extractToolCalls,
} from "./chat-tool-projection";
import { classifyErrorMessageString } from "./classify-error";
import { aggregateFileChanges, attachRunChanges } from "../lib/aggregate-file-changes";
import type { ChatMessage, ToolCallInfo } from "../types";

interface ToolResultDetailsBag {
  result: string;
  isError: boolean;
  details: unknown;
}

export function parseHistoryMessages(
  history: Array<{ id: number; message: unknown; source?: "triggered"; triggerName?: string } | unknown>,
): ChatMessage[] {
  const entries = history.map((entry) => {
    if (isObject(entry) && typeof entry.id === "number" && "message" in entry) {
      return {
        id: entry.id,
        message: entry.message,
        ...(entry.source !== undefined ? { source: entry.source } : {}),
        ...(entry.triggerName !== undefined ? { triggerName: entry.triggerName } : {}),
      };
    }
    return { id: undefined, message: entry };
  });
  const rawMessages = entries.map((entry) => entry.message);
  const toolResultMap = collectToolResultDetails(rawMessages);

  const loaded: ChatMessage[] = [];
  for (const entry of entries) {
    if (isUserMessage(entry.message)) {
      const rawAttachments = (entry.message as { _attachments?: unknown })._attachments;
      const source = (entry as { source?: "triggered" }).source;
      const triggerName = (entry as { triggerName?: string }).triggerName;
      loaded.push({
        ...(entry.id !== undefined ? { _messageId: entry.id } : {}),
        role: "user",
        content: extractMessageText(entry.message.content),
        ...(Array.isArray(rawAttachments) && rawAttachments.length > 0
          ? { _attachments: rawAttachments as ChatMessage["_attachments"] }
          : {}),
        ...(source === "triggered" ? { _triggered: true as const } : {}),
        ...(source === "triggered" && triggerName !== undefined ? { _triggerName: triggerName } : {}),
        timestamp: entry.message.timestamp,
      });
      continue;
    }
    if (isAssistantMessage(entry.message)) {
      const toolCalls = extractToolCalls(entry.message);
      const enrichedToolCalls = enrichToolCalls(
        toolCalls,
        entry.message.content,
        toolResultMap,
      );
      loaded.push({
        ...(entry.id !== undefined ? { _messageId: entry.id } : {}),
        role: "assistant",
        content: extractMessageText(entry.message.content),
        ...(enrichedToolCalls && enrichedToolCalls.length > 0
          ? { _toolCalls: enrichedToolCalls }
          : {}),
        ...(entry.message.stopReason === "error"
          ? {
              _error: entry.message.errorMessage ?? "Unknown error",
              _errorCode: classifyErrorMessageString(
                entry.message.errorMessage ?? "Unknown error",
              ),
              _turnError: true,
            }
          : {}),
        timestamp: entry.message.timestamp,
      });
    }
  }

  const runEndIndices: number[] = [];
  for (let i = 1; i < loaded.length; i++) {
    if (loaded[i].role === "user") runEndIndices.push(i - 1);
  }
  if (loaded.length > 0) runEndIndices.push(loaded.length - 1);

  let result = loaded;
  for (const runEndIndex of runEndIndices) {
    const changes = aggregateFileChanges(result, runEndIndex);
    if (changes.length > 0) {
      result = attachRunChanges(result, runEndIndex, changes);
    }
  }
  return result;
}

function collectToolResultDetails(
  history: unknown[],
): Map<string, ToolResultDetailsBag> {
  const map = new Map<string, ToolResultDetailsBag>();
  for (const entry of history) {
    if (!isToolResultMessage(entry)) continue;
    map.set(entry.toolCallId, {
      result: extractMessageText(entry.content),
      isError: entry.isError ?? false,
      details: entry.details,
    });
  }
  return map;
}

function enrichToolCalls(
  toolCalls: ToolCallInfo[] | undefined,
  content: AssistantMessage["content"],
  toolResultMap: Map<string, ToolResultDetailsBag>,
): ToolCallInfo[] | undefined {
  if (!toolCalls || !Array.isArray(content)) return toolCalls;
  return toolCalls.map((info) => {
    const original = content.find(
      (item): item is AgentToolCall =>
        isToolCall(item) && item.id === info.toolCallId,
    );
    if (!original) return info;
    const toolResult = toolResultMap.get(info.toolCallId);
    const card = buildCardFromToolResult(
      original.name,
      original,
      toolResult?.details,
    );
    return {
      ...info,
      result: toolResult?.result,
      status: toolResult
        ? toolResult.isError
          ? "error"
          : "completed"
        : "completed",
      ...(card ? { _card: card } : {}),
    };
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
