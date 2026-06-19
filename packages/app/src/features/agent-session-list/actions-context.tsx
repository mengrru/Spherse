import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { AgentProfile, SessionInfo } from "../../lib/types";

export interface AgentSessionActions {
  toggleAgentCollapsed: (agentId: string) => void;
  newSession: (agent: AgentProfile) => void;
  scheduleAgent: (agent: AgentProfile) => void;
  editAgent: (agent: AgentProfile) => void;
  deleteAgent: (agent: AgentProfile) => void;
  selectSession: (session: SessionInfo) => void;
  deleteSession: (session: SessionInfo) => void;
  renameSession: (session: SessionInfo, title: string) => Promise<boolean>;
  floatSession: (session: SessionInfo) => void;
  cancelFloat: () => void;
}

const ActionsContext = createContext<AgentSessionActions | null>(null);

export function AgentSessionActionsProvider({
  actions,
  children,
}: {
  actions: AgentSessionActions;
  children: ReactNode;
}) {
  return <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>;
}

export function useAgentSessionActions(): AgentSessionActions {
  const actions = useContext(ActionsContext);
  if (!actions) {
    throw new Error("useAgentSessionActions must be used within AgentSessionActionsProvider");
  }
  return actions;
}
