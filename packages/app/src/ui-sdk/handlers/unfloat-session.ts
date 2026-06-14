import { registerAction } from "../registry";
import { useProjectUiStore } from "../../stores/project-ui-store";

registerAction("unfloatSession", (_params, ctx) => {
  const ui = useProjectUiStore.getState().projects[ctx.projectId];
  if (!ui?.floatingChat) return;
  useProjectUiStore.getState().setFloatingChat(ctx.projectId, null);
});
