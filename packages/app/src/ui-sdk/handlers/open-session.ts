import { registerAction } from "../registry";
import { respond } from "../respond";
import { toast } from "sonner";
import { translate, normalizeLocale } from "@spherse/i18n";
import { useSettingsStore } from "../../stores/settings-store";
import { openChat } from "./open-chat";
import { ensureProjectSession } from "../../lib/project-queries";

registerAction("openSession", async (params, ctx) => {
  const { sessionId, float } = params as { sessionId: string; float?: boolean };
  if (!sessionId || typeof sessionId !== "string") return;

  const session = await ensureProjectSession(ctx.projectId, ctx.client, sessionId).catch(() => null);
  if (!session) {
    const locale = normalizeLocale(useSettingsStore.getState().locale);
    toast.error(translate(locale, "ui-sdk.sessionNotFound"));
    respond(ctx, false, { error: "session_not_found" });
    return;
  }

  openChat(ctx, sessionId, float);
});
