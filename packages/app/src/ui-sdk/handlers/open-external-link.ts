import { registerAction } from "../registry";

registerAction("openExternalLink", (params, ctx) => {
  const { url } = params as { url?: string };
  if (typeof url !== "string") return;
  const trimmed = url.trim();
  if (!trimmed) return;
  void ctx.openExternal(trimmed);
});
