import { Fragment, type RefObject } from "react";
import { useI18n } from "@spherse/i18n/react";
import type { AgentSummary } from "../../lib/types";
import { Button } from "../../components/ui/button";
import { ChevronDownIcon } from "lucide-react";
import type { Bubble, MessageGroup } from "./model/message-group";
import type { UserEntry } from "./model/entry";
import { AssistantBubble } from "./AssistantBubble";
import { UserBubble } from "./UserBubble";
import { TriggerTurnGroup } from "./TriggerTurnGroup";
import { ThinkingIndicator } from "./ThinkingIndicator";

interface MessageListProps {
  groups: MessageGroup[];
  agent: AgentSummary;
  thinking: boolean;
  runningGroupId?: string | null;
  withdrawableUserId: string | null;
  supersededToolCallIds: Set<string>;
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

export function MessageList({
  groups,
  agent,
  thinking,
  runningGroupId,
  withdrawableUserId,
  supersededToolCallIds,
  loading = false,
  containerRef,
  isAtBottom,
  onScrollToBottom,
  onNavigateToPath,
  onRespondApproval,
  onRespondQuestion,
  onRetry,
  onWithdraw,
  hasMore,
  loadingMore,
  onLoadMore,
}: MessageListProps) {
  const { t } = useI18n();

  if (loading && groups.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4">
        <div className="text-muted-foreground text-sm font-medium">{agent.name}</div>
        <div className="text-muted-foreground text-sm">{t("chat.startConversation")}</div>
      </div>
    );
  }

  const lastGroup = groups[groups.length - 1];
  const lastBubble = lastGroup?.bubbles[lastGroup.bubbles.length - 1];
  const retryTargetUserId = !lastBubble && lastGroup?.user ? lastGroup.user.id : undefined;

  const renderUser = (group: MessageGroup, user: UserEntry) => (
    <UserBubble
      key={`u:${user.id}`}
      text={user.text}
      attachments={user.attachments}
      sendFailed={user.sendFailed}
      timestamp={user.time}
      showTime
      onWithdraw={user.id === withdrawableUserId ? onWithdraw : undefined}
      onRetry={user.id === retryTargetUserId ? onRetry : undefined}
    />
  );

  const renderBubble = (group: MessageGroup, bubble: Bubble, index: number) => {
    const showTime = index === group.bubbles.length - 1;
    const isRetryTarget = bubble.id === lastBubble?.id;
    if (bubble.kind === "tool-result") {
      return (
        <AssistantBubble
          key={bubble.id}
          agent={agent}
          text=""
          tools={[bubble.tool]}
          showTime={showTime}
          onNavigateToPath={onNavigateToPath}
          onRespondApproval={onRespondApproval}
          onRespondQuestion={onRespondQuestion}
        />
      );
    }
    if (bubble.kind === "error") {
      return (
        <AssistantBubble
          key={bubble.id}
          agent={agent}
          text=""
          tools={[]}
          error={bubble.error}
          timestamp={bubble.timestamp}
          showTime={showTime}
          onRetry={isRetryTarget ? onRetry : undefined}
        />
      );
    }
    return (
      <AssistantBubble
        key={bubble.id}
        agent={agent}
        text={bubble.text}
        tools={bubble.tools}
        streaming={bubble.streaming}
        error={bubble.error}
        timestamp={bubble.timestamp}
        runChanges={bubble.runChanges}
        showTime={showTime}
        supersededToolCallIds={supersededToolCallIds}
        onNavigateToPath={onNavigateToPath}
        onRespondApproval={onRespondApproval}
        onRespondQuestion={onRespondQuestion}
        onRetry={isRetryTarget ? onRetry : undefined}
      />
    );
  };

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={containerRef} className="h-full overflow-y-auto p-4 flex flex-col-reverse gap-3" data-chat-messages>
        {thinking && (
          <div className="self-start">
            <ThinkingIndicator />
          </div>
        )}
        {[...groups].reverse().map((group) =>
          group.kind === "trigger-turn" ? (
            <TriggerTurnGroup
              key={group.id}
              group={group}
              running={group.id === runningGroupId}
              renderUser={(user) => renderUser(group, user)}
              renderBubble={(bubble, index) => renderBubble(group, bubble, index)}
            />
          ) : (
            <Fragment key={group.id}>
              {[...group.bubbles].reverse().map((bubble, reversedIndex) =>
                renderBubble(group, bubble, group.bubbles.length - 1 - reversedIndex),
              )}
              {group.user && renderUser(group, group.user)}
            </Fragment>
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
