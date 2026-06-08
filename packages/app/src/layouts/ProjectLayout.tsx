import { useEffect } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { ContentBrowser } from "../features/content-browser";
import { Chat } from "../features/chat";
import { ProjectPanel } from "../features/project-panel";
import { useCustomTheme } from "../hooks/useCustomTheme";
import { WelcomePage } from "../features/welcome-page";
import type { ProjectState } from "../stores/app-store";
import { useAppStore } from "../stores/app-store";
import { useProjectDataStore } from "../stores/project-data-store";

export interface ProjectLayoutProps {
  projectKey: string;
  project: ProjectState;
}

function buildContentUrl(projectKey: string, filePath: string, sessionId?: string | null): string {
  const params = new URLSearchParams({ path: filePath });
  if (sessionId) params.set("sessionId", sessionId);
  return `/project/${projectKey}/content?${params.toString()}`;
}

export function ProjectLayout({ projectKey, project }: ProjectLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const { t } = useI18n();
  const setActiveProject = useAppStore((state) => state.setActiveProject);
  const setProjectLastRoute = useAppStore((state) => state.setProjectLastRoute);
  const projectData = useProjectDataStore((state) => state.projects[projectKey]);
  const refreshAgents = useProjectDataStore((state) => state.refreshAgents);
  const refreshSessions = useProjectDataStore((state) => state.refreshSessions);
  const createSession = useProjectDataStore((state) => state.createSession);
  const consumeInitialMessage = useProjectDataStore((state) => state.consumeInitialMessage);

  const agents = projectData?.agents ?? [];
  const sessions = projectData?.sessions ?? [];
  const contentPath = searchParams.get("path");
  const contentSessionId = searchParams.get("sessionId");
  const isContentRoute = location.pathname.endsWith("/content");
  const showingContent = isContentRoute && Boolean(contentPath);
  const activeSessionId = sessionId ?? contentSessionId ?? null;
  const selectedSession = activeSessionId
    ? sessions.find((session) => session.id === activeSessionId) ?? null
    : null;
  const selectedAgent = selectedSession
    ? agents.find((agent) => agent.id === selectedSession.agentId) ?? null
    : null;
  const initialMessage = selectedSession
    ? projectData?.initialMessageBySessionId[selectedSession.id]
    : undefined;

  useCustomTheme(project.ctx.projectRoot, project.ctx.port);

  useEffect(() => {
    void setActiveProject(projectKey);
  }, [projectKey, setActiveProject]);

  useEffect(() => {
    const fullPath = location.pathname + location.search;
    const prefix = `/project/${projectKey}`;
    const subRoute = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : "";
    void setProjectLastRoute(projectKey, subRoute);
  }, [location.pathname, location.search, projectKey, setProjectLastRoute]);

  useEffect(() => {
    void refreshAgents(projectKey, project.ctx.client);
    void refreshSessions(projectKey, project.ctx.client);
  }, [project.ctx.client, projectKey, refreshAgents, refreshSessions]);

  useEffect(() => {
    if (initialMessage && selectedSession) {
      consumeInitialMessage(projectKey, selectedSession.id);
    }
  }, [consumeInitialMessage, initialMessage, projectKey, selectedSession]);

  const handleSelectFile = (filePath: string) => {
    navigate(buildContentUrl(projectKey, filePath, activeSessionId));
  };

  const handleBackToChat = () => {
    if (activeSessionId) {
      navigate(`/project/${projectKey}/chat/${activeSessionId}`);
    } else {
      navigate(`/project/${projectKey}`);
    }
  };

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
    const session = await createSession(projectKey, project.ctx.client, agentId, message);
    if (session) {
      navigate(`/project/${projectKey}/chat/${session.id}`);
    }
  };

  const handleFileDeleted = (deletedPath: string) => {
    if (contentPath && (contentPath === deletedPath || contentPath.startsWith(`${deletedPath}/`))) {
      handleBackToChat();
    }
  };

  return (
    <div className="relative flex h-full flex-1 overflow-hidden">
      <ProjectPanel
        projectKey={projectKey}
        project={project}
        activeSessionId={activeSessionId}
        selectedAgentId={selectedAgent?.id ?? null}
        selectedFilePath={showingContent ? contentPath ?? undefined : undefined}
        onSelectFile={handleSelectFile}
        onFileDeleted={handleFileDeleted}
      />
      <main className="flex-1 overflow-hidden flex flex-col">
        {selectedSession && selectedAgent && (
          <div className={!showingContent ? "contents" : "hidden"}>
            <Chat
              key={selectedSession.id}
              client={project.ctx.client}
              sessionId={selectedSession.id}
              agent={selectedAgent}
              onNavigateToPath={handleSelectFile}
              initialMessage={initialMessage}
              onClose={() => navigate(`/project/${projectKey}`)}
            />
          </div>
        )}
        {showingContent && contentPath && (
          <ContentBrowser
            client={project.ctx.client}
            filePath={contentPath}
            onBack={handleBackToChat}
            agents={agents}
            onStartSession={handleStartSession}
          />
        )}
        {!showingContent && !(selectedSession && selectedAgent) && (
          <WelcomePage
            client={project.ctx.client}
            fallback={
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <p>{t("chat.startConversation")}</p>
              </div>
            }
          />
        )}
      </main>
    </div>
  );
}
