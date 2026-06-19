import { registerAction } from "../registry";
import { useFloatingChatStore } from "../../features/floating-chat/store";

registerAction("unfloatSession", (_params, ctx) => {
  const floatingChat = useFloatingChatStore.getState().byProject[ctx.projectId];
  if (!floatingChat) return;
  useFloatingChatStore.getState().setFloatingChat(ctx.projectId, null);
});
