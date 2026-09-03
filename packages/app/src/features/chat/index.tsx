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
import { ChatRuntimeProvider } from "./runtime-context";
import { ChatActionsProvider } from "./chat-actions-context";
import { useAgentTheme } from "./hooks/useAgentTheme";
import { useChatScroll } from "./hooks/useChatScroll";
import { useChatSession } from "./hooks/useChatSession";
import { useStreamingStore } from "./runtime/streaming-store";

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
    items,
    streaming,
    loading,
    connectionStatus,
    historyError,
    reconnectFailed,
    sendMessage,
    retry,
    withdrawLastTurn,
    abort,
    reconnect,
    retryHistory,
  } = useChatSession({
    client,
    sessionId,
    baseUrl,
    projectId,
    agentId: agent.id,
    initialMessage,
    accessToken,
  });
  const hasMore = useStreamingStore((s) => s.sessions[sessionId]?.history.hasMore ?? false);
  const loadingMore = useStreamingStore((s) => s.sessions[sessionId]?.loadingMore ?? false);
  const { containerRef, isAtBottom, scrollToBottom } = useChatScroll(items, sessionId, loadingMore);
  const themeHref = useAgentTheme(client, agent.id, agent.slug, projectId);

  const handleClose = () => {
    onClose?.();
  };

  const actions = useMemo(() => ({
    respondApproval: (requestId: string, approved: boolean) => {
      const delivered = useStreamingStore.getState().respondApproval(sessionId, requestId, approved);
      if (!delivered) toast.error(t("chat.approvalNotDelivered"));
    },
    respondQuestion: (requestId: string, answer: string): boolean => {
      const delivered = useStreamingStore.getState().respondQuestion(sessionId, requestId, answer);
      if (!delivered) toast.error(t("chat.questionNotDelivered"));
      return delivered;
    },
  }), [sessionId, t]);

  const runtime = useMemo(() => ({ sessionId, agentId: agent.id }), [sessionId, agent.id]);

  return (
    <ChatRuntimeProvider runtime={runtime}>
      <ChatActionsProvider actions={actions}>
        <div className="flex flex-col h-full" data-chat-root>
          {themeHref && <link rel="stylesheet" href={themeHref} />}
          {!hideHeader && <Header agent={agent} onClose={onClose ? handleClose : undefined} />}
          <ConnectionBanner
            connectionStatus={connectionStatus}
            reconnectFailed={reconnectFailed}
            historyError={historyError}
            onReconnect={reconnect}
            onRetryHistory={retryHistory}
          />
          <MessageList
            items={items}
            agent={agent}
            streaming={streaming}
            loading={loading}
            containerRef={containerRef}
            isAtBottom={isAtBottom}
            onScrollToBottom={() => scrollToBottom("smooth")}
            onNavigateToPath={onNavigateToPath}
            onRetry={retry}
            onWithdraw={withdrawLastTurn}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={() => useStreamingStore.getState().loadMore(client, sessionId, agent.id)}
          />
          <Composer
            streaming={streaming}
            loading={loading}
            sessionId={sessionId}
            onSend={sendMessage}
            onAbort={abort}
          />
        </div>
      </ChatActionsProvider>
    </ChatRuntimeProvider>
  );
}
