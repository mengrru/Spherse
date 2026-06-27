import { useEffect, useMemo } from "react";
import type { AgentProfile } from "../../../lib/types";
import { useAgentSessionListUiStore } from "../store";

const EMPTY_COLLAPSED_AGENT_IDS = new Set<string>();

export function useCollapsedAgents(projectId: string, agents: AgentProfile[]) {
  const toggleAgentCollapsed = useAgentSessionListUiStore((state) => state.toggleAgentCollapsed);
  const setCollapsedAgentIds = useAgentSessionListUiStore((state) => state.setCollapsedAgentIds);
  const collapsedAgentIds = useAgentSessionListUiStore((s) => s.collapsedAgentIdsByProject[projectId]);
  const collapsedInitialized = collapsedAgentIds !== undefined;

  const effectiveCollapsedAgentIds = useMemo(() => {
    if (collapsedInitialized || agents.length === 0) return collapsedAgentIds ?? EMPTY_COLLAPSED_AGENT_IDS;
    return new Set(agents.map((agent) => agent.id));
  }, [collapsedInitialized, collapsedAgentIds, agents]);

  useEffect(() => {
    if (collapsedInitialized || agents.length === 0) return;
    setCollapsedAgentIds(projectId, agents.map((agent) => agent.id));
  }, [collapsedInitialized, agents, projectId, setCollapsedAgentIds]);

  useEffect(() => {
    if (!collapsedInitialized) return;
    const validAgentIds = new Set(agents.map((agent) => agent.id));
    const nextCollapsedAgentIds = [...collapsedAgentIds!].filter((id) => validAgentIds.has(id));
    const changed =
      nextCollapsedAgentIds.length !== collapsedAgentIds!.size ||
      nextCollapsedAgentIds.some((id) => !collapsedAgentIds!.has(id));
    if (changed) {
      setCollapsedAgentIds(projectId, nextCollapsedAgentIds);
    }
  }, [collapsedInitialized, agents, collapsedAgentIds, projectId, setCollapsedAgentIds]);

  return {
    effectiveCollapsedAgentIds,
    toggleAgentCollapsed: (agentId: string) => toggleAgentCollapsed(projectId, agentId),
  };
}
