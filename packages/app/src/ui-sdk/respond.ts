import type { ActionContext } from "./types";

export function respond(
  ctx: ActionContext,
  ok: boolean,
  data?: unknown,
): void {
  if (!ctx.requestId || !ctx.source) return;
  (ctx.source as WindowProxy).postMessage(
    { type: "spherse:response", requestId: ctx.requestId, ok, data },
    "*",
  );
}
