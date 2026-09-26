import { useEffect, useMemo, useState } from "react";
import type { AgentSummary } from "../../lib/types";
import { useNavigate } from "react-router";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient, useConnection } from "../../lib/use-connection";
import { useFeature } from "../../lib/use-feature";
import { useIsMobile } from "../../hooks/use-mobile";
import { useProjectAgentProfile } from "../../queries/project";
import { useFloatingContentBrowserStore } from "../floating-content-browser/store";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import { Composer } from "./Composer";
import { Header } from "./Header";
import { MessageList } from "./MessageList";
import { ConnectionBanner } from "./ConnectionBanner";
import { QuickLinkPanel, resolveQuickLinkAction } from "./QuickLinkPanel";
import { ChatAgentProvider } from "./chat-agent-context";
import { useAgentTheme } from "./hooks/useAgentTheme";
import { useChatScroll } from "./hooks/useChatScroll";
import { useChatSession } from "./hooks/useChatSession";
import { useLocateMessage } from "./hooks/useLocateMessage";

export interface ChatProps {
  sessionId: string;
  agent: AgentSummary;
  onNavigateToPath?: (path: string) => void;
  initialMessage?: string;
  onClose?: () => void;
  hideHeader?: boolean;
  locateSeq?: number | null;
  onLocated?: () => void;
}

export function Chat({ sessionId, agent, onNavigateToPath, initialMessage, onClose, hideHeader, locateSeq = null, onLocated }: ChatProps) {
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const { baseUrl, accessToken } = useConnection();
  const { t } = useI18n();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const floatEnabled = useFeature("floating-content-browser");
  const openFloat = useFloatingContentBrowserStore((s) => s.openFloat);
  const profileQuery = useProjectAgentProfile(projectId, client, agent.id, !hideHeader);
  const quickLinks = useMemo(() => profileQuery.data?.quickLinks ?? [], [profileQuery.data?.quickLinks]);
  const [activeQuickLink, setActiveQuickLink] = useState<string | null>(null);
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
  useLocateMessage({
    containerRef,
    client,
    sessionId,
    agentId: agent.id,
    locateSeq,
    onLocated: onLocated ?? (() => {}),
  });
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

  useEffect(() => {
    if (activeQuickLink !== null && !quickLinks.includes(activeQuickLink)) {
      setActiveQuickLink(null);
    }
  }, [quickLinks, activeQuickLink]);

  const handleQuickLink = (path: string) => {
    const action = resolveQuickLinkAction(isMobile, floatEnabled);
    if (action === "panel") {
      setActiveQuickLink((current) => (current === path ? null : path));
      return;
    }
    if (action === "float") {
      openFloat(projectId, path);
      return;
    }
    navigate(`/project/${projectId}/content?path=${encodeURIComponent(path)}`);
  };

  return (
    <ChatAgentProvider agent={agentScope}>
      <div className="flex flex-col h-full" data-chat-root>
        {themeHref && <link rel="stylesheet" href={themeHref} />}
        {!hideHeader && (
          <div className="relative shrink-0">
            <Header
              agent={agent}
              quickLinks={quickLinks.length > 0 ? quickLinks : undefined}
              activeQuickLink={isMobile ? activeQuickLink : null}
              onQuickLink={handleQuickLink}
              onClose={onClose ? handleClose : undefined}
            />
            {isMobile && activeQuickLink !== null && (
              <QuickLinkPanel projectId={projectId} path={activeQuickLink} />
            )}
          </div>
        )}
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
          locateSeq={locateSeq}
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
