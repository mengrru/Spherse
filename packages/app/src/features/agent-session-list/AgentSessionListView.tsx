import type { AgentProfile, SessionInfo } from "../../lib/types";
import { AgentGroup } from "./AgentGroup";
import { EmptyAgents } from "./EmptyAgents";
import { useGroupedSessions } from "./hooks/useGroupedSessions";

export interface AgentSessionListViewProps {
  agents: AgentProfile[];
  sessions: SessionInfo[];
  collapsedAgentIds: Set<string>;
  activeSessionId: string | null;
  onToggleAgentCollapsed: (agentId: string) => void;
  onNewSession: (agent: AgentProfile) => void;
  onEditAgent: (agent: AgentProfile) => void;
  onDeleteAgent: (agent: AgentProfile) => void;
  onSelectSession: (session: SessionInfo) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (session: SessionInfo, title: string) => Promise<boolean>;
}

export function AgentSessionListView({
  agents,
  sessions,
  collapsedAgentIds,
  activeSessionId,
  onToggleAgentCollapsed,
  onNewSession,
  onEditAgent,
  onDeleteAgent,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
}: AgentSessionListViewProps) {
  const grouped = useGroupedSessions(sessions);

  if (agents.length === 0) {
    return <EmptyAgents />;
  }

  return (
    <div className="flex flex-col gap-px text-xs">
      {agents.map((agent) => (
        <AgentGroup
          key={agent.id}
          agent={agent}
          sessions={grouped.get(agent.id) ?? []}
          collapsed={collapsedAgentIds.has(agent.id)}
          activeSessionId={activeSessionId}
          onToggleCollapsed={onToggleAgentCollapsed}
          onNewSession={onNewSession}
          onEditAgent={onEditAgent}
          onDeleteAgent={onDeleteAgent}
          onSelectSession={onSelectSession}
           onDeleteSession={onDeleteSession}
           onRenameSession={onRenameSession}
         />
      ))}
    </div>
  );
}
