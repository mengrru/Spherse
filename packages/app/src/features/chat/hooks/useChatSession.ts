import { useEffect } from "react";
import type { ApiClient } from "../../../lib/api";
import type { ChatMessage } from "../types";
import { useStreamingStore } from "../streaming-store";

const EMPTY_MESSAGES: ChatMessage[] = [];

export function useChatSession({
  client,
  sessionId,
  baseUrl,
  projectId,
  agentId,
  initialMessage,
}: {
  client: ApiClient;
  sessionId: string;
  baseUrl: string;
  projectId: string;
  agentId: string;
  initialMessage?: string;
}) {
  useEffect(() => {
    useStreamingStore.getState().attach(client, sessionId, baseUrl, projectId, agentId, initialMessage);
    return () => useStreamingStore.getState().detach(sessionId);
  }, [client, sessionId, baseUrl, projectId, agentId, initialMessage]);

  const messages = useStreamingStore(
    (s) => s.sessions[sessionId]?.messages ?? EMPTY_MESSAGES,
  );
  const streaming = useStreamingStore(
    (s) => s.sessions[sessionId]?.streaming ?? false,
  );

  return {
    messages,
    streaming,
    sendMessage: (text: string) => useStreamingStore.getState().sendMessage(sessionId, text),
    abort: () => useStreamingStore.getState().abort(sessionId),
  };
}
