import { useState, useEffect } from "react";
import { ProjectBar } from "./components/ProjectBar";
import { EmptyState } from "./components/EmptyState";
import { ProjectPage } from "./pages/ProjectPage";
import { initAppContext } from "./lib/context";
import type { AppContext } from "./lib/context";

interface ProjectState {
  name: string;
  port: number;
  ctx: AppContext;
}

export function App() {
  const [projects, setProjects] = useState<Map<string, ProjectState>>(new Map());
  const [activePath, setActivePath] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    (async () => {
      const restored = await window.electronAPI.restoreProjects();
      const map = new Map<string, ProjectState>();
      for (const { path, name, port } of restored) {
        map.set(path, { name, port, ctx: initAppContext(port, path) });
      }
      setProjects(map);
      const lastActive = await window.electronAPI.getLastActiveProject();
      setActivePath(lastActive && map.has(lastActive) ? lastActive : (restored.length > 0 ? restored[0].path : null));
      setInitializing(false);
    })();
  }, []);

  useEffect(() => {
    if (activePath) {
      window.electronAPI.setLastActiveProject(activePath);
    }
  }, [activePath]);

  const handleAddProject = async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (!dir) return;
    if (projects.has(dir)) {
      setActivePath(dir);
      return;
    }
    const port = await window.electronAPI.startServer(dir);
    const name = dir.split("/").pop() || dir;
    setProjects(
      (prev) => new Map(prev).set(dir, { name, port, ctx: initAppContext(port, dir) }),
    );
    setActivePath(dir);
  };

  const handleCloseProject = async (path: string) => {
    await window.electronAPI.closeProject(path);
    let nextActive = activePath;
    setProjects((prev) => {
      const next = new Map(prev);
      next.delete(path);
      if (activePath === path) {
        const remaining = [...next.keys()];
        nextActive = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }
      return next;
    });
    if (activePath === path) setActivePath(nextActive);
  };

  const handleReveal = (path: string) => {
    window.electronAPI.revealInFinder(path);
  };

  if (initializing) {
    return (
      <div className="flex items-center justify-center h-screen bg-base text-[var(--muted)]">
        加载中...
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <ProjectBar
        projects={projects}
        activePath={activePath}
        onSelect={setActivePath}
        onAdd={handleAddProject}
        onClose={handleCloseProject}
        onReveal={handleReveal}
      />
      {activePath && projects.has(activePath) ? (
        <ProjectPage key={activePath} ctx={projects.get(activePath)!.ctx} />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}
