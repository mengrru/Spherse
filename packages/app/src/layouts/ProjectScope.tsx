import { useEffect } from "react";
import { Outlet, useLocation, useParams } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { SidePanel } from "../features/side-panel";
import { TabBar } from "../features/tabs";
import { SplitLayout } from "../features/split-pane";
import { GlobalSearchDialog } from "../features/global-search";
import { useCustomTheme } from "../hooks/useCustomTheme";
import { useAgentBusRefresh } from "../hooks/useAgentBusRefresh";
import { useSidePanel } from "../hooks/use-side-panel";
import { useAppStore } from "../stores/app-store";
import { useAppUiStore } from "../stores/app-ui-store";
import { useProjectNavHistory } from "../lib/use-project-navigation";
import { stripMessageId } from "../lib/route-params";
import { ProjectProvider } from "../context/project-context";
import { useHostBridge } from "../context/host-bridge-context";
import { useApiClient } from "../lib/use-connection";
import { useConnection } from "../lib/use-connection";
import { ProjectRuntimeBridges } from "./ProjectRuntimeBridges";

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
  const globalSearchOpen = useAppUiStore((s) => s.globalSearchOpen);
  const setGlobalSearchOpen = useAppUiStore((s) => s.setGlobalSearchOpen);
  const { clickAwayProps } = useSidePanel();
  useCustomTheme(
    project?.path,
    connection.baseUrl,
    projectId,
    connection.accessToken,
  );
  useProjectNavHistory(projectId ?? "");
  useAgentBusRefresh(projectId, client);
  useEffect(() => {
    if (projectId) void setActiveProject(bridge, projectId);
  }, [projectId, setActiveProject, bridge]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "p"
      ) {
        event.preventDefault();
        setGlobalSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      setGlobalSearchOpen(false);
    };
  }, [setGlobalSearchOpen]);

  useEffect(() => {
    if (!projectId) return;
    const fullPath = stripMessageId(location.pathname, location.search);
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
          <SplitLayout>
            <TabBar />
            {/* 页面根用 h-full；若直接与 TabBar 并列，内容较长时 flex 的 min-height: auto 会阻止收缩，页面被撑出一个标签栏高度、底部被裁。
                包一层 flex-1 min-h-0 容器，让 h-full 解析为标签栏下方的剩余高度 */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <Outlet />
            </div>
          </SplitLayout>
        </main>
        {globalSearchOpen && <GlobalSearchDialog />}
        <ProjectRuntimeBridges />
      </div>
    </ProjectProvider>
  );
}
