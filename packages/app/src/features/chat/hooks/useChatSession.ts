import { useEffect } from "react";
import type { ApiClient } from "../../../lib/api";
import type { AttachedImage } from "../types";
import { useChatSessionStore } from "../runtime/session-store";
import type { ChatConnectionState } from "../runtime/session-state";
import { useChatGroups } from "./useChatGroups";

const IDLE_CONNECTION: ChatConnectionState = { state: "idle", attempt: 0, delayMs: 0 };

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
    useChatSessionStore.getState().attach(
      client,
      sessionId,
      baseUrl,
      projectId,
      agentId,
      initialMessage,
      accessToken,
    );
    return () => useChatSessionStore.getState().detach(sessionId);
  }, [client, sessionId, baseUrl, projectId, agentId, initialMessage, accessToken]);

  const timeline = useChatGroups(sessionId);
  const streaming = useChatSessionStore(
    (state) => state.sessions[sessionId]?.streaming ?? false,
  );
  const historyStatus = useChatSessionStore(
    (state) => state.sessions[sessionId]?.history.status ?? "pending",
  );
  const connection = useChatSessionStore(
    (state) => state.sessions[sessionId]?.connection ?? IDLE_CONNECTION,
  );
  const historyError = useChatSessionStore(
    (state) => state.sessions[sessionId]?.history.error ?? false,
  );
  const hasMore = useChatSessionStore(
    (state) => state.sessions[sessionId]?.history.hasMore ?? false,
  );
  const loadingMore = useChatSessionStore(
    (state) => state.sessions[sessionId]?.history.loadingMore ?? false,
  );
  const loading = historyStatus !== "ready" || connection.state === "connecting";

  return {
    ...timeline,
    streaming,
    loading,
    connection,
    historyError,
    hasMore,
    loadingMore,
    sendMessage: (text: string, image?: AttachedImage) =>
      useChatSessionStore.getState().sendMessage(sessionId, text, image),
    retry: () => useChatSessionStore.getState().retry(sessionId),
    withdrawLastTurn: () => useChatSessionStore.getState().withdrawLastTurn(sessionId),
    abort: () => useChatSessionStore.getState().abort(sessionId),
    reconnect: () => useChatSessionStore.getState().reconnect(sessionId),
    retryHistory: () => useChatSessionStore.getState().retryHistory(client, agentId, sessionId),
    respondApproval: (requestId: string, approved: boolean) =>
      useChatSessionStore.getState().respondApproval(sessionId, requestId, approved),
    respondQuestion: (requestId: string, answer: string) =>
      useChatSessionStore.getState().respondQuestion(sessionId, requestId, answer),
    loadMore: () => useChatSessionStore.getState().loadMore(client, sessionId, agentId),
  };
}
