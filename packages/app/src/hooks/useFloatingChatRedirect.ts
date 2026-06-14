import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useProjectUiStore } from "../stores/project-ui-store";

export function useFloatingChatRedirect(projectId: string, activeSessionId: string | null) {
  const navigate = useNavigate();
  const floatingChat = useProjectUiStore((s) =>
    projectId ? s.projects[projectId]?.floatingChat : undefined,
  );

  useEffect(() => {
    if (!floatingChat) return;
    if (activeSessionId === floatingChat.sessionId) {
      navigate(`/project/${projectId}`);
    }
  }, [floatingChat, activeSessionId, navigate, projectId]);
}
