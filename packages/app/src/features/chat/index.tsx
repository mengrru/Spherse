import type { ApiClient } from "../../lib/api";
import type { AgentProfile } from "../../lib/types";
import { Composer } from "./Composer";
import { Header } from "./Header";
import { MessageList } from "./MessageList";
import { useAgentTheme } from "./hooks/useAgentTheme";
import { useChatScroll } from "./hooks/useChatScroll";
import { useChatSession } from "./hooks/useChatSession";

export interface ChatProps {
  client: ApiClient;
  sessionId: string;
  baseUrl: string;
  projectId: string;
  agent: AgentProfile;
  onNavigateToPath?: (path: string) => void;
  initialMessage?: string;
  onClose?: () => void;
  hideHeader?: boolean;
}

export function Chat({ client, sessionId, baseUrl, projectId, agent, onNavigateToPath, initialMessage, onClose, hideHeader }: ChatProps) {
  const { messages, streaming, sendMessage, abort } = useChatSession({
    client,
    sessionId,
    baseUrl,
    projectId,
    agentId: agent.id,
    initialMessage,
  });
  const { messagesEndRef, containerRef, isAtBottom, scrollToBottom } = useChatScroll(messages, sessionId);
  const scopedThemeCss = useAgentTheme(client, agent.id);

  const handleClose = () => {
    onClose?.();
  };

  return (
    <div className="flex flex-col h-full" data-chat-root>
      {scopedThemeCss && <style>{scopedThemeCss}</style>}
      {!hideHeader && <Header agent={agent} onClose={onClose ? handleClose : undefined} />}
      <MessageList
        messages={messages}
        agent={agent}
        messagesEndRef={messagesEndRef}
        containerRef={containerRef}
        isAtBottom={isAtBottom}
        onScrollToBottom={scrollToBottom}
        onNavigateToPath={onNavigateToPath}
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
