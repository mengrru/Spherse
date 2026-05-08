import { useState, useEffect, useRef, useCallback } from "react";
import type { ApiClient } from "../lib/api";
import type { AgentProfile, ChatMessage, AgentEvent, ToolCallInfo } from "../lib/types";

interface ChatPageProps {
  client: ApiClient;
  sessionId: string;
  agent: AgentProfile;
}

export function ChatPage({ client, sessionId, agent }: ChatPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const ws = client.createChatWebSocket(sessionId, (event: AgentEvent) => {
      handleWsEvent(event);
    });
    wsRef.current = ws;

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  const handleWsEvent = useCallback((event: AgentEvent) => {
    if (event.type === "message_update" && event.message?.role === "assistant") {
      const textContent = event.message.content?.find(
        (c: any) => c.type === "text",
      );
      if (textContent) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last._streaming) {
            return [
              ...prev.slice(0, -1),
              { role: "assistant", content: textContent.text, _streaming: true },
            ];
          }
          return [
            ...prev,
            { role: "assistant", content: textContent.text, _streaming: true },
          ];
        });
      }
    } else if (event.type === "message_end" && event.message?.role === "assistant") {
      const textContent = event.message.content?.find(
        (c: any) => c.type === "text",
      );
      if (textContent) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last._streaming) {
            return [
              ...prev.slice(0, -1),
              {
                role: "assistant",
                content: textContent.text,
                _streaming: false,
              },
            ];
          }
          return [
            ...prev,
            { role: "assistant", content: textContent.text, _streaming: false },
          ];
        });
      }
      setStreaming(false);
    } else if (event.type === "tool_call") {
      const tc = event.toolCall;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        const toolCall: ToolCallInfo = {
          toolName: tc?.function?.name ?? "unknown",
          args: tc?.function?.args ?? {},
          status: "running",
        };
        if (last?.role === "assistant") {
          return [
            ...prev.slice(0, -1),
            { ...last, _toolCalls: [...(last._toolCalls ?? []), toolCall] },
          ];
        }
        return prev;
      });
    } else if (event.type === "tool_result") {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last._toolCalls) {
          const calls = last._toolCalls.map((tc, i) =>
            i === last._toolCalls!.length - 1
              ? { ...tc, status: "completed" as const, result: event.result }
              : tc,
          );
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

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setStreaming(true);
    wsRef.current?.send(JSON.stringify({ type: "message", content: text }));
  };

  const handleAbort = () => {
    wsRef.current?.send(JSON.stringify({ type: "abort" }));
    setStreaming(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-surface">
        <span className="font-semibold text-[15px]">{agent.name}</span>
        <span className="text-[11px] px-1.5 py-[1px] rounded bg-[var(--muted-bg)] text-[var(--secondary)]">{agent.type}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`max-w-[80%] py-2.5 px-3.5 rounded-lg leading-relaxed break-words whitespace-pre-wrap ${
              msg.role === "user"
                ? "self-end bg-accent text-white"
                : "self-start bg-surface border border-[var(--border)]"
            }`}
          >
            <div className="text-[11px] font-semibold mb-1 opacity-70">
              {msg.role === "user" ? "你" : agent.name}
            </div>
            <div className="text-sm">
              {msg.content}
              {msg._streaming && <span className="animate-[blink_1s_step-end_infinite]">|</span>}
            </div>
            {msg._toolCalls && msg._toolCalls.length > 0 && (
              <div className="mt-2 pt-2 border-t border-dashed border-[var(--border)]">
                {msg._toolCalls.map((tc, j) => (
                  <div key={j} className={`flex items-center gap-1.5 text-xs py-0.5`}>
                    <span className="font-mono bg-[var(--code-bg)] px-1 py-[1px] rounded-[2px]">{tc.toolName}</span>
                    <span className={tc.status === "running" ? "text-accent" : "text-success"}>
                      {tc.status === "running" ? "..." : "done"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="flex gap-2 px-4 py-3 border-t border-[var(--border)] bg-surface">
        <input
          className="flex-1 px-3 py-2 border border-[var(--border-input)] rounded-md outline-none transition-colors bg-[var(--input-bg)] text-[var(--primary)] focus:border-accent"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入消息..."
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={streaming}
        />
        {streaming ? (
          <button className="px-4 py-2 rounded-md font-medium transition-colors bg-danger text-white hover:bg-danger-hover" onClick={handleAbort}>
            中断
          </button>
        ) : (
          <button
            className="px-4 py-2 rounded-md font-medium transition-colors bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSend}
            disabled={!input.trim()}
          >
            发送
          </button>
        )}
      </div>
    </div>
  );
}
