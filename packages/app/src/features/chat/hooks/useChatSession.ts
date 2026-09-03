import { useEffect, useMemo } from "react";
import type { ApiClient } from "../../../lib/api";
import { buildRenderList } from "../model/render-list";
import { useStreamingStore } from "../runtime/streaming-store";
import { isSessionStreaming, type AttachedImage, type RenderItem } from "../types";

const EMPTY_ITEMS: RenderItem[] = [];

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

  const session = useStreamingStore((s) => s.sessions[sessionId]);
  const items = useMemo(
    () => (session ? buildRenderList(session) : EMPTY_ITEMS),
    [session],
  );
  const streaming = session ? isSessionStreaming(session) : false;
  const historyStatus = session?.history.historyStatus ?? "pending";
  const connectionStatus = session?.connectionStatus ?? "disconnected";
  const historyError = session?.history.historyError ?? false;
  const reconnectFailed = session?.reconnectFailed ?? false;
  const loading =
    historyStatus !== "ready" || connectionStatus === "connecting";

  return {
    items,
    streaming,
    loading,
    connectionStatus,
    historyError,
    reconnectFailed,
    sendMessage: (text: string, image?: AttachedImage) => {
      if (!image) return useStreamingStore.getState().sendMessage(sessionId, text);
      const { previewUrl: _previewUrl, ...sendable } = image;
      return useStreamingStore.getState().sendMessage(sessionId, text, sendable);
    },
    retry: () => useStreamingStore.getState().retry(sessionId),
    withdrawLastTurn: () => useStreamingStore.getState().withdrawLastTurn(sessionId),
    abort: () => useStreamingStore.getState().abort(sessionId),
    reconnect: () => useStreamingStore.getState().reconnect(sessionId),
    retryHistory: () => useStreamingStore.getState().retryHistory(client, agentId, sessionId),
    respondApproval: (requestId: string, approved: boolean) =>
      useStreamingStore.getState().respondApproval(sessionId, requestId, approved),
    respondQuestion: (requestId: string, answer: string) =>
      useStreamingStore.getState().respondQuestion(sessionId, requestId, answer),
  };
}
