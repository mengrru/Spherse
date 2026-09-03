import type { AgentSummary } from "../../lib/types";
import type { ChatMessage, RenderItem } from "./types";
import { MarkdownContent } from "../../components/markdown-content/MarkdownContent";
import { CardRenderer } from "./CardRenderer";
import { ToolCallSection } from "./ToolCallSection";
import { CopyButton } from "./CopyButton";
import { ErrorMessageSection } from "./ErrorMessageSection";
import { FileViewerCard } from "./FileViewerCard";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { MessageAttachments } from "./MessageAttachments";
import { SendFailedBar } from "./SendFailedBar";
import { WithdrawButton } from "./WithdrawButton";
import { useOpenExternalLink } from "../browser/open-external-url";
import { useChatLinkHandler } from "./hooks/useChatLinkHandler";
import { formatMessageTime } from "./lib/format-time";

interface MessageItemProps {
  item: RenderItem;
  agent: AgentSummary;
  showTime?: boolean;
  supersededToolCallIds?: Set<string>;
  onNavigateToPath?: (path: string) => void;
  onRetry?: () => void;
  onWithdraw?: () => void;
}

export function MessageItem({ item, agent, showTime, supersededToolCallIds, onNavigateToPath, onRetry, onWithdraw }: MessageItemProps) {
  const { message, streaming, sendFailed, withdrawError } = item;
  const isUser = message.role === "user";
  const openLink = useOpenExternalLink();
  const handleLinkClick = useChatLinkHandler(openLink);

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
        {isUser ? (
          <UserMessageBody message={message} onLinkClick={handleLinkClick} />
        ) : (
          <AssistantMessageBody
            message={message}
            agent={agent}
            streaming={streaming}
            supersededToolCallIds={supersededToolCallIds}
            onNavigateToPath={onNavigateToPath}
            onRetry={withdrawError ? undefined : onRetry}
            onLinkClick={handleLinkClick}
          />
        )}
      </div>
        {isUser && sendFailed && <SendFailedBar onRetry={onRetry} />}
        {!streaming && (
          <div className={`flex items-center gap-1 pb-1 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 ${isUser ? "md:flex-row-reverse" : ""}`}>
            {isUser && onWithdraw && <WithdrawButton onWithdraw={onWithdraw} />}
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

function UserMessageBody({
  message,
  onLinkClick,
}: {
  message: ChatMessage;
  onLinkClick: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <>
      <div className="text-sm">
        <MarkdownContent variant="chat" plain linkClassName="text-inherit" onLinkClick={onLinkClick}>{message.content}</MarkdownContent>
      </div>
      {message._attachments && message._attachments.length > 0 && (
        <MessageAttachments attachments={message._attachments} />
      )}
    </>
  );
}

function AssistantMessageBody({
  message,
  agent,
  streaming,
  supersededToolCallIds,
  onNavigateToPath,
  onRetry,
  onLinkClick,
}: {
  message: ChatMessage;
  agent: AgentSummary;
  streaming?: boolean;
  supersededToolCallIds?: Set<string>;
  onNavigateToPath?: (path: string) => void;
  onRetry?: () => void;
  onLinkClick: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <>
      <div className="text-[11px] font-semibold mb-1 opacity-70">
        {agent.alias || agent.name}
      </div>
      <div className="text-sm">
        {streaming && message.content === "" ? (
          <ThinkingIndicator />
        ) : (
          <>
            <MarkdownContent variant="chat" linkClassName="text-inherit" onLinkClick={onLinkClick}>{message.content}</MarkdownContent>
            {streaming && message.content && <span className="animate-[blink_1s_step-end_infinite]">|</span>}
          </>
        )}
      </div>
      {message._toolCalls && message._toolCalls.length > 0 && (
        <ToolCallSection toolCalls={message._toolCalls} onNavigateToPath={onNavigateToPath} />
      )}
      {message._error && <ErrorMessageSection error={message._error} errorCode={message._errorCode} onRetry={onRetry} />}
      {message._toolCalls
        ?.filter((toolCall) => toolCall._card)
        .map((toolCall) => (
          <CardRenderer
            key={toolCall.toolCallId}
            card={toolCall._card!}
            superseded={supersededToolCallIds?.has(toolCall.toolCallId)}
          />
        ))}
      {message._runChanges && message._runChanges.length > 0 && (
        <div className="mt-5">
          {message._runChanges.map((change) => (
            <FileViewerCard key={change.path} change={change} onNavigateToPath={onNavigateToPath} />
          ))}
        </div>
      )}
    </>
  );
}
