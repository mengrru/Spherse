import type { RefObject } from "react";
import { useMemo } from "react";
import { useI18n } from "@spherse/i18n/react";
import type { AgentSummary } from "../../lib/types";
import type { ChatMessage } from "./types";
import { Button } from "../../components/ui/button";
import { ChevronDownIcon } from "lucide-react";
import { MessageItem } from "./MessageItem";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { TriggerTurnGroup } from "./TriggerTurnGroup";
import { computeSupersededToolCallIds } from "./model/html-card-dedup";
import { groupTurns, type TurnGroupItem } from "./model/turn-groups";
import { lastWithdrawableUserIndex } from "./model/withdrawable";

interface MessageListProps {
  messages: ChatMessage[];
  agent: AgentSummary;
  streaming: boolean;
  loading?: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  onScrollToBottom: () => void;
  onNavigateToPath?: (path: string) => void;
  onRespondApproval?: (requestId: string, approved: boolean) => void;
  onRespondQuestion?: (requestId: string, answer: string) => boolean | void;
  onRetry?: () => void;
  onWithdraw?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

export function MessageList({ messages, agent, streaming, loading = false, containerRef, isAtBottom, onScrollToBottom, onNavigateToPath, onRespondApproval, onRespondQuestion, onRetry, onWithdraw, hasMore, loadingMore, onLoadMore }: MessageListProps) {
  const { t } = useI18n();

  // 相同 file_path 的 html card 只展开最近一张；较早的同路径卡片折叠（不挂载 iframe）。
  const supersededToolCallIds = useMemo(
    () => computeSupersededToolCallIds(messages),
    [messages],
  );

  const groups = useMemo(() => groupTurns(messages), [messages]);

  if (loading && messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4">
        <div className="text-muted-foreground text-sm font-medium">{agent.name}</div>
        <div className="text-muted-foreground text-sm">{t("chat.startConversation")}</div>
      </div>
    );
  }

  const lastMessage = messages[messages.length - 1];
  const withdrawableIndex = streaming ? -1 : lastWithdrawableUserIndex(messages);

  const renderItem = ({ message, index }: TurnGroupItem) => {
    const isLast = index === messages.length - 1;
    const showTime =
      message.role === "user" || isLast || messages[index + 1]?.role === "user";
    return (
      <MessageItem
        key={index}
        message={message}
        agent={agent}
        showTime={showTime}
        supersededToolCallIds={supersededToolCallIds}
        onNavigateToPath={onNavigateToPath}
        onRespondApproval={onRespondApproval}
        onRespondQuestion={onRespondQuestion}
        onRetry={isLast ? onRetry : undefined}
        onWithdraw={index === withdrawableIndex ? onWithdraw : undefined}
      />
    );
  };

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={containerRef} className="h-full overflow-y-auto p-4 flex flex-col-reverse gap-3" data-chat-messages>
        {streaming && lastMessage?.role === "user" && (
          <div className="self-start">
            <ThinkingIndicator />
          </div>
        )}
        {[...groups].reverse().map((group) =>
          group.kind === "trigger" ? (
            <TriggerTurnGroup
              key={`turn-${group.items[0].message._messageId ?? group.items[0].index}`}
              items={group.items}
              triggerName={group.triggerName}
              hasError={group.hasError}
              renderItem={renderItem}
            />
          ) : (
            renderItem(group.item)
          ),
        )}
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
