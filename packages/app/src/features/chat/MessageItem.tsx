import type { AgentProfile, ChatMessage } from "../../lib/types";
import { MarkdownContent } from "../../components/MarkdownContent";
import { HtmlCardRenderer } from "./HtmlCard";
import { ToolCallSection } from "./ToolCallSection";
import { CopyButton } from "./CopyButton";
import { ErrorMessageSection } from "./ErrorMessageSection";

interface MessageItemProps {
  message: ChatMessage;
  agent: AgentProfile;
  onNavigateToPath?: (path: string) => void;
}

export function MessageItem({ message, agent, onNavigateToPath }: MessageItemProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`group max-w-[80%] flex items-end gap-1.5 ${isUser ? "self-end flex-row-reverse" : "self-start"}`}
      data-chat-message
      data-role={message.role}
    >
      <div
        className={`rounded-lg px-3.5 py-2.5 leading-7 break-words ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "border border-border bg-card text-card-foreground"
        }`}
      >
        <div className="text-[11px] font-semibold mb-1 opacity-70">
          {message.role === "assistant" && agent.name}
        </div>
        <div className="text-sm">
          <MarkdownContent variant="chat">{message.content}</MarkdownContent>
          {message._streaming && <span className="animate-[blink_1s_step-end_infinite]">|</span>}
        </div>
        {message._toolCalls && message._toolCalls.length > 0 && (
          <ToolCallSection toolCalls={message._toolCalls} onNavigateToPath={onNavigateToPath} />
        )}
        {message._error && <ErrorMessageSection error={message._error} />}
        {message._toolCalls
          ?.filter((toolCall) => toolCall._card)
          .map((toolCall) => (
            <HtmlCardRenderer key={toolCall.toolCallId} card={toolCall._card!} />
          ))}
      </div>
      {!message._streaming && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity pb-1">
          <CopyButton text={message.content} />
        </div>
      )}
    </div>
  );
}
