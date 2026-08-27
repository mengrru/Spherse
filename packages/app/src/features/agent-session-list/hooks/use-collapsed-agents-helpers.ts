export function computeInitialCollapsedAgentIds(
  agents: ReadonlyArray<{ id: string }>,
  activeAgentId: string | null,
): Set<string> {
  return new Set(agents.filter((agent) => agent.id !== activeAgentId).map((agent) => agent.id));
}

export function pruneCollapsedAgentIds(
  currentCollapsed: ReadonlySet<string>,
  agents: ReadonlyArray<{ id: string }>,
): Set<string> | null {
  if (agents.length === 0) return null;
  const validAgentIds = new Set(agents.map((agent) => agent.id));
  const next = new Set([...currentCollapsed].filter((id) => validAgentIds.has(id)));
  return next.size === currentCollapsed.size ? null : next;
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
