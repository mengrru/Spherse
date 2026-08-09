import type { ApiClient } from "../../lib/api";
import { registerAction } from "../registry";
import { respond } from "../respond";

/**
 * Read-only server HTTP bridge. The SDK exposes `spherse.api.*` (named helpers)
 * and `spherse.api.call(op, args)`; all paths funnel into this handler, which
 * dispatches only against an explicit allowlist of safe read operations on the
 * already-authenticated {@link ApiClient}. Write/admin endpoints are deliberately
 * absent — agents that need mutation should use the dedicated actions
 * (sendMessage, data.set, createSession, ...).
 */
type ApiArgs = Record<string, unknown>;
type AllowEntry = (client: ApiClient, args: ApiArgs) => Promise<unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

const ALLOWLIST: Record<string, AllowEntry> = {
  "agents.list": (c) => c.listAgents(),
  "agents.get": (c, a) => c.getAgent(str(a.id)),
  "sessions.list": (c, a) => c.listSessions(str(a.agentId)),
  "sessions.messages": (c, a) => c.getSessionMessages(str(a.agentId), str(a.id)),
  "sessions.status": (c, a) => c.getSessionStatus(str(a.agentId), str(a.id)),
  "content.get": (c, a) => c.getContent(str(a.path)),
  "content.listDir": (c, a) => c.listContent(str(a.path)),
  "content.stat": (c, a) => c.stat(str(a.path)),
  fileTree: (c) => c.getFileTree(),
};

registerAction("api.call", async (params, ctx) => {
  const { op, args } = params as { op: unknown; args: unknown };
  if (!ctx.client || typeof op !== "string") {
    respond(ctx, false, { error: "bad_request" });
    return;
  }
  const handler = ALLOWLIST[op];
  if (!handler) {
    respond(ctx, false, { error: "unknown_op" });
    return;
  }
  try {
    const data = await handler(ctx.client, (args as ApiArgs) ?? {});
    respond(ctx, true, data);
  } catch {
    respond(ctx, false, { error: "request_failed" });
  }
});
