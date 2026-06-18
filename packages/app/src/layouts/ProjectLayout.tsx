import { useEffect } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import { ContentBrowser } from "../features/content-browser";
import { Chat } from "../features/chat";
import { ProjectPanel } from "../features/project-panel";
import { useCustomTheme } from "../hooks/useCustomTheme";
import { useSidePanel } from "../hooks/useSidePanel";
import { useSpherseMessageListener } from "../ui-sdk";
import { WelcomePage } from "../features/welcome-page";
import { FloatingChatManager } from "../features/floating-chat";
import type { ProjectState } from "../stores/app-store";
import { useAppStore } from "../stores/app-store";
import { useProjectDataStore } from "../stores/project-data-store";
import { useFloatingChatRedirect } from "../features/floating-chat/use-floating-chat-redirect";
import { useFloatingSessionId } from "../features/floating-chat/use-floating-session-id";
import { ProjectProvider } from "../lib/project-context";

export interface ProjectLayoutProps {
  projectId: string;
  project: ProjectState;
}

function buildContentUrl(projectId: string, filePath: string, sessionId?: string | null): string {
  const params = new URLSearchParams({ path: filePath });
  if (sessionId) params.set("sessionId", sessionId);
  return `/project/${projectId}/content?${params.toString()}`;
}

export function ProjectLayout({ projectId, project }: ProjectLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const { t } = useI18n();
  const setActiveProject = useAppStore((state) => state.setActiveProject);
  const setProjectLastRoute = useAppStore((state) => state.setProjectLastRoute);
  const { clickAwayProps } = useSidePanel();
  const projectData = useProjectDataStore((state) => state.projects[projectId]);
  const refreshAgents = useProjectDataStore((state) => state.refreshAgents);
  const refreshSessions = useProjectDataStore((state) => state.refreshSessions);
  const createSession = useProjectDataStore((state) => state.createSession);
  const consumeInitialMessage = useProjectDataStore((state) => state.consumeInitialMessage);
  const handleScheduleEvent = useProjectDataStore((state) => state.handleScheduleEvent);

  const agents = projectData?.agents ?? [];
  const contentPath = searchParams.get("path");
  const contentSessionId = searchParams.get("sessionId");
  const isContentRoute = location.pathname.endsWith("/content");
  const showingContent = isContentRoute && Boolean(contentPath);
  const activeSessionId = sessionId ?? contentSessionId ?? null;
  const floatingSessionId = useFloatingSessionId(projectId);
  const resolveSessionViews = useProjectDataStore((s) => s.resolveSessionViews);
  const { selectedSession, selectedAgent, activeSessions } = resolveSessionViews(
    projectId, activeSessionId, floatingSessionId,
  );
  const initialMessage = selectedSession
    ? projectData?.initialMessageBySessionId[selectedSession.id]
    : undefined;

  useCustomTheme(project.ctx.projectRoot, project.ctx.baseUrl, project.ctx.projectId);
  useSpherseMessageListener(projectId, project.ctx.client);

  useEffect(() => {
    void setActiveProject(projectId);
  }, [projectId, setActiveProject]);

  useEffect(() => {
    const fullPath = location.pathname + location.search;
    const prefix = `/project/${projectId}`;
    const subRoute = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : "";
    void setProjectLastRoute(projectId, subRoute);
  }, [location.pathname, location.search, projectId, setProjectLastRoute]);

  useEffect(() => {
    void refreshAgents(projectId, project.ctx.client).then(() => {
      void refreshSessions(projectId, project.ctx.client);
    });
  }, [project.ctx.client, projectId, refreshAgents, refreshSessions]);

  useEffect(() => {
    async function showScheduleNotification(agentId: string, scheduleId: string) {
      const cachedSchedules = useProjectDataStore.getState().projects[projectId]?.schedulesByAgent?.[agentId] ?? [];
      let schedule = cachedSchedules.find((item) => item.id === scheduleId);
      if (!schedule) {
        const schedules = await project.ctx.client.listSchedules(agentId).catch(() => []);
        schedule = schedules.find((item) => item.id === scheduleId);
      }
      if (!schedule?.notify) return;
      toast.success(schedule.notificationMessage?.trim() || t("agent-schedule.notificationDefault"));
    }

    const ws = project.ctx.client.createScheduleWebSocket((event) => {
      handleScheduleEvent(projectId, project.ctx.client, event);
      if (event.type === "schedule_completed") {
        void showScheduleNotification(event.agentId, event.scheduleId);
      }
    });
    return () => ws.close();
  }, [handleScheduleEvent, project.ctx.client, projectId, t]);

  useEffect(() => {
    if (initialMessage && selectedSession && selectedAgent) {
      consumeInitialMessage(projectId, selectedSession.id);
    }
  }, [consumeInitialMessage, initialMessage, projectId, selectedAgent, selectedSession]);

  useFloatingChatRedirect(projectId, activeSessionId);

  const handleSelectFile = (filePath: string) => {
    navigate(buildContentUrl(projectId, filePath, activeSessionId));
  };

  const handleBackToChat = () => {
    if (activeSessionId) {
      navigate(`/project/${projectId}/chat/${activeSessionId}`);
    } else {
      navigate(`/project/${projectId}`);
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
    const session = await createSession(projectId, project.ctx.client, agentId, message);
    if (session) {
      navigate(`/project/${projectId}/chat/${session.id}`);
    }
  };

  const handleFileDeleted = (deletedPath: string) => {
    if (contentPath && (contentPath === deletedPath || contentPath.startsWith(`${deletedPath}/`))) {
      handleBackToChat();
    }
  };

  return (
    <ProjectProvider projectId={projectId} ctx={project.ctx}>
      <div className="relative flex h-full flex-1 overflow-hidden">
        <ProjectPanel
          projectId={projectId}
          project={project}
          activeSessionId={activeSessionId}
          selectedAgentId={selectedAgent?.id ?? null}
          selectedFilePath={showingContent ? contentPath ?? undefined : undefined}
          onSelectFile={handleSelectFile}
          onFileDeleted={handleFileDeleted}
        />
        <main
          className="flex-1 overflow-hidden flex flex-col"
          {...clickAwayProps}
        >
          {selectedSession && selectedAgent && (
            <div className={!showingContent ? "contents" : "hidden"}>
              <Chat
                key={selectedSession.id}
                client={project.ctx.client}
                sessionId={selectedSession.id}
                baseUrl={project.ctx.baseUrl}
                projectId={project.ctx.projectId}
                agent={selectedAgent}
                onNavigateToPath={handleSelectFile}
                initialMessage={initialMessage}
                onClose={() => navigate(`/project/${projectId}`)}
              />
            </div>
          )}
          {showingContent && contentPath && (
            <ContentBrowser
              key={contentPath}
              client={project.ctx.client}
              filePath={contentPath}
              onBack={handleBackToChat}
              agents={agents}
              projectId={projectId}
              activeSessions={activeSessions}
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
        <FloatingChatManager />
      </div>
    </ProjectProvider>
  );
}
