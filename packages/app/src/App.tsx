import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { ActivityBar } from "./features/activity-bar";
import { SettingsModal } from "./features/settings";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";
import { useAppStore } from "./stores/app-store";
import { useProjectDataStore } from "./stores/project-data-store";
import { useProjectUiStore } from "./stores/project-ui-store";
import { I18nProvider } from "@spherse/i18n/react";
import { DEFAULT_LOCALE, translate } from "@spherse/i18n";
import { useSettingsStore } from "./features/settings/store";

function buildProjectRoute(projectId: string, lastRoute?: string): string {
  const suffix = lastRoute?.startsWith("/") ? lastRoute : "";
  return `/project/${projectId}${suffix}`;
}

export function App() {
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const projects = useAppStore((state) => state.projects);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const initializing = useAppStore((state) => state.initializing);
  const restoreProjects = useAppStore((state) => state.restoreProjects);
  const openProject = useAppStore((state) => state.openProject);
  const closeProject = useAppStore((state) => state.closeProject);
  const revealProject = useAppStore((state) => state.revealProject);
  const setActiveProject = useAppStore((state) => state.setActiveProject);
  const clearProjectData = useProjectDataStore((state) => state.clearProjectData);
  const clearProjectUi = useProjectUiStore((state) => state.clearProjectUi);
  const locale = useSettingsStore((state) => state.locale);
  const loadSettings = useSettingsStore((state) => state.load);

  useEffect(() => {
    let cancelled = false;
    restoreProjects().then((projectId) => {
      const hashPath = window.location.hash.replace(/^#/, "") || "/";
      if (!cancelled && hashPath === "/" && projectId) {
        const project = useAppStore.getState().projects.get(projectId);
        navigate(buildProjectRoute(projectId, project?.lastRoute), { replace: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, restoreProjects]);

  useEffect(() => {
    const api = (window as unknown as { electronAPI: import("./features/settings/types").SettingsApi }).electronAPI;
    if (api) void loadSettings(api);
  }, [loadSettings]);

  const handleAddProject = async () => {
    const projectId = await openProject();
    if (projectId) {
      const project = useAppStore.getState().projects.get(projectId);
      navigate(buildProjectRoute(projectId, project?.lastRoute));
    }
  };

  const handleSelectProject = async (projectId: string) => {
    await setActiveProject(projectId);
    const project = useAppStore.getState().projects.get(projectId);
    navigate(buildProjectRoute(projectId, project?.lastRoute));
  };

  const handleCloseProject = async (projectId: string) => {
    const nextProjectId = await closeProject(projectId);
    clearProjectData(projectId);
    clearProjectUi(projectId);
    if (nextProjectId) {
      const project = useAppStore.getState().projects.get(nextProjectId);
      navigate(buildProjectRoute(nextProjectId, project?.lastRoute));
    } else {
      navigate("/");
    }
  };

  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        {translate(locale ?? DEFAULT_LOCALE, "app.loading")}
      </div>
    );
  }

  return (
    <I18nProvider locale={locale ?? DEFAULT_LOCALE}>
      <TooltipProvider>
        <div className="relative flex h-screen overflow-hidden bg-background text-foreground">
          <ActivityBar
            projects={projects}
            activeProjectId={activeProjectId}
            onSelect={handleSelectProject}
            onAdd={handleAddProject}
            onClose={handleCloseProject}
            onReveal={revealProject}
            onSettings={() => setShowSettings(true)}
          />
          <Outlet />
          {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
          <Toaster />
        </div>
      </TooltipProvider>
    </I18nProvider>
  );
}
