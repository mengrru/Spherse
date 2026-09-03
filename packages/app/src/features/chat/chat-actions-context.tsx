import { createContext, useContext, type ReactNode } from "react";

export interface ChatActions {
  respondApproval: (requestId: string, approved: boolean) => void;
  respondQuestion: (requestId: string, answer: string) => boolean;
}

const ChatActionsContext = createContext<ChatActions | null>(null);

export function ChatActionsProvider({
  actions,
  children,
}: {
  actions: ChatActions;
  children: ReactNode;
}) {
  return (
    <ChatActionsContext.Provider value={actions}>
      {children}
    </ChatActionsContext.Provider>
  );
}

export function useChatActions(): ChatActions {
  const actions = useContext(ChatActionsContext);
  if (!actions) {
    throw new Error("useChatActions must be used within ChatActionsProvider");
  }
  return actions;
}
