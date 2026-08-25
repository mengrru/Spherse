import { useEffect, useMemo, useRef } from "react";
import type { AgentSummary } from "../../../lib/types";
import { useAgentSessionListUiStore } from "../store";
import { computeInitialCollapsedAgentIds, expandActiveAgent } from "./use-collapsed-agents-helpers";

const EMPTY_COLLAPSED_AGENT_IDS = new Set<string>();

export function useCollapsedAgents(projectId: string, agents: AgentSummary[], activeAgentId: string | null) {
  const toggleAgentCollapsed = useAgentSessionListUiStore((state) => state.toggleAgentCollapsed);
  const setCollapsedAgentIds = useAgentSessionListUiStore((state) => state.setCollapsedAgentIds);
  const collapsedAgentIds = useAgentSessionListUiStore((s) => s.collapsedAgentIdsByProject[projectId]);
  const collapsedInitialized = collapsedAgentIds !== undefined;

  const effectiveCollapsedAgentIds = useMemo(() => {
    if (collapsedInitialized || agents.length === 0) return collapsedAgentIds ?? EMPTY_COLLAPSED_AGENT_IDS;
    return computeInitialCollapsedAgentIds(agents, activeAgentId);
  }, [collapsedInitialized, collapsedAgentIds, agents, activeAgentId]);

  useEffect(() => {
    if (collapsedInitialized || agents.length === 0) return;
    setCollapsedAgentIds(projectId, computeInitialCollapsedAgentIds(agents, activeAgentId));
  }, [collapsedInitialized, agents, projectId, activeAgentId, setCollapsedAgentIds]);

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

  // 当 active session 切换时，自动展开其所属 agent（若处于折叠态），让 active session 在侧栏可见。
  // 这是"边沿触发"的副作用：仅依赖 ref 判断 activeAgentId 是否真正变化，而非持续约束折叠态。
  // 因此用户随后手动折叠当前 active agent 时，effect 不会因重渲染反复撑开——尊重用户的折叠操作。
  const prevProjectIdRef = useRef(projectId);
  const prevActiveAgentIdRef = useRef<string | null>(activeAgentId);
  useEffect(() => {
    // 项目切换：仅同步 ref，不做展开动作，避免跨项目误触发
    if (prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId;
      prevActiveAgentIdRef.current = activeAgentId;
      return;
    }
    // activeAgentId 未变（仅组件重渲染）→ 跳过，保证边沿触发语义
    if (prevActiveAgentIdRef.current === activeAgentId) return;
    prevActiveAgentIdRef.current = activeAgentId;
    // 退回项目首页（无 active session）→ 不改动折叠态
    if (!activeAgentId) return;
    const current = useAgentSessionListUiStore.getState().collapsedAgentIdsByProject[projectId];
    const next = expandActiveAgent(current ?? EMPTY_COLLAPSED_AGENT_IDS, activeAgentId);
    if (!next) return;
    setCollapsedAgentIds(projectId, next);
  }, [activeAgentId, projectId, setCollapsedAgentIds]);

  return {
    effectiveCollapsedAgentIds,
    toggleAgentCollapsed: (agentId: string) => toggleAgentCollapsed(projectId, agentId),
  };
}
