import { registerAction } from "../registry";
import { useStreamingStore } from "../../features/chat/streaming-store";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useProjectUiStore } from "../../stores/project-ui-store";
import { getDefaultFloatingState } from "../../features/floating-chat";

registerAction("sendMessage", (params, ctx) => {
  const { sessionId, message, float } = params as {
    sessionId: string;
    message: string;
    float?: boolean;
  };
  if (!sessionId || typeof sessionId !== "string") return;
  if (!message || typeof message !== "string") return;

  const { sendMessage: wsSend, sessions } = useStreamingStore.getState();
  const ws = sessions[sessionId]?.ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    wsSend(sessionId, message);
  } else {
    useProjectDataStore.getState().setInitialMessage(ctx.projectKey, sessionId, message);
  }

  const ui = useProjectUiStore.getState().projects[ctx.projectKey];
  if (float && ui?.floatingChat?.sessionId !== sessionId) {
    useProjectUiStore.getState().setFloatingChat(ctx.projectKey, getDefaultFloatingState(sessionId));
  }
  if (!float && ui?.floatingChat?.sessionId !== sessionId) {
    ctx.navigate(`/project/${ctx.projectKey}/chat/${sessionId}`);
  }
});
