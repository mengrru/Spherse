import type { AssistantMessage, ToolCall as AgentToolCall } from "@spherse/core";
import {
  isAssistantMessage,
  isToolCall,
  isToolResultMessage,
  isUserMessage,
} from "./agent-event-parse";
import { extractMessageText, extractToolCalls } from "./tool-card";
import { classifyErrorMessageString } from "./classify-error";
import type { ChatMessage, OutboxEntry, ToolCallInfo } from "../types";

interface ToolResultDetailsBag {
  result: string;
  isError: boolean;
  details: unknown;
}

export function mergeHistoryPage(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const merged = new Map<number, ChatMessage>();
  for (const message of existing) {
    if (message._messageId !== undefined) {
      merged.set(message._messageId, message);
    }
  }
  for (const message of incoming) {
    if (message._messageId !== undefined) {
      merged.set(message._messageId, message);
    }
  }
  return [...merged.values()].sort(
    (a, b) => (a._messageId ?? 0) - (b._messageId ?? 0),
  );
}

export function consumeOutbox(
  outbox: OutboxEntry[],
  history: ChatMessage[],
): OutboxEntry[] {
  if (outbox.length === 0) return outbox;
  const consumed = new Set<number>();
  const kept: OutboxEntry[] = [];
  for (const entry of outbox) {
    const lowerBound = entry.sentAfterMessageId ?? Number.NEGATIVE_INFINITY;
    const matched = history.some((message) => {
      if (message.role !== "user" || message._messageId === undefined) return false;
      if (message.content !== entry.content) return false;
      if (message._messageId <= lowerBound) return false;
      if (consumed.has(message._messageId)) return false;
      consumed.add(message._messageId);
      return true;
    });
    if (!matched) kept.push(entry);
  }
  return kept.length === outbox.length ? outbox : kept;
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
  return loaded;
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
    return {
      ...info,
      result: toolResult?.result,
      status: toolResult
        ? toolResult.isError
          ? "error"
          : "completed"
        : "completed",
      isError: toolResult?.isError,
      resultDetails: toolResult?.details,
    };
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
