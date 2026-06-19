import { useFloatingChatStore } from "./store";

export function useFloatingSessionId(projectId: string): string | null {
  return useFloatingChatStore((s) => s.byProject[projectId]?.sessionId ?? null);
}
