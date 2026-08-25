import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { AgentSummary, SessionInfo } from "../../lib/types";

export interface AgentSessionActions {
  toggleAgentCollapsed: (agentId: string) => void;
  newSession: (agent: AgentSummary) => void;
  triggerAgent: (agent: AgentSummary) => void;
  mcpAgent: (agent: AgentSummary) => void;
  editAgent: (agent: AgentSummary) => void;
  deleteAgent: (agent: AgentSummary) => void;
  selectSession: (session: SessionInfo) => void;
  deleteSession: (session: SessionInfo) => void;
  renameSession: (session: SessionInfo, title: string) => Promise<boolean>;
  floatSession: (session: SessionInfo) => void;
  cancelFloat: () => void;
  exportSession: (session: SessionInfo) => void;
  showSessionStatus: (session: SessionInfo) => void;
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
