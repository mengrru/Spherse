import type {
  AssistantMessage,
  ImageCardDetails,
  Message,
  RenderCardDetails,
  ToolCall as AgentToolCall,
} from "@spherse/core";
import type { ErrorEventCode } from "@spherse/server/contracts";
import type { ChatCard, ChatMessage, ToolCallInfo } from "./types";
import {
  isAssistantMessage,
  isImageCardDetails,
  isImageCardResultDetails,
  isRenderCardDetails,
  isRenderCardResultDetails,
  isTextContent,
  isToolCall,
  isToolResultMessage,
  isUserMessage,
  type AgentEvent,
} from "./agent-event-parse";
import { aggregateFileChanges, attachRunChanges } from "./lib/aggregate-file-changes";

export interface StreamingSessionData {
  messages: ChatMessage[];
  streaming: boolean;
  lastActivityAt: number;
  scrollPosition: number;
}

export function reduceSessionEvents(
  session: StreamingSessionData,
  events: AgentEvent[],
  now: number,
): StreamingSessionData {
  let messages = session.messages;
  let streaming = session.streaming;

  for (const event of events) {
    const nextMessages = applyEventToMessages(messages, event, now);
    if (nextMessages !== messages) messages = nextMessages;

    const nextStreaming = applyEventToStreaming(event);
    if (nextStreaming !== null) streaming = nextStreaming;
  }

  if (messages === session.messages && streaming === session.streaming) return session;

  return {
    ...session,
    messages,
    streaming,
    lastActivityAt: now,
  };
}

export function appendErrorMessage(prev: ChatMessage[], message: string, code?: ErrorEventCode): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last?.role === "assistant" && last._streaming) {
    return [
      ...prev.slice(0, -1),
      {
        ...last,
        _streaming: false,
        _error: message,
        ...(code && { _errorCode: code }),
      },
    ];
  }
  return [...prev, { role: "assistant", content: "", _error: message, ...(code && { _errorCode: code }) }];
}

export function mergeHistoryMessages(current: ChatMessage[], history: ChatMessage[]): ChatMessage[] {
  if (current.length === 0) return history;
  if (history.length === 0) return current;
  return [...history, ...current];
}

function applyEventToStreaming(event: AgentEvent): boolean | null {
  if (event.type === "agent_start") return true;
  if (event.type === "agent_end") return false;
  if (event.type === "error") return false;
  return null;
}

function extractText(content: Message["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(isTextContent).map((c) => c.text).join("");
}

function extractToolCallsFromAssistantContent(message: AssistantMessage): ToolCallInfo[] | undefined {
  if (!Array.isArray(message.content)) return undefined;
  const toolCalls = message.content.filter(isToolCall);
  return toolCalls.length > 0 ? toolCalls.map(buildToolCallInfo) : undefined;
}

function buildToolCallInfo(toolCall: AgentToolCall): ToolCallInfo {
  return {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    args: toolCall.arguments ?? {},
    status: "running",
  };
}

function applyEventToMessages(prev: ChatMessage[], event: AgentEvent, now: number): ChatMessage[] {
  if (event.type === "message_start" && isAssistantMessage(event.message)) {
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._streaming) return prev;
    return [...prev, { role: "assistant", content: "", _streaming: true }];
  }

  if (event.type === "message_update" && isAssistantMessage(event.message)) {
    const text = extractText(event.message.content);
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._streaming) {
      return [...prev.slice(0, -1), { ...last, content: text, _streaming: true }];
    }
    if (text || last?.role !== "assistant") {
      return [...prev, { role: "assistant", content: text, _streaming: true }];
    }
    return prev;
  }

  if (event.type === "message_end" && isAssistantMessage(event.message)) {
    const text = extractText(event.message.content);
    const isError = event.message.stopReason === "error";
    const error = isError ? (event.message.errorMessage ?? "Unknown error") : undefined;
    const timestamp = event.message.timestamp ?? now;
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._streaming) {
      return [
        ...prev.slice(0, -1),
        { ...last, content: text, _streaming: false, timestamp, ...(error && { _error: error }) },
      ];
    }
    if (text || error || last?.role !== "assistant") {
      return [
        ...prev,
        { role: "assistant", content: text, _streaming: false, timestamp, ...(error && { _error: error }) },
      ];
    }
    return prev;
  }

  if (event.type === "tool_execution_start") {
    const toolCall: ToolCallInfo = {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: event.args,
      status: "running",
    };
    const last = prev[prev.length - 1];
    if (last?.role === "assistant") {
      return [...prev.slice(0, -1), { ...last, _toolCalls: [...(last._toolCalls ?? []), toolCall] }];
    }
    return [...prev, { role: "assistant", content: "", _streaming: true, _toolCalls: [toolCall] }];
  }

  if (event.type === "tool_execution_end") {
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._toolCalls) {
      const calls = last._toolCalls.map((toolCall) =>
        toolCall.toolCallId === event.toolCallId
          ? {
              ...toolCall,
              status: event.isError ? ("error" as const) : ("completed" as const),
              result: typeof event.result === "string" ? event.result : JSON.stringify(event.result),
            }
          : toolCall,
      );
      return [...prev.slice(0, -1), { ...last, _toolCalls: calls }];
    }
    return prev;
  }

  if (event.type === "tool_execution_update") {
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._toolCalls) {
      const partialDetails = extractCardDetailsFromPartial(event.toolName, event.partialResult);
      const calls = last._toolCalls.map((toolCall) => {
        if (toolCall.toolCallId !== event.toolCallId) return toolCall;
        const updated: ToolCallInfo = {
          ...toolCall,
          partialResult:
            typeof event.partialResult === "string" ? event.partialResult : JSON.stringify(event.partialResult),
        };
        if (partialDetails) {
          updated._card = partialDetails;
        }
        return updated;
      });
      return [...prev.slice(0, -1), { ...last, _toolCalls: calls }];
    }
    return prev;
  }

  if (event.type === "agent_end") {
    let updated = prev;
    const runEndIndex = updated.length - 1;
    const changes = aggregateFileChanges(updated, runEndIndex);
    if (changes.length > 0) {
      updated = attachRunChanges(updated, runEndIndex, changes);
    }
    const last = updated[updated.length - 1];
    if (last?._streaming) {
      return [...updated.slice(0, -1), { ...last, _streaming: false }];
    }
    return updated;
  }

  if (event.type === "error") {
    return appendErrorMessage(prev, event.message, event.code);
  }

  return prev;
}

function extractCardDetailsFromPartial(
  toolName: string,
  partialResult: unknown,
): ChatCard | undefined {
  if (!isObject(partialResult)) return undefined;
  const details = partialResult.details;
  if (toolName === "render_card" && isRenderCardDetails(details)) {
    return details;
  }
  if (toolName === "generate_image" && isImageCardDetails(details)) {
    return details;
  }
  return undefined;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

interface ToolResultDetailsBag {
  result: string;
  isError: boolean;
  details: unknown;
}

function collectToolResultDetails(history: unknown[]): Map<string, ToolResultDetailsBag> {
  const map = new Map<string, ToolResultDetailsBag>();
  for (const entry of history) {
    if (!isToolResultMessage(entry)) continue;
    const text = extractText(entry.content);
    map.set(entry.toolCallId, {
      result: text,
      isError: entry.isError ?? false,
      details: entry.details,
    });
  }
  return map;
}

function buildCardFromToolResult(
  toolName: string,
  toolCall: AgentToolCall,
  details: unknown,
): ChatCard | undefined {
  if (toolName === "render_card" && isRenderCardResultDetails(details)) {
    const card: RenderCardDetails = {
      type: "html",
      html: details.html ?? (details.file_path ? undefined : getStringArg(toolCall.arguments, "content")),
      file_path: details.file_path,
      title: details.title,
      width: details.width,
      height: details.height ?? 400,
      max_width: details.max_width ?? 800,
      max_height: details.max_height ?? 600,
    };
    return card;
  }
  if (toolName === "generate_image" && isImageCardResultDetails(details)) {
    const card: ImageCardDetails = {
      type: "image",
      status: details.status ?? "done",
      path: details.path,
      prompt: details.prompt ?? "",
      model: details.model,
      mimeType: details.mimeType,
      errorMessage: details.errorMessage,
    };
    return card;
  }
  return undefined;
}

function getStringArg(args: unknown, key: string): string | undefined {
  if (!isObject(args)) return undefined;
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

export function parseHistoryMessages(history: unknown[]): ChatMessage[] {
  const toolResultMap = collectToolResultDetails(history);

  const loaded: ChatMessage[] = [];
  for (const entry of history) {
    if (isUserMessage(entry)) {
      loaded.push({
        role: "user",
        content: extractText(entry.content),
        timestamp: entry.timestamp,
      });
      continue;
    }
    if (isAssistantMessage(entry)) {
      const toolCalls = extractToolCallsFromAssistantContent(entry);
      const enrichedToolCalls = enrichToolCalls(toolCalls, entry.content, toolResultMap);
      loaded.push({
        role: "assistant",
        content: extractText(entry.content),
        ...(enrichedToolCalls && enrichedToolCalls.length > 0 ? { _toolCalls: enrichedToolCalls } : {}),
        ...(entry.stopReason === "error" ? { _error: entry.errorMessage ?? "Unknown error" } : {}),
        timestamp: entry.timestamp,
      });
      continue;
    }
  }

  const runEndIndices: number[] = [];
  for (let i = 1; i < loaded.length; i++) {
    if (loaded[i].role === "user") {
      runEndIndices.push(i - 1);
    }
  }
  if (loaded.length > 0) {
    runEndIndices.push(loaded.length - 1);
  }

  let result = loaded;
  for (const runEndIndex of runEndIndices) {
    const changes = aggregateFileChanges(result, runEndIndex);
    if (changes.length > 0) {
      result = attachRunChanges(result, runEndIndex, changes);
    }
  }
  return result;
}

function enrichToolCalls(
  toolCalls: ToolCallInfo[] | undefined,
  content: AssistantMessage["content"],
  toolResultMap: Map<string, ToolResultDetailsBag>,
): ToolCallInfo[] | undefined {
  if (!toolCalls) return undefined;
  if (!Array.isArray(content)) return toolCalls;
  return toolCalls.map((info) => {
    const original = content.find(
      (c): c is AgentToolCall => isToolCall(c) && c.id === info.toolCallId,
    );
    if (!original) return info;
    const toolResult = toolResultMap.get(info.toolCallId);
    const card = buildCardFromToolResult(original.name, original, toolResult?.details);
    return {
      ...info,
      result: toolResult?.result,
      status: toolResult
        ? toolResult.isError
          ? ("error" as const)
          : ("completed" as const)
        : ("completed" as const),
      ...(card ? { _card: card } : {}),
    };
  });
}
