import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import type { AgentEvent, ChatMessage, ToolCallInfo } from "../../../lib/types";

export function useChatSession({
  client,
  sessionId,
  initialMessage,
}: {
  client: ApiClient;
  sessionId: string;
  initialMessage?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const initialMessageRef = useRef(initialMessage);

  const handleWsEvent = useCallback((event: AgentEvent) => {
    if (event.type === "message_update" && event.message?.role === "assistant") {
      const textContent = event.message.content?.find(
        (content: any) => content.type === "text",
      );
      setMessages((prev) => {
        const text = textContent?.text ?? "";
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last._streaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: text, _streaming: true },
          ];
        }
        if (text || last?.role !== "assistant") {
          return [
            ...prev,
            { role: "assistant", content: text, _streaming: true },
          ];
        }
        return prev;
      });
    } else if (event.type === "message_end" && event.message?.role === "assistant") {
      const textContent = event.message.content?.find(
        (content: any) => content.type === "text",
      );
      setMessages((prev) => {
        const text = textContent?.text ?? "";
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last._streaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: text, _streaming: false },
          ];
        }
        if (text || last?.role !== "assistant") {
          return [
            ...prev,
            { role: "assistant", content: text, _streaming: false },
          ];
        }
        return prev;
      });
      setStreaming(false);
    } else if (event.type === "tool_execution_start") {
      const toolCall: ToolCallInfo = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args ?? {},
        status: "running",
      };
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return [
            ...prev.slice(0, -1),
            { ...last, _toolCalls: [...(last._toolCalls ?? []), toolCall] },
          ];
        }
        return [
          ...prev,
          {
            role: "assistant",
            content: "",
            _streaming: true,
            _toolCalls: [toolCall],
          },
        ];
      });
    } else if (event.type === "tool_execution_end") {
      setMessages((prev) => {
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
      });
    } else if (event.type === "tool_execution_update") {
      setMessages((prev) => {
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
              event.partialResult.details?.type === "html"
            ) {
              updated._card = event.partialResult.details;
            }
            return updated;
          });
          return [...prev.slice(0, -1), { ...last, _toolCalls: calls }];
        }
        return prev;
      });
    } else if (event.type === "agent_end_done") {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?._streaming) {
          return [...prev.slice(0, -1), { ...last, _streaming: false }];
        }
        return prev;
      });
      setStreaming(false);
    } else if (event.type === "error") {
      setStreaming(false);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `[Error] ${event.message}` },
      ]);
    }
  }, []);

  useEffect(() => {
    setMessages([]);
    client.getSessionMessages(sessionId).then((history: any[]) => {
      setMessages(parseHistoryMessages(history));
    });

    const ws = client.createChatWebSocket(sessionId, handleWsEvent);
    wsRef.current = ws;

    if (initialMessageRef.current) {
      const message = initialMessageRef.current;
      const originalOnOpen = ws.onopen;
      ws.onopen = () => {
        originalOnOpen?.call(ws, new Event("open") as any);
        setMessages((prev) => [...prev, { role: "user", content: message }]);
        ws.send(JSON.stringify({ type: "message", content: message }));
        setStreaming(true);
        initialMessageRef.current = undefined;
      };
    }

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [client, handleWsEvent, sessionId]);

  const sendMessage = useCallback((text: string) => {
    const content = text.trim();
    if (!content || streaming) return;
    setMessages((prev) => [...prev, { role: "user", content }]);
    setStreaming(true);
    wsRef.current?.send(JSON.stringify({ type: "message", content }));
  }, [streaming]);

  const abort = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "abort" }));
    setStreaming(false);
  }, []);

  return {
    messages,
    streaming,
    sendMessage,
    abort,
  };
}

function parseHistoryMessages(history: any[]): ChatMessage[] {
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
