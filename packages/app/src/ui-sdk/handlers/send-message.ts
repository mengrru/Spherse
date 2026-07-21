import { registerAction } from "../registry";
import { respond } from "../respond";
import { toast } from "sonner";
import { translate, normalizeLocale } from "@spherse/i18n";
import { useStreamingStore } from "../../features/chat/streaming-store";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useSettingsStore } from "../../stores/settings-store";
import { openChat } from "./open-chat";

registerAction("sendMessage", (params, ctx) => {
  const { sessionId, message, float } = params as {
    sessionId: string;
    message: string;
    float?: boolean;
  };
  if (!sessionId || typeof sessionId !== "string") return;
  if (!message || typeof message !== "string") return;

  // NOTE: store 校验不可靠——分页未加载或尚未 refresh 的 session 即使存在也会被判为不存在
  const sessions = useProjectDataStore.getState().projects[ctx.projectId]?.sessions ?? [];
  if (!sessions.some((s) => s.id === sessionId)) {
    const locale = normalizeLocale(useSettingsStore.getState().locale);
    toast.error(translate(locale, "ui-sdk.sessionNotFound"));
    respond(ctx, false, { error: "session_not_found" });
    return;
  }

  const { sendMessage: wsSend, sessions: wsSessions } = useStreamingStore.getState();
  const session = wsSessions[sessionId];
  const ws = session?.ws;

  if (session?.streaming) {
    respond(ctx, false, { error: "session_busy" });
  } else if (ws && ws.readyState === WebSocket.OPEN) {
    wsSend(sessionId, message);
    respond(ctx, true);
  } else {
    useProjectDataStore.getState().setInitialMessage(ctx.projectId, sessionId, message);
    respond(ctx, true);
  }

  openChat(ctx, sessionId, float);
});
