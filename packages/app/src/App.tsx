import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { ActivityBar } from "./features/activity-bar";
import { SettingsModal } from "./features/settings";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";
import { useAppStore } from "./stores/app-store";
import { useProjectDataStore } from "./stores/project-data-store";
import { clearLastRoute } from "./lib/localstorage/last-route";
import { useAgentSessionListUiStore } from "./features/agent-session-list/store";
import { useScheduleStore } from "./features/agent-schedule/store";
import { useFloatingChatStore } from "./features/floating-chat/store";
import { I18nProvider } from "@spherse/i18n/react";
import { DEFAULT_LOCALE, translate } from "@spherse/i18n";
import { useSettingsStore } from "./stores/settings-store";
import { useBusStore } from "./stores/bus-store";

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
  const clearAgentSessionListUi = useAgentSessionListUiStore((state) => state.clearProject);
  const clearScheduleData = useScheduleStore((state) => state.clearProject);
  const clearFloatingChat = useFloatingChatStore((state) => state.clearProject);
  const locale = useSettingsStore((state) => state.locale);
  const loadSettings = useSettingsStore((state) => state.loadLocale);

  useEffect(() => {
    let cancelled = false;
    restoreProjects().then((projectId) => {
      if (cancelled || !projectId) return;
      // Only auto-navigate when starting from the root path; if the URL already
      // points to a specific route (deep link, E2E direct entry), respect it.
      const hash = window.location.hash.replace(/^#/, "") || "/";
      if (hash !== "/") return;
      const project = useAppStore.getState().projects.get(projectId);
      navigate(buildProjectRoute(projectId, project?.lastRoute), { replace: true });
    });
    void useBusStore.getState().init();
    return () => {
      cancelled = true;
    };
  }, [navigate, restoreProjects]);

  useEffect(() => {
    void loadSettings(window.electronAPI);
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
    clearAgentSessionListUi(projectId);
    clearScheduleData(projectId);
    clearFloatingChat(projectId);
    clearLastRoute(projectId);
    if (nextProjectId) {
      const project = useAppStore.getState().projects.get(nextProjectId);
      navigate(buildProjectRoute(nextProjectId, project?.lastRoute));
    } else {
      navigate("/");
    }
  };

  if (initializing) {
    return (
      <div data-app-root className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        {translate(locale ?? DEFAULT_LOCALE, "app.loading")}
      </div>
    );
  }

  return (
    <I18nProvider locale={locale ?? DEFAULT_LOCALE}>
      <TooltipProvider>
        <div data-app-root className="relative flex h-screen overflow-hidden bg-background text-foreground">
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
