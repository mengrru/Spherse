import type { ActionContext, ActionHandler } from "./types";

const handlers = new Map<string, ActionHandler>();

export function registerAction(name: string, handler: ActionHandler): void {
  handlers.set(name, handler);
}

export function dispatchAction(
  name: string,
  params: Record<string, unknown>,
  ctx: ActionContext,
): void | Promise<void> {
  const handler = handlers.get(name);
  if (!handler) {
    console.warn(`[spherse:action] Unknown action: ${name}`);
    return;
  }
  return handler(params, ctx);
}
