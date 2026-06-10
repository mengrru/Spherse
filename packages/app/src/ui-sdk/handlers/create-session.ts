import { registerAction } from "../registry";
import { useProjectDataStore } from "../../stores/project-data-store";

registerAction("createSession", async (params, ctx) => {
  const { agentId, message } = params as {
    agentId: string;
    message?: string;
  };
  if (!agentId || typeof agentId !== "string") return;
  if (!ctx.client) return;

  const session = await useProjectDataStore
    .getState()
    .createSession(ctx.projectKey, ctx.client, agentId, message);
  if (session) {
    ctx.navigate(`/project/${ctx.projectKey}/chat/${session.id}`);
  }
});
