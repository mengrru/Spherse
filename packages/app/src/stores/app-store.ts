import { create } from "zustand";
import { initAppContext, type AppContext } from "../lib/context";
import { createProjectKey } from "../lib/project-key";

export interface ProjectState {
  key: string;
  path: string;
  name: string;
  port: number;
  ctx: AppContext;
}

interface AppStore {
  projects: Map<string, ProjectState>;
  activeProjectKey: string | null;
  initializing: boolean;
  restoreProjects: () => Promise<string | null>;
  openProject: () => Promise<string | null>;
  closeProject: (projectKey: string) => Promise<string | null>;
  revealProject: (projectKey: string) => Promise<void>;
  setActiveProject: (projectKey: string | null) => Promise<void>;
}

function findProjectKeyByPath(projects: Map<string, ProjectState>, projectPath: string): string | null {
  for (const project of projects.values()) {
    if (project.path === projectPath) return project.key;
  }
  return null;
}

export const useAppStore = create<AppStore>((set, get) => ({
  projects: new Map(),
  activeProjectKey: null,
  initializing: true,

  async restoreProjects() {
    set({ initializing: true });
    const restored = await window.electronAPI.restoreProjects();
    const projects = new Map<string, ProjectState>();

    for (const { path, name, port } of restored) {
      const key = createProjectKey(path, projects.keys());
      projects.set(key, {
        key,
        path,
        name,
        port,
        ctx: initAppContext(port, path),
      });
    }

    const lastActivePath = await window.electronAPI.getLastActiveProject();
    const activeProjectKey =
      lastActivePath ? findProjectKeyByPath(projects, lastActivePath) : null;
    const fallbackKey = projects.keys().next().value ?? null;
    const nextActiveKey = activeProjectKey ?? fallbackKey;
    set({
      projects,
      activeProjectKey: nextActiveKey,
      initializing: false,
    });
    return nextActiveKey;
  },

  async openProject() {
    const dir = await window.electronAPI.selectDirectory();
    if (!dir) return null;

    const existingKey = findProjectKeyByPath(get().projects, dir);
    if (existingKey) {
      await get().setActiveProject(existingKey);
      return existingKey;
    }

    const port = await window.electronAPI.startServer(dir);
    const name = dir.split(/[\\/]/).filter(Boolean).pop() || dir;
    let key = "";
    set((state) => {
      const projects = new Map(state.projects);
      key = createProjectKey(dir, projects.keys());
      projects.set(key, {
        key,
        path: dir,
        name,
        port,
        ctx: initAppContext(port, dir),
      });
      return { projects, activeProjectKey: key };
    });
    await window.electronAPI.addOpenProject(dir);
    await window.electronAPI.setLastActiveProject(dir);
    return key;
  },

  async closeProject(projectKey) {
    const project = get().projects.get(projectKey);
    if (!project) return get().activeProjectKey;

    await window.electronAPI.closeProject(project.path);

    let nextActiveKey: string | null = get().activeProjectKey;
    set((state) => {
      const projects = new Map(state.projects);
      projects.delete(projectKey);

      if (state.activeProjectKey === projectKey) {
        const remaining = [...projects.keys()];
        nextActiveKey = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }

      return {
        projects,
        activeProjectKey: nextActiveKey,
      };
    });

    if (nextActiveKey) {
      const nextProject = get().projects.get(nextActiveKey);
      if (nextProject) {
        await window.electronAPI.setLastActiveProject(nextProject.path);
      }
    }

    return nextActiveKey;
  },

  async revealProject(projectKey) {
    const project = get().projects.get(projectKey);
    if (!project) return;
    await window.electronAPI.revealInFinder(project.path);
  },

  async setActiveProject(projectKey) {
    const project = projectKey ? get().projects.get(projectKey) : null;
    set({ activeProjectKey: project ? projectKey : null });
    if (project) {
      await window.electronAPI.setLastActiveProject(project.path);
    }
  },
}));
