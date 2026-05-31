import { useEffect } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ContentBrowser } from "../features/content-browser";
import { Chat } from "../features/chat";
import { ProjectSidebar } from "../features/project-sidebar";
import { useCustomTheme } from "../hooks/useCustomTheme";
import type { ProjectState } from "../stores/app-store";
import { useAppStore } from "../stores/app-store";
import { useProjectWorkspaceStore } from "../stores/project-workspace-store";

export interface ProjectLayoutProps {
  projectKey: string;
  project: ProjectState;
}

function buildContentUrl(projectKey: string, filePath: string): string {
  return `/project/${projectKey}/content?path=${encodeURIComponent(filePath)}`;
}

export function ProjectLayout({ projectKey, project }: ProjectLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const setActiveProject = useAppStore((state) => state.setActiveProject);
  const workspace = useProjectWorkspaceStore((state) => state.workspaces[projectKey]);
  const refreshAgents = useProjectWorkspaceStore((state) => state.refreshAgents);
  const refreshSessions = useProjectWorkspaceStore((state) => state.refreshSessions);
  const createSession = useProjectWorkspaceStore((state) => state.createSession);
  const setActiveSession = useProjectWorkspaceStore((state) => state.setActiveSession);
  const rememberContentPath = useProjectWorkspaceStore((state) => state.rememberContentPath);
  const consumeInitialMessage = useProjectWorkspaceStore((state) => state.consumeInitialMessage);

  const agents = workspace?.agents ?? [];
  const sessions = workspace?.sessions ?? [];
  const contentPath = searchParams.get("path");
  const isContentRoute = location.pathname.endsWith("/content");
  const showingContent = isContentRoute && Boolean(contentPath);
  const activeSessionId = sessionId ?? workspace?.activeSessionId ?? null;
  const selectedSession = activeSessionId
    ? sessions.find((session) => session.id === activeSessionId) ?? null
    : null;
  const selectedAgent = selectedSession
    ? agents.find((agent) => agent.id === selectedSession.agentId) ?? null
    : null;
  const initialMessage = selectedSession
    ? workspace?.initialMessageBySessionId[selectedSession.id]
    : undefined;

  useCustomTheme(project.ctx.projectRoot, project.ctx.port);

  useEffect(() => {
    void setActiveProject(projectKey);
  }, [projectKey, setActiveProject]);

  useEffect(() => {
    void refreshAgents(projectKey);
    void refreshSessions(projectKey);
  }, [projectKey, refreshAgents, refreshSessions]);

  useEffect(() => {
    if (sessionId) {
      setActiveSession(projectKey, sessionId);
    }
  }, [projectKey, sessionId, setActiveSession]);

  useEffect(() => {
    if (contentPath) {
      rememberContentPath(projectKey, contentPath);
    }
  }, [contentPath, projectKey, rememberContentPath]);

  useEffect(() => {
    if (initialMessage && selectedSession) {
      consumeInitialMessage(projectKey, selectedSession.id);
    }
  }, [consumeInitialMessage, initialMessage, projectKey, selectedSession]);

  const handleSelectFile = (filePath: string) => {
    rememberContentPath(projectKey, filePath);
    navigate(buildContentUrl(projectKey, filePath));
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
    const parts = [`请处理以下来自「${sourcePath}」的内容：\n\n> ${selectedText}`];
    if (comment) parts.push(`\n\n${comment}`);
    const message = parts.join("");
    const session = await createSession(projectKey, agentId, message);
    if (session) {
      navigate(`/project/${projectKey}/chat/${session.id}`);
    }
  };

  const handleFileDeleted = (deletedPath: string) => {
    if (contentPath && (contentPath === deletedPath || contentPath.startsWith(`${deletedPath}/`))) {
      rememberContentPath(projectKey, null);
      handleBackToChat();
    }
  };

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      <ProjectSidebar
        projectKey={projectKey}
        project={project}
        activeSessionId={activeSessionId}
        selectedAgentId={selectedAgent?.id ?? null}
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
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <p>点击 Agent 开始新对话，或选择已有会话</p>
          </div>
        )}
      </main>
    </div>
  );
}
