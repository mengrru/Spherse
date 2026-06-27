import { useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useProjectCtx } from "../../context/project-context";
import { useFloatingChatStore } from "./store";
import { FloatingChatContainer } from "./FloatingChatContainer";

export function FloatingChatManager() {
  const { projectId } = useProjectCtx();
  const { sessionId: routeSessionId } = useParams();
  const navigate = useNavigate();
  const floatingChat = useFloatingChatStore((s) =>
    projectId ? s.byProject[projectId] : undefined,
  );
  const projectData = useProjectDataStore((s) =>
    projectId ? s.projects[projectId] : undefined,
  );
  const setFloatingChat = useFloatingChatStore((s) => s.setFloatingChat);

  const sessions = projectData?.sessions ?? [];
  const agents = projectData?.agents ?? [];
  const session = floatingChat ? sessions.find((s) => s.id === floatingChat.sessionId) : undefined;

  useEffect(() => {
    if (floatingChat && projectId && !session) {
      setFloatingChat(projectId, null);
    }
  }, [floatingChat, projectId, session, setFloatingChat]);

  useEffect(() => {
    if (floatingChat && routeSessionId === floatingChat.sessionId) {
      navigate(`/project/${projectId}`);
    }
  }, [floatingChat, routeSessionId, navigate, projectId]);

  if (!floatingChat || !session) return null;

  const agent = agents.find((a) => a.id === session.agentId);
  if (!agent) return null;

  return (
    <FloatingChatContainer
      projectId={projectId}
      floatingChat={floatingChat}
      agent={agent}
    />
  );
}
