import { registerAction } from "../registry";
import { respond } from "../respond";
import { toast } from "sonner";
import { translate, normalizeLocale } from "@spherse/i18n";
import { useStreamingStore } from "../../features/chat/runtime/streaming-store";
import { useSettingsStore } from "../../stores/settings-store";
import { ApiError } from "../../lib/api";
import { openChat } from "./open-chat";
import { ensureProjectSession, getCachedSession } from "../../lib/project-queries";

registerAction("sendMessage", async (params, ctx) => {
  const { sessionId, message, open, float } = params as {
    sessionId: string;
    message: string;
    open?: boolean;
    float?: boolean;
  };
  if (!sessionId || typeof sessionId !== "string") return;
  if (!message || typeof message !== "string") return;

  const session = getCachedSession(ctx.projectId, sessionId) ?? (ctx.client
    ? await ensureProjectSession(ctx.projectId, ctx.client, sessionId).catch(() => null)
    : null);
  if (!session) {
    const locale = normalizeLocale(useSettingsStore.getState().locale);
    toast.error(translate(locale, "ui-sdk.sessionNotFound"));
    respond(ctx, false, { error: "session_not_found" });
    return;
  }

  const { sendMessage: wsSend, sessions: wsSessions } = useStreamingStore.getState();

  if (wsSessions[sessionId]?.streaming) {
    respond(ctx, false, { error: "session_busy" });
  } else if (wsSend(sessionId, message)) {
    respond(ctx, true);
  } else if (!ctx.client) {
    respond(ctx, false, { error: "send_failed" });
  } else {
    try {
      await ctx.client.sendMessage(session.agentId, sessionId, message);
      respond(ctx, true);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      respond(ctx, false, { error: status === 409 ? "session_busy" : "send_failed" });
    }
  }

  if (open === false) return;
  openChat(ctx, sessionId, float);
});
