import { useEffect } from "react";
import type { ApiClient } from "../../../lib/api";
import type { ChatMessage } from "../types";
import { useStreamingStore } from "../runtime/streaming-store";

const EMPTY_MESSAGES: ChatMessage[] = [];

export function useChatSession({
  client,
  sessionId,
  baseUrl,
  projectId,
  agentId,
  initialMessage,
  accessToken,
}: {
  client: ApiClient;
  sessionId: string;
  baseUrl: string;
  projectId: string;
  agentId: string;
  initialMessage?: string;
  accessToken?: string | null;
}) {
  useEffect(() => {
    useStreamingStore.getState().attach(client, sessionId, baseUrl, projectId, agentId, initialMessage, accessToken);
    return () => useStreamingStore.getState().detach(sessionId);
  }, [client, sessionId, baseUrl, projectId, agentId, initialMessage, accessToken]);

  const messages = useStreamingStore(
    (s) => s.sessions[sessionId]?.messages ?? EMPTY_MESSAGES,
  );
  const streaming = useStreamingStore(
    (s) => s.sessions[sessionId]?.streaming ?? false,
  );
  const historyStatus = useStreamingStore(
    (s) => s.sessions[sessionId]?.historyStatus ?? "pending",
  );
  const connectionStatus = useStreamingStore(
    (s) => s.sessions[sessionId]?.connectionStatus ?? "disconnected",
  );
  const loading =
    historyStatus !== "ready" || connectionStatus === "connecting";

  return {
    messages,
    streaming,
    loading,
    sendMessage: (text: string) => useStreamingStore.getState().sendMessage(sessionId, text),
    abort: () => useStreamingStore.getState().abort(sessionId),
  };
}
