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
  port: number;
  agent: AgentProfile;
  onNavigateToPath?: (path: string) => void;
  initialMessage?: string;
  onClose?: () => void;
}

export function Chat({ client, sessionId, port, agent, onNavigateToPath, initialMessage, onClose }: ChatProps) {
  const { messages, streaming, sendMessage, abort } = useChatSession({
    client,
    sessionId,
    port,
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
      <Header agent={agent} onClose={onClose ? handleClose : undefined} />
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
