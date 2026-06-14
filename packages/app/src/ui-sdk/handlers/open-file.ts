import { registerAction } from "../registry";

registerAction("openFile", (params, ctx) => {
  const { path } = params as { path: string };
  if (!path || typeof path !== "string") return;

  ctx.navigate(
    `/project/${ctx.projectId}/content?path=${encodeURIComponent(path)}`,
  );
});
