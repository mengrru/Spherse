import { registerAction } from "../registry";
import { useFloatingContentBrowserStore } from "../../features/floating-content-browser/store";

registerAction("unfloatContent", (params, ctx) => {
  const { path } = params as { path?: string };
  if (!path || typeof path !== "string") return;
  useFloatingContentBrowserStore.getState().closeFloat(ctx.projectId, path);
});
