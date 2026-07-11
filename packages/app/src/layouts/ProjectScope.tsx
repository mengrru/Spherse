import { useEffect, useRef } from "react";
import { Outlet, useLocation, useParams } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { ProjectPanel } from "../features/project-panel";
import { FloatingChatManager } from "../features/floating-chat";
import { TriggerEventBridge } from "../features/agent-trigger";
import { useCustomTheme } from "../hooks/useCustomTheme";
import { useSidePanel } from "../hooks/use-side-panel";
import { useSpherseMessageListener } from "../ui-sdk";
import { useProjectDataStore } from "../stores/project-data-store";
import { useAppStore } from "../stores/app-store";
import { useProjectNavHistory } from "../lib/use-project-navigation";
import { ProjectProvider } from "../context/project-context";

export function ProjectScope() {
  const { projectId } = useParams();
  const location = useLocation();
  const { t } = useI18n();
  const project = useAppStore((s) => (projectId ? s.projects.get(projectId) : undefined));
  const client = project?.ctx.client;
  const initializing = useAppStore((s) => s.initializing);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const setProjectLastRoute = useAppStore((s) => s.setProjectLastRoute);
  const { clickAwayProps } = useSidePanel();
  const refreshAgents = useProjectDataStore((s) => s.refreshAgents);
  const refreshSessions = useProjectDataStore((s) => s.refreshSessions);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useCustomTheme(
    project?.ctx.projectRoot ?? "",
    project?.ctx.baseUrl ?? "",
    project?.ctx.projectId ?? "",
  );
  useProjectNavHistory(projectId ?? "");
  useSpherseMessageListener(projectId ?? "", client);

  useEffect(() => {
    if (projectId) void setActiveProject(projectId);
  }, [projectId, setActiveProject]);

  useEffect(() => {
    if (!projectId) return;
    const fullPath = location.pathname + location.search;
    const prefix = `/project/${projectId}`;
    const subRoute = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) || "/" : "/";
    void setProjectLastRoute(projectId, subRoute);
  }, [location.pathname, location.search, projectId, setProjectLastRoute]);

  useEffect(() => {
    if (!projectId || !client) return;
    const cached = useProjectDataStore.getState().projects[projectId];
    if (cached?.agents?.length) return;
    void refreshAgents(projectId, client).then(() => {
      void refreshSessions(projectId, client);
    });
  }, [client, projectId, refreshAgents, refreshSessions]);

  if (!projectId || !project) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-muted-foreground">
        {initializing ? t("common.loading") : t("pages.projectNotFound")}
      </div>
    );
  }

  return (
    <ProjectProvider projectId={projectId} ctx={project.ctx}>
      <div className="relative flex h-full flex-1 overflow-hidden">
        <ProjectPanel />
        <main
          className="flex-1 overflow-hidden flex flex-col"
          {...clickAwayProps}
        >
          <Outlet />
        </main>
        <FloatingChatManager />
        <TriggerEventBridge />
      </div>
    </ProjectProvider>
  );
}
