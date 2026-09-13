import { useCallback } from "react";
import type { ChatAttachment } from "./types";
import { MarkdownContent } from "../../components/markdown-content/MarkdownContent";
import { CopyButton } from "./CopyButton";
import { MessageAttachments } from "./MessageAttachments";
import { SendFailedBar } from "./SendFailedBar";
import { WithdrawButton } from "./WithdrawButton";
import { formatMessageTime } from "./lib/format-time";
import { useOpenExternalLink } from "../browser/open-external-url";

interface UserBubbleProps {
  text: string;
  attachments?: ChatAttachment[];
  sendFailed?: boolean;
  timestamp?: number;
  showTime?: boolean;
  onWithdraw?: () => void;
  onRetry?: () => void;
}

export function UserBubble({
  text,
  attachments,
  sendFailed,
  timestamp,
  showTime,
  onWithdraw,
  onRetry,
}: UserBubbleProps) {
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
      className="group max-w-[90%] min-w-0 flex items-start gap-1.5 self-end flex-row-reverse"
      data-chat-message
      data-role="user"
    >
      <div className="flex min-w-0 flex-col gap-1 items-end md:flex-row-reverse md:items-end md:gap-1.5">
        <div
          data-chat-bubble
          className="max-w-full min-w-0 overflow-hidden rounded-lg px-3.5 py-2.5 leading-7 break-words bg-primary text-primary-foreground"
        >
          <div className="text-sm">
            <MarkdownContent variant="chat" plain linkClassName="text-inherit" onLinkClick={handleLinkClick}>{text}</MarkdownContent>
          </div>
          {attachments && attachments.length > 0 && (
            <MessageAttachments attachments={attachments} />
          )}
        </div>
        {sendFailed && <SendFailedBar onRetry={onRetry} />}
        <div className="flex items-center gap-1 pb-1 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:flex-row-reverse">
          {onWithdraw && <WithdrawButton onWithdraw={onWithdraw} />}
          <CopyButton text={text} />
          {showTime && timestamp && (
            <time className="text-[11px] text-muted-foreground whitespace-nowrap">
              {formatMessageTime(timestamp)}
            </time>
          )}
        </div>
      </div>
    </div>
  );
}
