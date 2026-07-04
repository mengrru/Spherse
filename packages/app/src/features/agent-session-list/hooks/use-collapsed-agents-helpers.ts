export function computeInitialCollapsedAgentIds(
  agents: ReadonlyArray<{ id: string }>,
  activeAgentId: string | null,
): Set<string> {
  return new Set(agents.filter((agent) => agent.id !== activeAgentId).map((agent) => agent.id));
}

export function expandActiveAgent(
  currentCollapsed: ReadonlySet<string>,
  activeAgentId: string | null,
): Set<string> | null {
  if (!activeAgentId || !currentCollapsed.has(activeAgentId)) return null;
  const next = new Set(currentCollapsed);
  next.delete(activeAgentId);
  return next;
}
