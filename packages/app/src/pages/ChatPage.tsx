import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { Chat } from "../features/chat";
import { useProjectDataStore } from "../stores/project-data-store";
import { useFloatingChatRedirect } from "../features/floating-chat/use-floating-chat-redirect";

export function ChatPage() {
  const { projectId = "", sessionId = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const projectData = useProjectDataStore((s) => s.projects[projectId]);
  const consumeInitialMessage = useProjectDataStore((s) => s.consumeInitialMessage);

  useFloatingChatRedirect(projectId, sessionId);

  const agents = projectData?.agents ?? [];
  const sessions = projectData?.sessions ?? [];
  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const agent = session ? agents.find((a) => a.id === session.agentId) ?? null : null;
  const initialMessage = session ? projectData?.initialMessageBySessionId[session.id] : undefined;

  useEffect(() => {
    if (initialMessage && session) {
      consumeInitialMessage(projectId, session.id);
    }
  }, [consumeInitialMessage, initialMessage, projectId, session]);

  if (!session || !agent) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <Chat
      key={session.id}
      sessionId={session.id}
      agent={agent}
      onNavigateToPath={(path) => navigate(`/project/${projectId}/content?path=${encodeURIComponent(path)}`)}
      initialMessage={initialMessage}
      onClose={() => navigate(`/project/${projectId}`)}
    />
  );
}
