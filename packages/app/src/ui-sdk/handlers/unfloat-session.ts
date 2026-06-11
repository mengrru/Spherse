import { registerAction } from "../registry";
import { useProjectUiStore } from "../../stores/project-ui-store";

registerAction("unfloatSession", (_params, ctx) => {
  const ui = useProjectUiStore.getState().projects[ctx.projectKey];
  if (!ui?.floatingChat) return;
  useProjectUiStore.getState().setFloatingChat(ctx.projectKey, null);
});
