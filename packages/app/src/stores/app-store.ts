import { create } from "zustand";
import { initAppContext, type AppContext } from "../lib/context";
import { getLastRoute, setLastRoute } from "../lib/localstorage/last-route";

export interface ProjectState {
  id: string;
  path: string;
  name: string;
  ctx: AppContext;
  lastRoute?: string;
  lastOpened: string;
}

interface AppStore {
  projects: Map<string, ProjectState>;
  activeProjectId: string | null;
  initializing: boolean;
  restoreProjects: () => Promise<string | null>;
  openProject: () => Promise<string | null>;
  closeProject: (projectId: string) => Promise<string | null>;
  revealProject: (projectId: string) => Promise<void>;
  setActiveProject: (projectId: string | null) => Promise<void>;
  setProjectLastRoute: (projectId: string, route: string) => Promise<void>;
}

function findProjectIdByPath(projects: Map<string, ProjectState>, projectPath: string): string | null {
  for (const project of projects.values()) {
    if (project.path === projectPath) return project.id;
  }
  return null;
}

export const useAppStore = create<AppStore>((set, get) => ({
  projects: new Map(),
  activeProjectId: null,
  initializing: true,

  async restoreProjects() {
    set({ initializing: true });
    const port = await window.electronAPI.getServerPort();
    const baseUrl = `http://localhost:${port}`;
    const restored = await window.electronAPI.restoreProjects();
    const projects = new Map<string, ProjectState>();

    for (const { id, path, name, lastOpened } of restored) {
      projects.set(id, {
        id,
        path,
        name,
        ctx: initAppContext(baseUrl, id, path),
        lastRoute: getLastRoute(id) ?? undefined,
        lastOpened,
      });
    }

    const lastActiveId = await window.electronAPI.getLastActiveProject();
    const fallbackId = projects.keys().next().value ?? null;
    const nextActiveId = lastActiveId && projects.has(lastActiveId) ? lastActiveId : fallbackId;
    set({ projects, activeProjectId: nextActiveId, initializing: false });
    return nextActiveId;
  },

  async openProject() {
    const dir = await window.electronAPI.selectDirectory();
    if (!dir) return null;

    const existing = findProjectIdByPath(get().projects, dir);
    if (existing) {
      await get().setActiveProject(existing);
      return existing;
    }

    const { projectId } = await window.electronAPI.openProject(dir);
    const port = await window.electronAPI.getServerPort();
    const baseUrl = `http://localhost:${port}`;
    const name = dir.split(/[\\/]/).filter(Boolean).pop() || dir;
    const projects = new Map(get().projects);
    projects.set(projectId, {
      id: projectId,
      path: dir,
      name,
      ctx: initAppContext(baseUrl, projectId, dir),
      lastOpened: new Date().toISOString(),
    });
    set({ projects, activeProjectId: projectId });
    await window.electronAPI.addOpenProject(projectId, dir);
    await window.electronAPI.setLastActiveProject(projectId);
    return projectId;
  },

  async closeProject(projectId) {
    const project = get().projects.get(projectId);
    if (!project) return get().activeProjectId;

    await window.electronAPI.closeProject(projectId);

    let nextActiveId: string | null = get().activeProjectId;
    set((state) => {
      const projects = new Map(state.projects);
      projects.delete(projectId);

      if (state.activeProjectId === projectId) {
        const remaining = [...projects.keys()];
        nextActiveId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }

      return {
        projects,
        activeProjectId: nextActiveId,
      };
    });

    if (nextActiveId) {
      await window.electronAPI.setLastActiveProject(nextActiveId);
    }

    return nextActiveId;
  },

  async revealProject(projectId) {
    const project = get().projects.get(projectId);
    if (!project) return;
    await window.electronAPI.revealInFinder(project.path);
  },

  async setActiveProject(projectId) {
    const project = projectId ? get().projects.get(projectId) : null;
    set({ activeProjectId: project ? projectId : null });
    if (project) {
      await window.electronAPI.setLastActiveProject(projectId);
    }
  },

  async setProjectLastRoute(projectId, route) {
    const project = get().projects.get(projectId);
    if (!project || project.lastRoute === route) return;

    set((state) => {
      const current = state.projects.get(projectId);
      if (!current || current.lastRoute === route) return {};
      const projects = new Map(state.projects);
      projects.set(projectId, { ...current, lastRoute: route });
      return { projects };
    });

    setLastRoute(projectId, route);
  },
}));
