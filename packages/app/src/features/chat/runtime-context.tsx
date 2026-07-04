import { createContext, useContext, type ReactNode } from "react";

export interface ChatRuntime {
  sessionId: string;
  agentId: string;
}

const ChatRuntimeContext = createContext<ChatRuntime | null>(null);

export function ChatRuntimeProvider({
  runtime,
  children,
}: {
  runtime: ChatRuntime;
  children: ReactNode;
}) {
  return (
    <ChatRuntimeContext.Provider value={runtime}>
      {children}
    </ChatRuntimeContext.Provider>
  );
}

export function useChatRuntime(): ChatRuntime | null {
  return useContext(ChatRuntimeContext);
}
