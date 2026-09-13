import { useChatSessionStore } from "./session-store";

export function useSessionStreaming(sessionId: string): boolean {
  return useChatSessionStore(
    (state) => state.sessions[sessionId]?.streaming ?? false,
  );
}
