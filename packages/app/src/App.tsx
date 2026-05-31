import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { ProjectBar } from "./components/ProjectBar";
import { SettingsModal } from "./components/SettingsModal";
import { TooltipProvider } from "./components/ui/tooltip";
import { useAppStore } from "./stores/app-store";
import { useProjectWorkspaceStore } from "./stores/project-workspace-store";

export function App() {
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const {
    projects,
    activeProjectKey,
    initializing,
    restoreProjects,
    openProject,
    closeProject,
    revealProject,
    setActiveProject,
  } = useAppStore();
  const clearProject = useProjectWorkspaceStore((state) => state.clearProject);

  useEffect(() => {
    let cancelled = false;
    restoreProjects().then((projectKey) => {
      const hashPath = window.location.hash.replace(/^#/, "") || "/";
      if (!cancelled && hashPath === "/" && projectKey) {
        navigate(`/project/${projectKey}`, { replace: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, restoreProjects]);

  const handleAddProject = async () => {
    const projectKey = await openProject();
    if (projectKey) {
      navigate(`/project/${projectKey}`);
    }
  };

  const handleSelectProject = async (projectKey: string) => {
    await setActiveProject(projectKey);
    navigate(`/project/${projectKey}`);
  };

  const handleCloseProject = async (projectKey: string) => {
    const nextProjectKey = await closeProject(projectKey);
    clearProject(projectKey);
    if (nextProjectKey) {
      navigate(`/project/${nextProjectKey}`);
    } else {
      navigate("/");
    }
  };

  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        加载中...
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background text-foreground">
        <ProjectBar
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
      </div>
    </TooltipProvider>
  );
}
