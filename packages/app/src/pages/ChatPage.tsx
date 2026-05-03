import { useState, useEffect, useRef, useCallback } from "react";
import type { ApiClient } from "../lib/api";
import type { AgentDefinition, ChatMessage, AgentEvent, ToolCallInfo } from "../lib/types";

interface ChatPageProps {
  client: ApiClient;
  sessionId: string;
  agent: AgentDefinition;
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
    <div className="chat-page">
      <div className="chat-header">
        <span className="chat-agent-name">{agent.name}</span>
        <span className="chat-agent-type">{agent.type}</span>
      </div>
      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message-${msg.role}`}>
            <div className="chat-message-role">
              {msg.role === "user" ? "你" : agent.name}
            </div>
            <div className="chat-message-content">
              {msg.content}
              {msg._streaming && <span className="cursor-blink">|</span>}
            </div>
            {msg._toolCalls && msg._toolCalls.length > 0 && (
              <div className="chat-tool-calls">
                {msg._toolCalls.map((tc, j) => (
                  <div key={j} className={`tool-call-item tool-call-${tc.status}`}>
                    <span className="tool-call-name">{tc.toolName}</span>
                    <span className="tool-call-status">
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
      <div className="chat-input-area">
        <input
          className="chat-input"
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
          <button className="chat-btn chat-btn-abort" onClick={handleAbort}>
            中断
          </button>
        ) : (
          <button
            className="chat-btn chat-btn-send"
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
