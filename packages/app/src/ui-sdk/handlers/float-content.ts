import { registerAction } from "../registry";
import { isFeatureEnabled } from "../../lib/feature-registry";
import { useFloatingContentBrowserStore } from "../../features/floating-content-browser/store";

registerAction("floatContent", (params, ctx) => {
  const { path } = params as { path?: string };
  if (!path || typeof path !== "string") return;

  if (!isFeatureEnabled("floating-content-browser", ctx.hostKind)) {
    ctx.navigate(`/project/${ctx.projectId}/content?path=${encodeURIComponent(path)}`);
    return;
  }

  useFloatingContentBrowserStore.getState().openFloat(ctx.projectId, path);
});
