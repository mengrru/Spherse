import { registerAction } from "../registry";
import { respond } from "../respond";
import { toast } from "sonner";
import { translate, normalizeLocale } from "@spherse/i18n";
import { useSettingsStore } from "../../stores/settings-store";
import { openChat } from "./open-chat";
import { ensureProjectSession, getCachedSession } from "../../lib/project-queries";

registerAction("floatSession", async (params, ctx) => {
  const { sessionId } = params as { sessionId: string };
  if (!sessionId || typeof sessionId !== "string") return;

  const session = getCachedSession(ctx.projectId, sessionId) ?? (ctx.client
    ? await ensureProjectSession(ctx.projectId, ctx.client, sessionId).catch(() => null)
    : null);
  if (!session) {
    const locale = normalizeLocale(useSettingsStore.getState().locale);
    toast.error(translate(locale, "ui-sdk.sessionNotFound"));
    respond(ctx, false, { error: "session_not_found" });
    return;
  }

  openChat(ctx, sessionId, true);
});
