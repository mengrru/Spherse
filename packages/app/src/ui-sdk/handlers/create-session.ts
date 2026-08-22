import { registerAction } from "../registry";
import { respond } from "../respond";
import { openChat } from "./open-chat";
import type { ApiClient } from "../../lib/api";
import { createProjectSession, ensureProjectAgents } from "../../queries/project";

async function resolveAgentId(
  projectId: string,
  client: ApiClient,
  agentId: unknown,
  agentSlug: unknown,
): Promise<string | null> {
  if (typeof agentId === "string" && agentId) return agentId;
  if (typeof agentSlug !== "string" || !agentSlug) return null;

  try {
    const agents = await ensureProjectAgents(projectId, client);
    return agents.find((a) => a.slug === agentSlug)?.id ?? null;
  } catch {
    return null;
  }
}

registerAction("createSession", async (params, ctx) => {
  const { agentId, agentSlug, message, open, float, name } = params as {
    agentId?: string;
    agentSlug?: string;
    message?: string;
    open?: boolean;
    float?: boolean;
    name?: unknown;
  };
  const title = typeof name === "string" && name.trim() ? name.trim() : undefined;
  if (!ctx.client) {
    respond(ctx, false, { error: "create_failed" });
    return;
  }

  const resolvedAgentId = await resolveAgentId(ctx.projectId, ctx.client, agentId, agentSlug);
  if (!resolvedAgentId) {
    respond(ctx, false, { error: "agent_not_found" });
    return;
  }

  const session = await createProjectSession(
    ctx.projectId,
    ctx.client,
    resolvedAgentId,
    message,
    title,
  ).catch(() => null);
  if (!session) {
    respond(ctx, false, { error: "create_failed" });
    return;
  }

  respond(ctx, true, { sessionId: session.id });

  if (open === false) return;
  openChat(ctx, session.id, float);
});
