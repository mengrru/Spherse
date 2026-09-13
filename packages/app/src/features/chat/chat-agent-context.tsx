import { createContext, useContext, type ReactNode } from "react";

export interface ChatAgent {
  sessionId: string;
  agentId: string;
}

const ChatAgentContext = createContext<ChatAgent | null>(null);

export function ChatAgentProvider({
  agent,
  children,
}: {
  agent: ChatAgent;
  children: ReactNode;
}) {
  return (
    <ChatAgentContext.Provider value={agent}>
      {children}
    </ChatAgentContext.Provider>
  );
}

export function useChatAgent(): ChatAgent | null {
  return useContext(ChatAgentContext);
}
