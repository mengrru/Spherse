import { registerAction } from "../registry";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useFloatingChatStore } from "../../features/floating-chat/store";
import { getDefaultFloatingState } from "../../features/floating-chat";
import type { ApiClient } from "../../lib/api";

async function resolveAgentId(
  projectId: string,
  client: ApiClient,
  agentId: unknown,
  agentSlug: unknown,
): Promise<string | null> {
  if (typeof agentId === "string" && agentId) return agentId;
  if (typeof agentSlug !== "string" || !agentSlug) return null;

  const cached = useProjectDataStore.getState().projects[projectId]?.agents ?? [];
  const fromCache = cached.find((a) => a.slug === agentSlug);
  if (fromCache) return fromCache.id;

  try {
    const agents = await client.listAgents();
    return agents.find((a) => a.slug === agentSlug)?.id ?? null;
  } catch {
    return null;
  }
}

registerAction("createSession", async (params, ctx) => {
  const { agentId, agentSlug, message, float } = params as {
    agentId?: string;
    agentSlug?: string;
    message?: string;
    float?: boolean;
  };
  if (!ctx.client) return;

  const resolvedAgentId = await resolveAgentId(ctx.projectId, ctx.client, agentId, agentSlug);
  if (!resolvedAgentId) return;

  const session = await useProjectDataStore
    .getState()
    .createSession(ctx.projectId, ctx.client, resolvedAgentId, message);
  if (!session) return;

  if (float) {
    useFloatingChatStore.getState().setFloatingChat(ctx.projectId, getDefaultFloatingState(session.id));
  } else {
    ctx.navigate(`/project/${ctx.projectId}/chat/${session.id}`);
  }
});
