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
    useProjectDataStore.getState().setInitialMessage(ctx.projectId, sessionId, message);
  }

  const ui = useProjectUiStore.getState().projects[ctx.projectId];
  if (float && ui?.floatingChat?.sessionId !== sessionId) {
    useProjectUiStore.getState().setFloatingChat(ctx.projectId, getDefaultFloatingState(sessionId));
  }
  if (!float && ui?.floatingChat?.sessionId !== sessionId) {
    ctx.navigate(`/project/${ctx.projectId}/chat/${sessionId}`);
  }
});
