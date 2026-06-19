import { registerAction } from "../registry";
import { useStreamingStore } from "../../features/chat/streaming-store";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useFloatingChatStore } from "../../features/floating-chat/store";
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

  const floatingSessionId = useFloatingChatStore.getState().byProject[ctx.projectId]?.sessionId;
  if (float && floatingSessionId !== sessionId) {
    useFloatingChatStore.getState().setFloatingChat(ctx.projectId, getDefaultFloatingState(sessionId));
  }
  if (!float && floatingSessionId !== sessionId) {
    ctx.navigate(`/project/${ctx.projectId}/chat/${sessionId}`);
  }
});
