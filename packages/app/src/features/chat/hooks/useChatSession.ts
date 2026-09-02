import { useEffect } from "react";
import type { ApiClient } from "../../../lib/api";
import type { AttachedImage, ChatMessage } from "../types";
import { useReplicaStore } from "../replica-store";

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
    useReplicaStore.getState().attach(client, sessionId, baseUrl, projectId, agentId, initialMessage, accessToken);
    return () => useReplicaStore.getState().detach(sessionId);
  }, [client, sessionId, baseUrl, projectId, agentId, initialMessage, accessToken]);

  const messages = useReplicaStore(
    (s) => s.sessions[sessionId]?.messages ?? EMPTY_MESSAGES,
  );
  const streaming = useReplicaStore(
    (s) => s.sessions[sessionId]?.streaming ?? false,
  );
  const historyStatus = useReplicaStore(
    (s) => s.sessions[sessionId]?.historyStatus ?? "pending",
  );
  const connectionStatus = useReplicaStore(
    (s) => s.sessions[sessionId]?.connectionStatus ?? "disconnected",
  );
  const historyError = useReplicaStore(
    (s) => s.sessions[sessionId]?.historyError ?? false,
  );
  const reconnectFailed = useReplicaStore(
    (s) => s.sessions[sessionId]?.reconnectFailed ?? false,
  );
  const loading =
    historyStatus !== "ready" || connectionStatus === "connecting";

  return {
    messages,
    streaming,
    loading,
    connectionStatus,
    historyError,
    reconnectFailed,
    sendMessage: (text: string, image?: AttachedImage) => useReplicaStore.getState().sendMessage(sessionId, text, image),
    retry: () => useReplicaStore.getState().retry(sessionId),
    withdrawLastTurn: () => useReplicaStore.getState().withdrawLastTurn(sessionId),
    abort: () => useReplicaStore.getState().abort(sessionId),
    reconnect: () => useReplicaStore.getState().reconnect(sessionId),
    retryHistory: () => useReplicaStore.getState().retryHistory(client, agentId, sessionId),
    respondApproval: (requestId: string, approved: boolean) =>
      useReplicaStore.getState().respondApproval(sessionId, requestId, approved),
    respondQuestion: (requestId: string, answer: string) =>
      useReplicaStore.getState().respondQuestion(sessionId, requestId, answer),
  };
}
