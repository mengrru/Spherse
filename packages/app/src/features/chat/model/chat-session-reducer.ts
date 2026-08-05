import type { ErrorEventCode } from "@spherse/server/contracts";
import type { ChatMessage, ToolCallInfo } from "../types";
import {
  isAssistantMessage,
  type AgentEvent,
} from "./agent-event-parse";
import {
  commandCardFromResult,
  extractCardFromPartial,
  extractMessageText,
} from "./chat-tool-projection";
import { aggregateFileChanges, attachRunChanges } from "../lib/aggregate-file-changes";

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

function applyEventToStreaming(event: AgentEvent): boolean | null {
  if (event.type === "agent_start") return true;
  if (event.type === "agent_end") return false;
  if (event.type === "run_status") return event.active;
  if (event.type === "error") return false;
  return null;
}

function applyEventToMessages(prev: ChatMessage[], event: AgentEvent, now: number): ChatMessage[] {
  if (event.type === "message_start" && isAssistantMessage(event.message)) {
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._streaming) return prev;
    return [...prev, { role: "assistant", content: "", _streaming: true }];
  }

  if (event.type === "message_update" && isAssistantMessage(event.message)) {
    const text = extractMessageText(event.message.content);
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
    const text = extractMessageText(event.message.content);
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
      const calls = last._toolCalls.map((toolCall) => {
        if (toolCall.toolCallId !== event.toolCallId) return toolCall;
        const updated: ToolCallInfo = {
          ...toolCall,
          status: event.isError ? ("error" as const) : ("completed" as const),
          result: typeof event.result === "string" ? event.result : JSON.stringify(event.result),
        };
        const finalCard = event.toolName === "run_command" ? commandCardFromResult(event.result, toolCall) : undefined;
        if (finalCard) updated._card = finalCard;
        return updated;
      });
      return [...prev.slice(0, -1), { ...last, _toolCalls: calls }];
    }
    return prev;
  }

  if (event.type === "tool_execution_update") {
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._toolCalls) {
      const partialDetails = extractCardFromPartial(
        event.toolName,
        event.partialResult,
      );
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

  if (event.type === "control_request" && event.kind === "approval") {
    return updateLastToolCall(prev, (tc) => tc.toolCallId === event.toolCallId, (tc) => ({
      ...tc,
      _card:
        tc.toolName === "run_command"
          ? {
              type: "command",
              status: "pending_approval",
              command: typeof tc.args.command === "string" ? tc.args.command : "",
              cwd: typeof tc.args.cwd === "string" ? tc.args.cwd : undefined,
              stdout: "",
              stderr: "",
              requestId: event.requestId,
            }
          : {
              type: "approval",
              status: "pending",
              toolName: tc.toolName,
              args: tc.args,
              requestId: event.requestId,
            },
    }));
  }

  if (event.type === "control_resolved" && event.kind === "approval") {
    return updateLastToolCall(
      prev,
      (tc) =>
        (tc._card?.type === "command" || tc._card?.type === "approval") &&
        tc._card.requestId === event.requestId,
      (tc) => {
        if (tc._card?.type === "approval") {
          return {
            ...tc,
            _card: {
              ...tc._card,
              status: event.approved ? "approved" : "rejected",
              requestId: undefined,
            },
          };
        }
        if (tc._card?.type !== "command") return tc;
        return {
          ...tc,
          _card: event.approved
            ? { ...tc._card, status: "running", requestId: undefined }
            : { ...tc._card, status: "error", rejected: true, requestId: undefined },
        };
      },
    );
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

  if (event.type === "run_status" && !event.active) {
    const last = prev[prev.length - 1];
    if (last?._streaming) {
      return [...prev.slice(0, -1), { ...last, _streaming: false }];
    }
  }

  if (event.type === "error") {
    return appendErrorMessage(prev, event.message, event.code);
  }

  return prev;
}

function updateLastToolCall(
  prev: ChatMessage[],
  match: (tc: ToolCallInfo) => boolean,
  update: (tc: ToolCallInfo) => ToolCallInfo,
): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (!last || last.role !== "assistant" || !last._toolCalls) return prev;
  let changed = false;
  const calls = last._toolCalls.map((tc) => {
    if (!match(tc)) return tc;
    changed = true;
    return update(tc);
  });
  if (!changed) return prev;
  return [...prev.slice(0, -1), { ...last, _toolCalls: calls }];
}
