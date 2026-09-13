import { useMemo } from "react";
import type { AgentSummary } from "../../lib/types";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient, useConnection } from "../../lib/use-connection";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import { Composer } from "./Composer";
import { Header } from "./Header";
import { MessageList } from "./MessageList";
import { ConnectionBanner } from "./ConnectionBanner";
import { ChatAgentProvider } from "./chat-agent-context";
import { useAgentTheme } from "./hooks/useAgentTheme";
import { useChatScroll } from "./hooks/useChatScroll";
import { useChatSession } from "./hooks/useChatSession";

export interface ChatProps {
  sessionId: string;
  agent: AgentSummary;
  onNavigateToPath?: (path: string) => void;
  initialMessage?: string;
  onClose?: () => void;
  hideHeader?: boolean;
}

export function Chat({ sessionId, agent, onNavigateToPath, initialMessage, onClose, hideHeader }: ChatProps) {
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const { baseUrl, accessToken } = useConnection();
  const { t } = useI18n();
  const {
    entries,
    groups,
    supersededToolCallIds,
    thinking,
    runningGroupId,
    withdrawableUserId,
    streaming,
    loading,
    connection,
    historyError,
    hasMore,
    loadingMore,
    sendMessage,
    retry,
    withdrawLastTurn,
    abort,
    reconnect,
    retryHistory,
    respondApproval,
    respondQuestion,
    loadMore,
  } = useChatSession({
    client,
    sessionId,
    baseUrl,
    projectId,
    agentId: agent.id,
    initialMessage,
    accessToken,
  });
  const { containerRef, isAtBottom, scrollToBottom } = useChatScroll(entries, sessionId, loadingMore);
  const themeHref = useAgentTheme(client, agent.id, agent.slug, projectId);

  const handleClose = () => {
    onClose?.();
  };

  const handleRespondApproval = (requestId: string, approved: boolean) => {
    const delivered = respondApproval(requestId, approved);
    if (!delivered) toast.error(t("chat.approvalNotDelivered"));
  };

  const handleRespondQuestion = (requestId: string, answer: string): boolean => {
    const delivered = respondQuestion(requestId, answer);
    if (!delivered) toast.error(t("chat.questionNotDelivered"));
    return delivered;
  };

  const agentScope = useMemo(() => ({ sessionId, agentId: agent.id }), [sessionId, agent.id]);

  return (
    <ChatAgentProvider agent={agentScope}>
      <div className="flex flex-col h-full" data-chat-root>
        {themeHref && <link rel="stylesheet" href={themeHref} />}
        {!hideHeader && <Header agent={agent} onClose={onClose ? handleClose : undefined} />}
        <ConnectionBanner
          state={connection.state}
          historyError={historyError}
          onReconnect={reconnect}
          onRetryHistory={retryHistory}
        />
        <MessageList
          groups={groups}
          agent={agent}
          thinking={thinking}
          runningGroupId={runningGroupId}
          withdrawableUserId={withdrawableUserId}
          supersededToolCallIds={supersededToolCallIds}
          loading={loading}
          containerRef={containerRef}
          isAtBottom={isAtBottom}
          onScrollToBottom={() => scrollToBottom("smooth")}
          onNavigateToPath={onNavigateToPath}
          onRespondApproval={handleRespondApproval}
          onRespondQuestion={handleRespondQuestion}
          onRetry={retry}
          onWithdraw={withdrawLastTurn}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
        />
        <Composer
          streaming={streaming}
          loading={loading}
          sessionId={sessionId}
          onSend={sendMessage}
          onAbort={abort}
        />
      </div>
    </ChatAgentProvider>
  );
}
