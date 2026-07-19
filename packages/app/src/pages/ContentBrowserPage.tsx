import { useNavigate, useSearchParams } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { ContentBrowser } from "../features/content-browser";
import { useProjectCtx } from "../context/project-context";
import { useProjectNavigation } from "../lib/use-project-navigation";
import { useProjectDataStore } from "../stores/project-data-store";
import { useFloatingSessionId } from "../features/floating-chat/use-floating-session-id";
import type { ActiveSessionInfo } from "../lib/types";

export function ContentBrowserPage() {
  const { projectId, client } = useProjectCtx();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { back } = useProjectNavigation();
  const { t } = useI18n();
  const projectData = useProjectDataStore((s) => s.projects[projectId]);
  const createSession = useProjectDataStore((s) => s.createSession);
  const floatingSessionId = useFloatingSessionId(projectId);

  const filePath = searchParams.get("path");
  const agents = projectData?.agents ?? [];
  const sessions = projectData?.sessions ?? [];

  const activeSessions: ActiveSessionInfo[] = [];
  if (floatingSessionId) {
    const floatingSession = sessions.find((s) => s.id === floatingSessionId);
    const floatingAgent = floatingSession ? agents.find((a) => a.id === floatingSession.agentId) : null;
    if (floatingSession && floatingAgent) {
      activeSessions.push({
        sessionId: floatingSession.id,
        agentName: floatingAgent.name,
        sessionTitle: floatingSession.title,
        floating: true,
      });
    }
  }

  if (!filePath) {
    navigate(`/project/${projectId}`, { replace: true });
    return null;
  }

  const handleStartSession = async (
    agentId: string,
    selectedText: string,
    sourcePath: string,
    comment?: string,
  ) => {
    const quotedText = selectedText.split("\n").map((line) => `> ${line}`).join("\n");
    const parts = [t("text-selection.promptPrefix", { path: sourcePath, text: quotedText })];
    if (comment) parts.push(`\n\n${comment}`);
    const message = parts.join("");
    const session = await createSession(projectId, client, agentId, message);
    if (session) {
      navigate(`/project/${projectId}/chat/${session.id}`);
    }
  };

  return (
    <ContentBrowser
      key={filePath}
      filePath={filePath}
      onBack={back}
      onClose={() => navigate(`/project/${projectId}`, { replace: true })}
      agents={agents}
      activeSessions={activeSessions}
      onStartSession={handleStartSession}
    />
  );
}
