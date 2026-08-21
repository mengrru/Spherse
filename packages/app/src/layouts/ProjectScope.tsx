import { useEffect, useRef } from "react";
import { Outlet, useLocation, useParams } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { SidePanel } from "../features/side-panel";
import { FloatingChatManager } from "../features/floating-chat";
import { FloatingContentBrowserManager } from "../features/floating-content-browser";
import { BrowserManager } from "../features/browser";
import { TriggerEventBridge } from "../features/agent-trigger";
import { FeatureGate } from "../components/FeatureGate";
import { useCustomTheme } from "../hooks/useCustomTheme";
import { useAgentBusRefresh } from "../hooks/useAgentBusRefresh";
import { useSidePanel } from "../hooks/use-side-panel";
import { UiSdkBridge } from "../ui-sdk";
import { useAppStore } from "../stores/app-store";
import { useProjectNavHistory } from "../lib/use-project-navigation";
import { ProjectProvider } from "../context/project-context";
import { useHostBridge } from "../context/host-bridge-context";
import { useApiClient } from "../lib/use-connection";
import { useConnection } from "../lib/use-connection";
import { useProjectCatalog } from "../lib/project-queries";

export function ProjectScope() {
  const { projectId } = useParams();
  const location = useLocation();
  const { t } = useI18n();
  const bridge = useHostBridge();
  const project = useAppStore((s) => (projectId ? s.projects.get(projectId) : undefined));
  const client = useApiClient(projectId);
  const connection = useConnection();
  const initializing = useAppStore((s) => s.initializing);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const setProjectLastRoute = useAppStore((s) => s.setProjectLastRoute);
  const { clickAwayProps } = useSidePanel();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useCustomTheme(
    project?.path,
    connection.baseUrl,
    projectId,
    connection.accessToken,
  );
  useProjectNavHistory(projectId ?? "");
  useAgentBusRefresh(projectId, client);
  useProjectCatalog(projectId ?? "", client);

  useEffect(() => {
    if (projectId) void setActiveProject(bridge, projectId);
  }, [projectId, setActiveProject, bridge]);

  useEffect(() => {
    if (!projectId) return;
    const fullPath = location.pathname + location.search;
    const prefix = `/project/${projectId}`;
    const subRoute = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) || "/" : "/";
    void setProjectLastRoute(projectId, subRoute);
  }, [location.pathname, location.search, projectId, setProjectLastRoute]);

  if (!projectId || !project) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-muted-foreground">
        {initializing ? t("common.loading") : t("pages.projectNotFound")}
      </div>
    );
  }

  return (
    <ProjectProvider projectId={projectId} projectRoot={project.path}>
      <div className="relative flex h-full flex-1 overflow-hidden">
        <SidePanel />
        <main
          className="flex-1 overflow-hidden flex flex-col"
          {...clickAwayProps}
        >
          <Outlet />
        </main>
        <FeatureGate feature="floating-chat">
          <FloatingChatManager />
        </FeatureGate>
        <FeatureGate feature="floating-content-browser">
          <FloatingContentBrowserManager />
        </FeatureGate>
        <FeatureGate feature="browser">
          <BrowserManager />
        </FeatureGate>
        <UiSdkBridge />
        <TriggerEventBridge />
      </div>
    </ProjectProvider>
  );
}
