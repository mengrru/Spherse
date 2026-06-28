import type { AgentProfile } from "../../lib/types";
import { useProjectCtx } from "../../context/project-context";
import { Composer } from "./Composer";
import { Header } from "./Header";
import { MessageList } from "./MessageList";
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
  const { client, baseUrl, projectId } = useProjectCtx();
  const { messages, streaming, sendMessage, abort } = useChatSession({
    client,
    sessionId,
    baseUrl,
    projectId,
    agentId: agent.id,
    initialMessage,
  });
  const hasMore = useStreamingStore((s) => s.sessions[sessionId]?.hasMore ?? false);
  const loadingMore = useStreamingStore((s) => s.sessions[sessionId]?.loadingMore ?? false);
  const { messagesEndRef, containerRef, isAtBottom, scrollToBottom } = useChatScroll(messages, sessionId, loadingMore);
  const themeHref = useAgentTheme(client, agent.id, agent.slug, projectId);

  const handleClose = () => {
    onClose?.();
  };

  return (
    <div className="flex flex-col h-full" data-chat-root>
      {themeHref && <link rel="stylesheet" href={themeHref} />}
      {!hideHeader && <Header agent={agent} onClose={onClose ? handleClose : undefined} />}
      <MessageList
        messages={messages}
        agent={agent}
        messagesEndRef={messagesEndRef}
        containerRef={containerRef}
        isAtBottom={isAtBottom}
        onScrollToBottom={scrollToBottom}
        onNavigateToPath={onNavigateToPath}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={() => useStreamingStore.getState().loadMore(client, sessionId, agent.id)}
      />
      <Composer
        streaming={streaming}
        sessionId={sessionId}
        onSend={sendMessage}
        onAbort={abort}
      />
    </div>
  );
}
