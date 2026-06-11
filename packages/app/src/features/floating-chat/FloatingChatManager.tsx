import { useAppStore } from "../../stores/app-store";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useProjectUiStore } from "../../stores/project-ui-store";
import { FloatingChatContainer } from "./FloatingChatContainer";

export function FloatingChatManager() {
  const activeProjectKey = useAppStore((s) => s.activeProjectKey);
  const project = useAppStore((s) =>
    s.activeProjectKey ? s.projects.get(s.activeProjectKey) : undefined,
  );
  const projectUi = useProjectUiStore((s) =>
    activeProjectKey ? s.projects[activeProjectKey] : undefined,
  );
  const projectData = useProjectDataStore((s) =>
    activeProjectKey ? s.projects[activeProjectKey] : undefined,
  );

  const floatingChat = projectUi?.floatingChat;
  if (!floatingChat || !activeProjectKey) return null;

  const sessions = projectData?.sessions ?? [];
  const agents = projectData?.agents ?? [];
  const session = sessions.find((s) => s.id === floatingChat.sessionId);
  if (!session) {
    useProjectUiStore.getState().setFloatingChat(activeProjectKey, null);
    return null;
  }

  const agent = agents.find((a) => a.id === session.agentId);
  if (!agent) return null;

  return (
    <FloatingChatContainer
      projectKey={activeProjectKey}
      floatingChat={floatingChat}
      agent={agent}
      client={project.ctx.client}
      port={project.ctx.port}
    />
  );
}
