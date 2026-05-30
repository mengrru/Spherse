import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import type { ApiClient } from "../lib/api";
import type { AgentProfile, ChatMessage, AgentEvent, ToolCallInfo, HtmlCard } from "../lib/types";
import { ToolCallSection } from "../components/ToolCallSection";
import { HtmlCardRenderer } from "../components/HtmlCard";
import { MarkdownContent } from "../components/MarkdownContent";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { ChevronsDownIcon, ChevronsUpIcon, SendIcon, SquareIcon } from "lucide-react";

const LINE_HEIGHT = 20;
const PADDING_Y = 16;
const MIN_HEIGHT = 4 * LINE_HEIGHT + PADDING_Y;
const MID_HEIGHT = 10 * LINE_HEIGHT + PADDING_Y;
const MAX_HEIGHT = 20 * LINE_HEIGHT + PADDING_Y;

interface ChatPageProps {
  client: ApiClient;
  sessionId: string;
  agent: AgentProfile;
  onNavigateToPath?: (path: string) => void;
  initialMessage?: string;
}

export function ChatPage({ client, sessionId, agent, onNavigateToPath, initialMessage }: ChatPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [manualExpanded, setManualExpanded] = useState(false);
  const [contentExceeds3Lines, setContentExceeds3Lines] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialMessageRef = useRef(initialMessage);

  // session 切换后首次加载历史消息时用 instant 跳到底部，避免从顶部平滑滚动；
  // 后续新消息（用户发送 / assistant 回复）使用 smooth 滚动
  const initialScrollDone = useRef(false);

  useEffect(() => {
    if (!initialScrollDone.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      if (messages.length > 0) initialScrollDone.current = true;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const natural = ta.scrollHeight;
    const exceeds = natural > MIN_HEIGHT + 4;
    setContentExceeds3Lines(exceeds);
    if (!exceeds && manualExpanded) {
      setManualExpanded(false);
      return;
    }
    if (manualExpanded) {
      ta.style.height = `${MAX_HEIGHT}px`;
      ta.style.overflowY = natural > MAX_HEIGHT ? "auto" : "hidden";
    } else {
      const targetHeight = Math.max(MIN_HEIGHT, Math.min(natural, MID_HEIGHT));
      ta.style.height = `${targetHeight}px`;
      ta.style.overflowY = natural > MID_HEIGHT ? "auto" : "hidden";
    }
  }, [input, manualExpanded]);

  useEffect(() => {
    setMessages([]);
    initialScrollDone.current = false;
    client.getSessionMessages(sessionId).then((history: any[]) => {
      const toolResultMap = new Map<string, { result: string; isError: boolean; details?: any }>();
      for (const m of history) {
        if (m.role === "toolResult" && m.toolCallId) {
          const text = (m.content ?? [])
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("");
          toolResultMap.set(m.toolCallId, {
            result: text,
            isError: m.isError ?? false,
            details: m.details,
          });
        }
      }

      const loaded: ChatMessage[] = [];
      for (const m of history) {
        if (m.role === "toolResult") continue;

        const text =
          typeof m.content === "string"
            ? m.content
            : Array.isArray(m.content)
              ? m.content
                  .filter((c: any) => c.type === "text")
                  .map((c: any) => c.text)
                  .join("")
              : "";

        const toolCalls: ToolCallInfo[] | undefined =
          Array.isArray(m.content)
            ? m.content
                .filter((c: any) => c.type === "toolCall")
                .map((c: any) => {
                  const tr = toolResultMap.get(c.id);
                  const base: ToolCallInfo = {
                    toolCallId: c.id,
                    toolName: c.name,
                    args: c.arguments ?? {},
                    result: tr?.result,
                    status: tr ? (tr.isError ? "error" as const : "completed" as const) : "completed" as const,
                  };
                  if (
                    c.name === "render_card" &&
                    tr?.details?.cardType === "html"
                  ) {
                    base._card = {
                      type: "html",
                      html: tr.details.html,
                      title: tr.details.title,
                      width: tr.details.width,
                      height: tr.details.height ?? 400,
                      max_width: tr.details.max_width ?? 800,
                      max_height: tr.details.max_height ?? 600,
                    };
                  }
                  return base;
                })
            : undefined;

        loaded.push({
          role: m.role,
          content: text,
          ...(toolCalls && toolCalls.length > 0 ? { _toolCalls: toolCalls } : {}),
        });
      }
      setMessages(loaded);
    });

    const ws = client.createChatWebSocket(sessionId, (event: AgentEvent) => {
      handleWsEvent(event);
    });
    wsRef.current = ws;

    if (initialMessageRef.current) {
      const msg = initialMessageRef.current;
      const origOnOpen = ws.onopen;
      ws.onopen = () => {
        origOnOpen?.call(ws, new Event("open") as any);
        setMessages((prev) => [...prev, { role: "user", content: msg }]);
        ws.send(JSON.stringify({ type: "message", content: msg }));
        setStreaming(true);
        initialMessageRef.current = undefined;
      };
    }

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
        (c: any) => c.type === "text",
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
          const calls = last._toolCalls.map((tc) =>
            tc.toolCallId === event.toolCallId
              ? {
                  ...tc,
                  status: (event.isError ? "error" : "completed") as ToolCallInfo["status"],
                  result: typeof event.result === "string" ? event.result : JSON.stringify(event.result),
                }
              : tc,
          );
          return [...prev.slice(0, -1), { ...last, _toolCalls: calls }];
        }
        return prev;
      });
    } else if (event.type === "tool_execution_update") {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last._toolCalls) {
          const calls = last._toolCalls.map((tc) => {
            if (tc.toolCallId !== event.toolCallId) return tc;
            const updated: ToolCallInfo = {
              ...tc,
              partialResult: typeof event.partialResult === "string" ? event.partialResult : JSON.stringify(event.partialResult),
            };
            if (
              tc.toolName === "render_card" &&
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

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setStreaming(true);
    setManualExpanded(false);
    wsRef.current?.send(JSON.stringify({ type: "message", content: text }));
  };

  const handleAbort = () => {
    wsRef.current?.send(JSON.stringify({ type: "abort" }));
    setStreaming(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-3">
        <span className="font-semibold text-[15px]">{agent.name}</span>
        <Badge variant="secondary">{agent.type}</Badge>
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`max-w-[80%] rounded-lg px-3.5 py-2.5 leading-7 break-words ${
              msg.role === "user"
                ? "self-end bg-primary text-primary-foreground"
                : "self-start border border-border bg-card text-card-foreground"
            }`}
          >
            <div className="text-[11px] font-semibold mb-1 opacity-70">
              {msg.role === "assistant" && agent.name}
            </div>
            <div className="text-sm">
              {msg.role === "assistant" ? (
                <MarkdownContent variant="chat">{msg.content}</MarkdownContent>
              ) : (
                msg.content
              )}
              {msg._streaming && <span className="animate-[blink_1s_step-end_infinite]">|</span>}
            </div>
            {msg._toolCalls && msg._toolCalls.length > 0 && (
              <ToolCallSection toolCalls={msg._toolCalls} onNavigateToPath={onNavigateToPath} />
            )}
            {msg._toolCalls
              ?.filter((tc) => tc._card)
              .map((tc) => (
                <HtmlCardRenderer key={tc.toolCallId} card={tc._card!} />
              ))}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="border-t border-border bg-background p-3">
        <div className="relative rounded-lg border border-input bg-background transition-colors focus-within:border-ring">
          <Textarea
            ref={textareaRef}
            className="min-h-0 w-full resize-none border-none bg-transparent py-2 pr-12 pl-3 text-sm leading-5 shadow-none focus-visible:ring-0"
            style={{ height: `${MIN_HEIGHT}px`, overflowY: "hidden" }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入消息... (Shift+Enter 换行)"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={streaming}
          />
          {contentExceeds3Lines && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute top-1.5 right-2.5"
              onClick={() => setManualExpanded((v) => !v)}
              title={manualExpanded ? "收起" : "展开"}
            >
              {manualExpanded ? <ChevronsDownIcon /> : <ChevronsUpIcon />}
            </Button>
          )}
          <div className="absolute bottom-2 right-2">
            {streaming ? (
              <Button variant="destructive" size="icon-lg" onClick={handleAbort}>
                <SquareIcon />
              </Button>
            ) : (
              <Button
                size="icon-lg"
                onClick={handleSend}
                disabled={!input.trim()}
              >
                <SendIcon />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
