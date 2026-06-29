import type { AgentProfile, SessionInfo } from "../../lib/types";
import { AgentGroup } from "./AgentGroup";
import { EmptyAgents } from "./EmptyAgents";
import { useGroupedSessions } from "./hooks/useGroupedSessions";

interface SessionPaging {
  hasMore: boolean;
  offset: number;
  loadingMore?: boolean;
}

export interface AgentSessionListViewProps {
  agents: AgentProfile[];
  sessions: SessionInfo[];
  sessionPaging: Record<string, SessionPaging>;
  collapsedAgentIds: Set<string>;
  activeSessionId: string | null;
  floatingSessionId: string | null;
  onLoadMore: (agentId: string) => void;
}

export function AgentSessionListView({
  agents,
  sessions,
  sessionPaging,
  collapsedAgentIds,
  activeSessionId,
  floatingSessionId,
  onLoadMore,
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
          floatingSessionId={floatingSessionId}
          hasMore={sessionPaging[agent.id]?.hasMore ?? false}
          loadingMore={sessionPaging[agent.id]?.loadingMore ?? false}
          onLoadMore={() => onLoadMore(agent.id)}
        />
      ))}
    </div>
  );
}
