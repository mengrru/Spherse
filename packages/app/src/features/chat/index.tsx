import { useMemo } from "react";
import type { AgentProfile } from "../../lib/types";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient, useConnection } from "../../lib/use-connection";
import { Composer } from "./Composer";
import { Header } from "./Header";
import { MessageList } from "./MessageList";
import { ChatRuntimeProvider } from "./runtime-context";
import { useAgentTheme } from "./hooks/useAgentTheme";
import { useChatScroll } from "./hooks/useChatScroll";
import { useChatSession } from "./hooks/useChatSession";
import { useStreamingStore } from "./streaming-store";

export interface ChatProps {
  sessionId: string;
  agent: AgentProfile;
  onNavigateToPath?: (path: string) => void;
  initialMessage?: string;
  onClose?: () => void;
  hideHeader?: boolean;
}

export function Chat({ sessionId, agent, onNavigateToPath, initialMessage, onClose, hideHeader }: ChatProps) {
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const { baseUrl, accessToken } = useConnection();
  const { messages, streaming, loading, sendMessage, abort } = useChatSession({
    client,
    sessionId,
    baseUrl,
    projectId,
    agentId: agent.id,
    initialMessage,
    accessToken,
  });
  const hasMore = useStreamingStore((s) => s.sessions[sessionId]?.hasMore ?? false);
  const loadingMore = useStreamingStore((s) => s.sessions[sessionId]?.loadingMore ?? false);
  const { containerRef, isAtBottom, scrollToBottom } = useChatScroll(messages, sessionId, loadingMore);
  const themeHref = useAgentTheme(client, agent.id, agent.slug, projectId);

  const handleClose = () => {
    onClose?.();
  };

  const runtime = useMemo(() => ({ sessionId, agentId: agent.id }), [sessionId, agent.id]);

  return (
    <ChatRuntimeProvider runtime={runtime}>
      <div className="flex flex-col h-full" data-chat-root>
        {themeHref && <link rel="stylesheet" href={themeHref} />}
        {!hideHeader && <Header agent={agent} onClose={onClose ? handleClose : undefined} />}
        <MessageList
          messages={messages}
          agent={agent}
          streaming={streaming}
          loading={loading}
          containerRef={containerRef}
          isAtBottom={isAtBottom}
          onScrollToBottom={() => scrollToBottom("smooth")}
          onNavigateToPath={onNavigateToPath}
          onRespondApproval={(requestId, approved) => useStreamingStore.getState().respondApproval(sessionId, requestId, approved)}
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
    </ChatRuntimeProvider>
  );
}
