import { registerAction } from "../registry";
import { useProjectUiStore } from "../../stores/project-ui-store";
import { getDefaultFloatingState } from "../../features/floating-chat";

registerAction("floatSession", (params, _ctx) => {
  const { sessionId } = params as { sessionId: string };
  if (!sessionId || typeof sessionId !== "string") return;
  useProjectUiStore.getState().setFloatingChat(_ctx.projectKey, getDefaultFloatingState(sessionId));
});
