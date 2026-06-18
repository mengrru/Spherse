import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useFloatingSessionId } from "./use-floating-session-id";

export function useFloatingChatRedirect(projectId: string, activeSessionId: string | null) {
  const navigate = useNavigate();
  const floatingSessionId = useFloatingSessionId(projectId);

  useEffect(() => {
    if (floatingSessionId && activeSessionId === floatingSessionId) {
      navigate(`/project/${projectId}`);
    }
  }, [floatingSessionId, activeSessionId, navigate, projectId]);
}
