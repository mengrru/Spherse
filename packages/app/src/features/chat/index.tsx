import type { ApiClient } from "../../lib/api";
import type { AgentProfile } from "../../lib/types";
import { Composer } from "./Composer";
import { Header } from "./Header";
import { MessageList } from "./MessageList";
import { useChatScroll } from "./hooks/useChatScroll";
import { useChatSession } from "./hooks/useChatSession";

export interface ChatProps {
  client: ApiClient;
  sessionId: string;
  agent: AgentProfile;
  onNavigateToPath?: (path: string) => void;
  initialMessage?: string;
}

export function Chat({ client, sessionId, agent, onNavigateToPath, initialMessage }: ChatProps) {
  const { messages, streaming, sendMessage, abort } = useChatSession({
    client,
    sessionId,
    initialMessage,
  });
  const messagesEndRef = useChatScroll(messages);

  return (
    <div className="flex flex-col h-full">
      <Header agent={agent} />
      <MessageList
        messages={messages}
        agent={agent}
        messagesEndRef={messagesEndRef}
        onNavigateToPath={onNavigateToPath}
      />
      <Composer
        streaming={streaming}
        onSend={sendMessage}
        onAbort={abort}
      />
    </div>
  );
}
