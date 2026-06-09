import type { AgentEvent, ChatMessage, ToolCallInfo } from "../../lib/types";

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
    const nextMessages = applyEventToMessages(messages, event);
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

export function appendErrorMessage(prev: ChatMessage[], message: string): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last?.role === "assistant" && last._streaming) {
    return [
      ...prev.slice(0, -1),
      {
        ...last,
        content: last.content ? `${last.content}\n\n[Error] ${message}` : `[Error] ${message}`,
      },
    ];
  }
  return [...prev, { role: "assistant", content: `[Error] ${message}` }];
}

export function mergeHistoryMessages(current: ChatMessage[], history: ChatMessage[]): ChatMessage[] {
  if (current.length === 0) return history;
  if (history.length === 0) return current;
  return [...history, ...current];
}

function applyEventToStreaming(event: AgentEvent): boolean | null {
  if (event.type === "agent_start") return true;
  if (event.type === "agent_end") return false;
  return null;
}

function applyEventToMessages(prev: ChatMessage[], event: AgentEvent): ChatMessage[] {
  if (event.type === "message_start" && event.message?.role === "assistant") {
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._streaming) return prev;
    return [...prev, { role: "assistant", content: "", _streaming: true }];
  }

  if (event.type === "message_update" && event.message?.role === "assistant") {
    const textContent = event.message.content?.find(
      (content: any) => content.type === "text",
    );
    const text = textContent?.text ?? "";
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._streaming) {
      return [...prev.slice(0, -1), { ...last, content: text, _streaming: true }];
    }
    if (text || last?.role !== "assistant") {
      return [...prev, { role: "assistant", content: text, _streaming: true }];
    }
    return prev;
  }

  if (event.type === "message_end" && event.message?.role === "assistant") {
    const textContent = event.message.content?.find(
      (content: any) => content.type === "text",
    );
    const text = textContent?.text ?? "";
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._streaming) {
      return [...prev.slice(0, -1), { ...last, content: text, _streaming: false }];
    }
    if (text || last?.role !== "assistant") {
      return [...prev, { role: "assistant", content: text, _streaming: false }];
    }
    return prev;
  }

  if (event.type === "tool_execution_start") {
    const toolCall: ToolCallInfo = {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: event.args ?? {},
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
              status: (event.isError ? "error" : "completed") as ToolCallInfo["status"],
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
      const calls = last._toolCalls.map((toolCall) => {
        if (toolCall.toolCallId !== event.toolCallId) return toolCall;
        const updated: ToolCallInfo = {
          ...toolCall,
          partialResult: typeof event.partialResult === "string" ? event.partialResult : JSON.stringify(event.partialResult),
        };
        if (
          toolCall.toolName === "render_card" &&
          event.partialResult &&
          typeof event.partialResult === "object" &&
          (event.partialResult as any).details?.type === "html"
        ) {
          updated._card = (event.partialResult as any).details;
        }
        return updated;
      });
      return [...prev.slice(0, -1), { ...last, _toolCalls: calls }];
    }
    return prev;
  }

  if (event.type === "agent_end") {
    const last = prev[prev.length - 1];
    if (last?._streaming) {
      return [...prev.slice(0, -1), { ...last, _streaming: false }];
    }
    return prev;
  }

  if (event.type === "error") {
    return appendErrorMessage(prev, event.message);
  }

  return prev;
}

export function parseHistoryMessages(history: any[]): ChatMessage[] {
  const toolResultMap = new Map<string, { result: string; isError: boolean; details?: any }>();
  for (const message of history) {
    if (message.role === "toolResult" && message.toolCallId) {
      const text = (message.content ?? [])
        .filter((content: any) => content.type === "text")
        .map((content: any) => content.text)
        .join("");
      toolResultMap.set(message.toolCallId, {
        result: text,
        isError: message.isError ?? false,
        details: message.details,
      });
    }
  }

  const loaded: ChatMessage[] = [];
  for (const message of history) {
    if (message.role === "toolResult") continue;

    const text =
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content
              .filter((content: any) => content.type === "text")
              .map((content: any) => content.text)
              .join("")
          : "";

    const toolCalls: ToolCallInfo[] | undefined =
      Array.isArray(message.content)
        ? message.content
            .filter((content: any) => content.type === "toolCall")
            .map((content: any) => {
              const toolResult = toolResultMap.get(content.id);
              const base: ToolCallInfo = {
                toolCallId: content.id,
                toolName: content.name,
                args: content.arguments ?? {},
                result: toolResult?.result,
                status: toolResult ? (toolResult.isError ? "error" as const : "completed" as const) : "completed" as const,
              };
              if (
                content.name === "render_card" &&
                toolResult?.details?.cardType === "html"
              ) {
                base._card = {
                  type: "html",
                  html: toolResult.details.html,
                  title: toolResult.details.title,
                  width: toolResult.details.width,
                  height: toolResult.details.height ?? 400,
                  max_width: toolResult.details.max_width ?? 800,
                  max_height: toolResult.details.max_height ?? 600,
                };
              }
              return base;
            })
        : undefined;

    loaded.push({
      role: message.role,
      content: text,
      ...(toolCalls && toolCalls.length > 0 ? { _toolCalls: toolCalls } : {}),
    });
  }

  return loaded;
}
