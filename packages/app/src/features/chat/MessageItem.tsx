import { useCallback } from "react";
import type { AgentProfile } from "../../lib/types";
import type { ChatMessage } from "./types";
import { MarkdownContent } from "../../components/MarkdownContent";
import { HtmlCardRenderer } from "./HtmlCard";
import { ImageCardRenderer } from "./ImageCard";
import { CommandCardRenderer } from "./CommandCard";
import { ApprovalCardRenderer } from "./ApprovalCard";
import { ToolCallSection } from "./ToolCallSection";
import { CopyButton } from "./CopyButton";
import { ErrorMessageSection } from "./ErrorMessageSection";
import { FileViewerCard } from "./FileViewerCard";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { MessageAttachments } from "./MessageAttachments";
import { useOpenExternalLink } from "../browser/open-external-url";
import { formatMessageTime } from "./lib/format-time";

interface MessageItemProps {
  message: ChatMessage;
  agent: AgentProfile;
  showTime?: boolean;
  supersededToolCallIds?: Set<string>;
  onNavigateToPath?: (path: string) => void;
  onRespondApproval?: (requestId: string, approved: boolean) => void;
}

export function MessageItem({ message, agent, showTime, supersededToolCallIds, onNavigateToPath, onRespondApproval }: MessageItemProps) {
  const isUser = message.role === "user";
  const openLink = useOpenExternalLink();

  const handleLinkClick = useCallback(
    async (href: string, event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!href) return;
      event.preventDefault();
      if (href.startsWith("#")) {
        if (href.length > 1) {
          document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      openLink(href);
    },
    [openLink],
  );

  return (
    <div
      className={`group max-w-[90%] min-w-0 flex items-start gap-1.5 ${isUser ? "self-end flex-row-reverse" : "self-start flex-row"}`}
      data-chat-message
      data-role={message.role}
    >
      <div
        className={`flex min-w-0 flex-col gap-1 ${isUser ? "items-end md:flex-row-reverse" : "items-start md:flex-row"} md:items-end md:gap-1.5`}
      >
      <div
        data-chat-bubble
        className={`max-w-full min-w-0 overflow-hidden rounded-lg px-3.5 py-2.5 leading-7 break-words ${
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
              <MarkdownContent variant="chat" onLinkClick={handleLinkClick}>{message.content}</MarkdownContent>
              {message._streaming && message.content && <span className="animate-[blink_1s_step-end_infinite]">|</span>}
            </>
          )}
        </div>
        {isUser && message._attachments && message._attachments.length > 0 && (
          <MessageAttachments attachments={message._attachments} />
        )}
        {message._toolCalls && message._toolCalls.length > 0 && (
          <ToolCallSection toolCalls={message._toolCalls} onNavigateToPath={onNavigateToPath} />
        )}
        {message._error && <ErrorMessageSection error={message._error} errorCode={message._errorCode} />}
        {message._toolCalls
          ?.filter((toolCall) => toolCall._card)
          .map((toolCall) => {
            const card = toolCall._card!;
            if (card.type === "html") {
              return (
                <HtmlCardRenderer
                  key={toolCall.toolCallId}
                  card={card}
                  defaultCollapsed={supersededToolCallIds?.has(toolCall.toolCallId) ?? false}
                />
              );
            }
            if (card.type === "command") {
              return <CommandCardRenderer key={toolCall.toolCallId} card={card} onRespondApproval={onRespondApproval} />;
            }
            if (card.type === "approval") {
              return <ApprovalCardRenderer key={toolCall.toolCallId} card={card} onRespondApproval={onRespondApproval} />;
            }
            return <ImageCardRenderer key={toolCall.toolCallId} card={card} />;
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
          <div className={`flex items-center gap-1 pb-1 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 ${isUser ? "md:flex-row-reverse" : ""}`}>
            <CopyButton text={message.content} />
            {showTime && message.timestamp && (
              <time className="text-[11px] text-muted-foreground whitespace-nowrap">
                {formatMessageTime(message.timestamp)}
              </time>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
