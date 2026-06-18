import { useEffect } from "react";
import { useAppStore } from "../../stores/app-store";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useProjectUiStore } from "../../stores/project-ui-store";
import { useProjectCtx } from "../../lib/project-context";
import { FloatingChatContainer } from "./FloatingChatContainer";

export function FloatingChatManager() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const { client, baseUrl } = useProjectCtx();
  const projectUi = useProjectUiStore((s) =>
    activeProjectId ? s.projects[activeProjectId] : undefined,
  );
  const projectData = useProjectDataStore((s) =>
    activeProjectId ? s.projects[activeProjectId] : undefined,
  );
  const setFloatingChat = useProjectUiStore((s) => s.setFloatingChat);

  const floatingChat = projectUi?.floatingChat;
  const sessions = projectData?.sessions ?? [];
  const agents = projectData?.agents ?? [];
  const session = floatingChat ? sessions.find((s) => s.id === floatingChat.sessionId) : undefined;

  useEffect(() => {
    if (floatingChat && activeProjectId && !session) {
      setFloatingChat(activeProjectId, null);
    }
  }, [floatingChat, activeProjectId, session, setFloatingChat]);

  if (!floatingChat || !activeProjectId || !session) return null;

  const agent = agents.find((a) => a.id === session.agentId);
  if (!agent) return null;

  return (
    <FloatingChatContainer
      projectId={activeProjectId}
      floatingChat={floatingChat}
      agent={agent}
      client={client}
      baseUrl={baseUrl}
    />
  );
}
