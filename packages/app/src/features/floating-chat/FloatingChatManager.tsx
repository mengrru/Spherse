import { useAppStore } from "../../stores/app-store";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useProjectUiStore } from "../../stores/project-ui-store";
import { FloatingChatContainer } from "./FloatingChatContainer";

export function FloatingChatManager() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const project = useAppStore((s) =>
    s.activeProjectId ? s.projects.get(s.activeProjectId) : undefined,
  );
  const projectUi = useProjectUiStore((s) =>
    activeProjectId ? s.projects[activeProjectId] : undefined,
  );
  const projectData = useProjectDataStore((s) =>
    activeProjectId ? s.projects[activeProjectId] : undefined,
  );

  const floatingChat = projectUi?.floatingChat;
  if (!floatingChat || !activeProjectId || !project) return null;

  const sessions = projectData?.sessions ?? [];
  const agents = projectData?.agents ?? [];
  const session = sessions.find((s) => s.id === floatingChat.sessionId);
  if (!session) {
    useProjectUiStore.getState().setFloatingChat(activeProjectId, null);
    return null;
  }

  const agent = agents.find((a) => a.id === session.agentId);
  if (!agent) return null;

  return (
    <FloatingChatContainer
      projectId={activeProjectId}
      floatingChat={floatingChat}
      agent={agent}
      client={project.ctx.client}
      baseUrl={project.ctx.baseUrl}
    />
  );
}
