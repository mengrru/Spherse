import { registerAction } from "../registry";
import { isFeatureEnabled } from "../../lib/feature-registry";
import { useFloatingContentBrowserStore } from "../../features/floating-content-browser/store";

registerAction("openFile", (params, ctx) => {
  const { path, float } = params as { path: string; float?: boolean };
  if (!path || typeof path !== "string") return;

  if (float && isFeatureEnabled("floating-content-browser", ctx.hostKind)) {
    useFloatingContentBrowserStore.getState().openFloat(ctx.projectId, path);
    return;
  }

  ctx.navigate(
    `/project/${ctx.projectId}/content?path=${encodeURIComponent(path)}`,
  );
});
