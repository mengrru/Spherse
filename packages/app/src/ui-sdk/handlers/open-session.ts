import { registerAction } from "../registry";
import { respond } from "../respond";
import { toast } from "sonner";
import { translate, normalizeLocale } from "@spherse/i18n";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useSettingsStore } from "../../stores/settings-store";
import { openChat } from "./open-chat";

registerAction("openSession", (params, ctx) => {
  const { sessionId, float } = params as { sessionId: string; float?: boolean };
  if (!sessionId || typeof sessionId !== "string") return;

  // NOTE: store 校验不可靠——分页未加载或尚未 refresh 的 session 即使存在也会被判为不存在
  const sessions = useProjectDataStore.getState().projects[ctx.projectId]?.sessions ?? [];
  if (!sessions.some((s) => s.id === sessionId)) {
    const locale = normalizeLocale(useSettingsStore.getState().locale);
    toast.error(translate(locale, "ui-sdk.sessionNotFound"));
    respond(ctx, false, { error: "session_not_found" });
    return;
  }

  openChat(ctx, sessionId, float);
});
