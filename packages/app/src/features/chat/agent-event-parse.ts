import type {
  AgentMessage,
  AssistantMessage,
  ImageCardDetails,
  ImageCardResultDetails,
  RenderCardDetails,
  RenderCardResultDetails,
  TextContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@spherse/core";
import type { ChatServerEvent, ErrorEventCode } from "@spherse/server/contracts";

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage }
  | { type: "message_end"; message: AgentMessage }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | { type: "error"; message: string; code?: ErrorEventCode }
  | { type: "pong" };

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

export function isTextContent(x: unknown): x is TextContent {
  return isObject(x) && x.type === "text" && typeof x.text === "string";
}

export function isToolCall(x: unknown): x is ToolCall {
  return (
    isObject(x) &&
    x.type === "toolCall" &&
    typeof x.id === "string" &&
    typeof x.name === "string"
  );
}

export function isUserMessage(x: unknown): x is UserMessage {
  return isObject(x) && x.role === "user";
}

export function isAssistantMessage(x: unknown): x is AssistantMessage {
  return isObject(x) && x.role === "assistant";
}

export function isToolResultMessage(x: unknown): x is ToolResultMessage {
  return isObject(x) && x.role === "toolResult";
}

export function isAgentMessage(x: unknown): x is AgentMessage {
  return isUserMessage(x) || isAssistantMessage(x) || isToolResultMessage(x);
}

const FALLBACK_MESSAGE: AgentMessage = {
  role: "user",
  content: "",
  timestamp: 0,
};

export function parseAgentMessage(payload: unknown): AgentMessage {
  return isAgentMessage(payload) ? payload : FALLBACK_MESSAGE;
}

function parseToolResultMessages(payload: unknown): ToolResultMessage[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter(isToolResultMessage);
}

export function isRenderCardDetails(x: unknown): x is RenderCardDetails {
  return isObject(x) && x.type === "html";
}

export function isRenderCardResultDetails(x: unknown): x is RenderCardResultDetails {
  return isObject(x) && x.cardType === "html";
}

export function isImageCardDetails(x: unknown): x is ImageCardDetails {
  return (
    isObject(x) &&
    x.type === "image" &&
    (x.status === "generating" || x.status === "done" || x.status === "error") &&
    typeof x.prompt === "string"
  );
}

export function isImageCardResultDetails(x: unknown): x is ImageCardResultDetails {
  return (
    isObject(x) &&
    x.cardType === "image" &&
    (x.status === "generating" || x.status === "done" || x.status === "error")
  );
}

export function parseAgentEvent(event: ChatServerEvent): AgentEvent {
  switch (event.type) {
    case "agent_start":
    case "turn_start":
    case "pong":
    case "error":
      return event;
    case "tool_execution_start":
      return {
        type: "tool_execution_start",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: toArgsRecord(event.args),
      };
    case "tool_execution_update":
      return {
        type: "tool_execution_update",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: toArgsRecord(event.args),
        partialResult: event.partialResult,
      };
    case "tool_execution_end":
      return {
        type: "tool_execution_end",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      };
    case "agent_end":
      return {
        type: "agent_end",
        messages: Array.isArray(event.messages) ? event.messages.map(parseAgentMessage) : [],
      };
    case "turn_end":
      return {
        type: "turn_end",
        message: parseAgentMessage(event.message),
        toolResults: parseToolResultMessages(event.toolResults),
      };
    case "message_start":
      return { type: "message_start", message: parseAgentMessage(event.message) };
    case "message_update":
      return { type: "message_update", message: parseAgentMessage(event.message) };
    case "message_end":
      return { type: "message_end", message: parseAgentMessage(event.message) };
  }
}

function toArgsRecord(args: unknown): Record<string, unknown> {
  return isObject(args) ? args : {};
}
