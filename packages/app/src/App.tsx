import { useEffect } from "react";
import { Outlet, useMatch, useNavigate } from "react-router";
import { ActivityBar } from "./features/activity-bar";
import { buildProjectRoute } from "./features/activity-bar/use-project-actions";
import { SettingsModal } from "./features/settings";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";
import { useAppStore } from "./stores/app-store";
import { useAppUiStore } from "./stores/app-ui-store";
import { useHostBridge } from "./context/host-bridge-context";
import { useFeature } from "./lib/use-feature";
import { I18nProvider } from "@spherse/i18n/react";
import { DEFAULT_LOCALE, translate } from "@spherse/i18n";
import { useSettingsStore } from "./stores/settings-store";
import { useBusStore } from "./stores/bus-store";

export function App() {
  const navigate = useNavigate();
  const bridge = useHostBridge();
  const settingsEnabled = useFeature("settings");
  const initializing = useAppStore((state) => state.initializing);
  const restoreProjects = useAppStore((state) => state.restoreProjects);
  const settingsModalOpen = useAppUiStore((state) => state.settingsModalOpen);
  const setSettingsModalOpen = useAppUiStore((state) => state.setSettingsModalOpen);
  const locale = useSettingsStore((state) => state.locale);
  const loadSettings = useSettingsStore((state) => state.loadLocale);
  const inProject = useMatch("/project/:projectId/*") !== null;

  useEffect(() => {
    let cancelled = false;
    restoreProjects(bridge).then((projectId) => {
      if (cancelled || !projectId) return;
      // Only auto-navigate when starting from the root path; if the URL already
      // points to a specific route (deep link, E2E direct entry), respect it.
      const hash = window.location.hash.replace(/^#/, "") || "/";
      if (hash !== "/") return;
      const project = useAppStore.getState().projects.get(projectId);
      navigate(buildProjectRoute(projectId, project?.lastRoute), { replace: true });
    });
    void useBusStore.getState().init(bridge);
    return () => {
      cancelled = true;
    };
  }, [navigate, restoreProjects, bridge]);

  useEffect(() => {
    void loadSettings(bridge);
  }, [loadSettings, bridge]);

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
          <>
            {!inProject && bridge.kind !== "web" && <ActivityBar />}
            <Outlet />
            {settingsModalOpen && settingsEnabled && (
              <SettingsModal onClose={() => setSettingsModalOpen(false)} />
            )}
          </>
          <Toaster />
        </div>
      </TooltipProvider>
    </I18nProvider>
  );
}
