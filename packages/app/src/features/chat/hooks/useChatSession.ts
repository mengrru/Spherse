import { useEffect } from "react";
import type { ApiClient } from "../../../lib/api";
import type { ChatMessage } from "../../../lib/types";
import { useStreamingStore } from "../streaming-store";

const EMPTY_MESSAGES: ChatMessage[] = [];

export function useChatSession({
  client,
  sessionId,
  port,
  initialMessage,
}: {
  client: ApiClient;
  sessionId: string;
  port: number;
  initialMessage?: string;
}) {
  useEffect(() => {
    useStreamingStore.getState().attach(client, sessionId, port, initialMessage);
    return () => useStreamingStore.getState().detach(sessionId);
  }, [client, sessionId, port, initialMessage]);

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
