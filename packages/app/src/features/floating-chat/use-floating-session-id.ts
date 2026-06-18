import { useProjectUiStore } from "../../stores/project-ui-store";

export function useFloatingSessionId(projectId: string): string | null {
  return useProjectUiStore((s) => s.projects[projectId]?.floatingChat?.sessionId ?? null);
}
