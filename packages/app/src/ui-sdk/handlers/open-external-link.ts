import { registerAction } from "../registry";
import { isLoopbackUrl, openExternalUrl } from "../../features/browser/open-external-url";

registerAction("openExternalLink", (params, ctx) => {
  const { url } = params as { url?: string };
  if (typeof url !== "string") return;
  const trimmed = url.trim();
  if (!trimmed) return;
  if (isLoopbackUrl(trimmed)) {
    openExternalUrl(trimmed, {
      projectId: ctx.projectId,
      hostKind: ctx.hostKind,
      openExternal: ctx.openExternal,
    });
    return;
  }
  void ctx.openExternal?.(trimmed);
});
