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

function buildProjectRoute(projectKey: string, lastRoute?: string): string {
  const suffix = lastRoute?.startsWith("/") ? lastRoute : "";
  return `/project/${projectKey}${suffix}`;
}

export function App() {
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const projects = useAppStore((state) => state.projects);
  const activeProjectKey = useAppStore((state) => state.activeProjectKey);
  const initializing = useAppStore((state) => state.initializing);
  const restoreProjects = useAppStore((state) => state.restoreProjects);
  const openProject = useAppStore((state) => state.openProject);
  const closeProject = useAppStore((state) => state.closeProject);
  const revealProject = useAppStore((state) => state.revealProject);
  const setActiveProject = useAppStore((state) => state.setActiveProject);
  const clearProjectData = useProjectDataStore((state) => state.clearProjectData);
  const clearProjectUi = useProjectUiStore((state) => state.clearProjectUi);
  const locale = useSettingsStore((state) => state.locale);

  useEffect(() => {
    let cancelled = false;
    restoreProjects().then((projectKey) => {
      const hashPath = window.location.hash.replace(/^#/, "") || "/";
      if (!cancelled && hashPath === "/" && projectKey) {
        const project = useAppStore.getState().projects.get(projectKey);
        navigate(buildProjectRoute(projectKey, project?.lastRoute), { replace: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, restoreProjects]);

  const handleAddProject = async () => {
    const projectKey = await openProject();
    if (projectKey) {
      const project = useAppStore.getState().projects.get(projectKey);
      navigate(buildProjectRoute(projectKey, project?.lastRoute));
    }
  };

  const handleSelectProject = async (projectKey: string) => {
    await setActiveProject(projectKey);
    const project = useAppStore.getState().projects.get(projectKey);
    navigate(buildProjectRoute(projectKey, project?.lastRoute));
  };

  const handleCloseProject = async (projectKey: string) => {
    const nextProjectKey = await closeProject(projectKey);
    clearProjectData(projectKey);
    clearProjectUi(projectKey);
    if (nextProjectKey) {
      const project = useAppStore.getState().projects.get(nextProjectKey);
      navigate(buildProjectRoute(nextProjectKey, project?.lastRoute));
    } else {
      navigate("/");
    }
  };

  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        {translate("zh-CN", "app.loading")}
      </div>
    );
  }

  return (
    <I18nProvider locale={locale ?? DEFAULT_LOCALE}>
      <TooltipProvider>
        <div className="flex h-screen bg-background text-foreground">
          <ActivityBar
            projects={projects}
            activeProjectKey={activeProjectKey}
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
