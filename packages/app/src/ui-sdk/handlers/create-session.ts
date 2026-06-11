import { registerAction } from "../registry";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useProjectUiStore } from "../../stores/project-ui-store";
import { getDefaultFloatingState } from "../../features/floating-chat";

registerAction("createSession", async (params, ctx) => {
  const { agentId, message, float } = params as {
    agentId: string;
    message?: string;
    float?: boolean;
  };
  if (!agentId || typeof agentId !== "string") return;
  if (!ctx.client) return;

  const session = await useProjectDataStore
    .getState()
    .createSession(ctx.projectKey, ctx.client, agentId, message);
  if (!session) return;

  if (float) {
    useProjectUiStore.getState().setFloatingChat(ctx.projectKey, getDefaultFloatingState(session.id));
  } else {
    ctx.navigate(`/project/${ctx.projectKey}/chat/${session.id}`);
  }
});
