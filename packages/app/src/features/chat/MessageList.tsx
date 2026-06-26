import type { RefObject } from "react";
import { useI18n } from "@spherse/i18n/react";
import type { AgentProfile } from "../../lib/types";
import type { ChatMessage } from "./types";
import { Button } from "../../components/ui/button";
import { ChevronDownIcon } from "lucide-react";
import { MessageItem } from "./MessageItem";

interface MessageListProps {
  messages: ChatMessage[];
  agent: AgentProfile;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  onScrollToBottom: () => void;
  onNavigateToPath?: (path: string) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

export function MessageList({ messages, agent, messagesEndRef, containerRef, isAtBottom, onScrollToBottom, onNavigateToPath, hasMore, loadingMore, onLoadMore }: MessageListProps) {
  const { t } = useI18n();
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4">
        <div className="text-muted-foreground text-sm font-medium">{agent.name}</div>
        <div className="text-muted-foreground text-sm">{t("chat.startConversation")}</div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={containerRef} className="h-full overflow-y-auto p-4 flex flex-col gap-3" data-chat-messages>
        {hasMore && (
          <div className="flex justify-center py-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loadingMore}
              onClick={onLoadMore}
            >
              {loadingMore ? t("common.loading") : t("chat.loadMore")}
            </Button>
          </div>
        )}
        {messages.map((message, index) => (
          <MessageItem
            key={index}
            message={message}
            agent={agent}
            onNavigateToPath={onNavigateToPath}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>
      {!isAtBottom && (
        <div className="absolute bottom-4 right-4">
          <Button
            variant="outline"
            size="icon-lg"
            className="rounded-full bg-background shadow-md"
            onClick={onScrollToBottom}
          >
            <ChevronDownIcon />
          </Button>
        </div>
      )}
    </div>
  );
}
