import { registerAction } from "../registry";
import { useFloatingChatStore } from "../../features/floating-chat/store";
import { getDefaultFloatingState } from "../../features/floating-chat";

registerAction("floatSession", (params, _ctx) => {
  const { sessionId } = params as { sessionId: string };
  if (!sessionId || typeof sessionId !== "string") return;
  useFloatingChatStore.getState().setFloatingChat(_ctx.projectId, getDefaultFloatingState(sessionId));
});
