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
import { aggregateFileChanges, attachRunChanges } from "../lib/aggregate-file-changes";
import type { ChatMessage, ToolCallInfo } from "../types";

interface ToolResultDetailsBag {
  result: string;
  isError: boolean;
  details: unknown;
}

export function mergeHistoryMessages(
  current: ChatMessage[],
  history: ChatMessage[],
): ChatMessage[] {
  if (current.length === 0) return history;
  if (history.length === 0) return current;
  if (
    !current.some((message) => message._messageId !== undefined) &&
    !history.some((message) => message._messageId !== undefined)
  ) {
    return [...history, ...current];
  }
  const persisted = new Map<number, ChatMessage>();
  for (const message of current) {
    if (message._messageId !== undefined) {
      persisted.set(message._messageId, message);
    }
  }
  for (const message of history) {
    if (message._messageId !== undefined) {
      persisted.set(message._messageId, message);
    }
  }
  const merged = [...persisted.values()].sort(
    (a, b) => (a._messageId ?? 0) - (b._messageId ?? 0),
  );
  const historyUserContents = new Set(
    history
      .filter((message) => message.role === "user")
      .map((message) => message.content),
  );
  const transients = current.filter((message) => {
    if (message._messageId !== undefined) return false;
    if (message._optimistic) {
      return !historyUserContents.has(message.content);
    }
    return Boolean(message._error);
  });
  return [...merged, ...transients];
}

export function parseHistoryMessages(
  history: Array<{ id: number; message: unknown } | unknown>,
): ChatMessage[] {
  const entries = history.map((entry) => (
    isObject(entry) && typeof entry.id === "number" && "message" in entry
      ? { id: entry.id, message: entry.message }
      : { id: undefined, message: entry }
  ));
  const rawMessages = entries.map((entry) => entry.message);
  const toolResultMap = collectToolResultDetails(rawMessages);

  const loaded: ChatMessage[] = [];
  for (const entry of entries) {
    if (isUserMessage(entry.message)) {
      loaded.push({
        ...(entry.id !== undefined ? { _messageId: entry.id } : {}),
        role: "user",
        content: extractMessageText(entry.message.content),
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
          ? { _error: entry.message.errorMessage ?? "Unknown error" }
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
