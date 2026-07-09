import type { AgentProfile } from "../../lib/types";
import type { ChatMessage } from "./types";
import { MarkdownContent } from "../../components/MarkdownContent";
import { HtmlCardRenderer } from "./HtmlCard";
import { ImageCardRenderer } from "./ImageCard";
import { ToolCallSection } from "./ToolCallSection";
import { CopyButton } from "./CopyButton";
import { ErrorMessageSection } from "./ErrorMessageSection";
import { FileViewerCard } from "./FileViewerCard";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { formatMessageTime } from "./lib/format-time";

interface MessageItemProps {
  message: ChatMessage;
  agent: AgentProfile;
  showTime?: boolean;
  onNavigateToPath?: (path: string) => void;
}

export function MessageItem({ message, agent, showTime, onNavigateToPath }: MessageItemProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`group max-w-[90%] min-w-0 flex items-end gap-1.5 ${isUser ? "self-end flex-row-reverse" : "self-start"}`}
      data-chat-message
      data-role={message.role}
    >
      <div
        data-chat-bubble
        className={`min-w-0 overflow-hidden rounded-lg px-3.5 py-2.5 leading-7 break-words ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "border border-border bg-card text-card-foreground"
        }`}
      >
        <div className="text-[11px] font-semibold mb-1 opacity-70">
          {message.role === "assistant" && (agent.alias || agent.name)}
        </div>
        <div className="text-sm">
          {message._streaming && message.content === "" ? (
            <ThinkingIndicator />
          ) : (
            <>
              <MarkdownContent variant="chat">{message.content}</MarkdownContent>
              {message._streaming && message.content && <span className="animate-[blink_1s_step-end_infinite]">|</span>}
            </>
          )}
        </div>
        {message._toolCalls && message._toolCalls.length > 0 && (
          <ToolCallSection toolCalls={message._toolCalls} onNavigateToPath={onNavigateToPath} />
        )}
        {message._error && <ErrorMessageSection error={message._error} errorCode={message._errorCode} />}
        {message._toolCalls
          ?.filter((toolCall) => toolCall._card)
          .map((toolCall) => {
            const card = toolCall._card!;
            return card.type === "html" ? (
              <HtmlCardRenderer key={toolCall.toolCallId} card={card} />
            ) : (
              <ImageCardRenderer key={toolCall.toolCallId} card={card} />
            );
          })}
        {message._runChanges && message._runChanges.length > 0 && (
          <div className="mt-5">
            {message._runChanges.map((change) => (
              <FileViewerCard key={change.path} change={change} onNavigateToPath={onNavigateToPath} />
            ))}
          </div>
        )}
      </div>
        {!message._streaming && (
          <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pb-1 ${isUser ? "flex-row-reverse" : ""}`}>
            <CopyButton text={message.content} />
            {showTime && message.timestamp && (
              <time className="text-[11px] text-muted-foreground whitespace-nowrap">
                {formatMessageTime(message.timestamp)}
              </time>
            )}
          </div>
        )}
    </div>
  );
}
