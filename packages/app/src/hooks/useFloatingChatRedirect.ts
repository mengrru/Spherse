import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useProjectUiStore } from "../stores/project-ui-store";

export function useFloatingChatRedirect(projectKey: string, activeSessionId: string | null) {
  const navigate = useNavigate();
  const floatingChat = useProjectUiStore((s) =>
    projectKey ? s.projects[projectKey]?.floatingChat : undefined,
  );

  useEffect(() => {
    if (!floatingChat) return;
    if (activeSessionId === floatingChat.sessionId) {
      navigate(`/project/${projectKey}`);
    }
  }, [floatingChat, activeSessionId, navigate, projectKey]);
}
