import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { Chat } from "../features/chat";
import { useProjectDataStore } from "../stores/project-data-store";
import { useProjectCtx } from "../context/project-context";
import { useApiClient } from "../lib/use-connection";
import { useProjectAgents, useProjectSession } from "../queries/project";

export function ChatPage() {
  const { sessionId = "" } = useParams();
  const { projectId } = useProjectCtx();
  const navigate = useNavigate();
  const { t } = useI18n();
  const client = useApiClient(projectId);
  const { agents } = useProjectAgents(projectId, client);
  const sessionQuery = useProjectSession(projectId, client, sessionId);
  const projectData = useProjectDataStore((s) => s.projects[projectId]);
  const consumeInitialMessage = useProjectDataStore((s) => s.consumeInitialMessage);

  const session = sessionQuery.data ?? null;
  const agent = session ? agents.find((a) => a.id === session.agentId) ?? null : null;
  const initialMessage = session ? projectData?.initialMessageBySessionId[session.id] : undefined;

  useEffect(() => {
    if (initialMessage && session) {
      consumeInitialMessage(projectId, session.id);
    }
  }, [consumeInitialMessage, initialMessage, projectId, session]);

  useEffect(() => {
    if (sessionQuery.isSuccess && sessionQuery.data === null) {
      navigate(`/project/${projectId}`, { replace: true });
    }
  }, [navigate, projectId, sessionQuery.data, sessionQuery.isSuccess]);

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
