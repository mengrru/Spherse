import { registerAction } from "../registry";
import { useStreamingStore } from "../../features/chat/streaming-store";
import { useProjectDataStore } from "../../stores/project-data-store";

registerAction("sendMessage", (params, ctx) => {
  const { sessionId, message } = params as { sessionId: string; message: string };
  if (!sessionId || typeof sessionId !== "string") return;
  if (!message || typeof message !== "string") return;

  const { sendMessage: wsSend, sessions } = useStreamingStore.getState();
  const ws = sessions[sessionId]?.ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    wsSend(sessionId, message);
  } else {
    useProjectDataStore.getState().setInitialMessage(ctx.projectKey, sessionId, message);
  }
  ctx.navigate(`/project/${ctx.projectKey}/chat/${sessionId}`);
});
