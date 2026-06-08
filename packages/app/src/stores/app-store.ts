import { create } from "zustand";
import { initAppContext, type AppContext } from "../lib/context";
import { createProjectKey } from "../lib/project-key";

export interface ProjectState {
  key: string;
  path: string;
  name: string;
  port: number;
  ctx: AppContext;
  lastRoute?: string;
}

interface AppStore {
  projects: Map<string, ProjectState>;
  activeProjectKey: string | null;
  initializing: boolean;
  sidePanelPinned: boolean;
  sidePanelHovered: boolean;
  restoreProjects: () => Promise<string | null>;
  openProject: () => Promise<string | null>;
  closeProject: (projectKey: string) => Promise<string | null>;
  revealProject: (projectKey: string) => Promise<void>;
  setActiveProject: (projectKey: string | null) => Promise<void>;
  setProjectLastRoute: (projectKey: string, route: string) => Promise<void>;
  setSidePanelPinned: (pinned: boolean) => void;
  toggleSidePanelPinned: () => void;
  showSidePanel: () => void;
  hideSidePanel: () => void;
}

const SIDE_PANEL_PINNED_STORAGE_KEY = "spherse:side-panel:pinned";
const LEGACY_PROJECT_PANEL_PINNED_STORAGE_KEY = "spherse:project-panel:pinned";
let sidePanelHideTimer: ReturnType<typeof setTimeout> | null = null;

function readSidePanelPinned(): boolean {
  if (typeof localStorage === "undefined") return true;
  const stored = localStorage.getItem(SIDE_PANEL_PINNED_STORAGE_KEY);
  if (stored !== null) return stored !== "false";
  const legacyStored = localStorage.getItem(LEGACY_PROJECT_PANEL_PINNED_STORAGE_KEY);
  if (legacyStored !== null) {
    localStorage.setItem(SIDE_PANEL_PINNED_STORAGE_KEY, legacyStored);
    localStorage.removeItem(LEGACY_PROJECT_PANEL_PINNED_STORAGE_KEY);
    return legacyStored !== "false";
  }
  return true;
}

function writeSidePanelPinned(pinned: boolean) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SIDE_PANEL_PINNED_STORAGE_KEY, String(pinned));
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
  sidePanelPinned: readSidePanelPinned(),
  sidePanelHovered: false,

  async restoreProjects() {
    set({ initializing: true });
    const restored = await window.electronAPI.restoreProjects();
    const projects = new Map<string, ProjectState>();

    for (const { path, name, port, lastRoute } of restored) {
      const key = createProjectKey(path, projects.keys());
      projects.set(key, {
        key,
        path,
        name,
        port,
        ctx: initAppContext(port, path),
        lastRoute,
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

  async setProjectLastRoute(projectKey, route) {
    const project = get().projects.get(projectKey);
    if (!project || project.lastRoute === route) return;

    set((state) => {
      const current = state.projects.get(projectKey);
      if (!current || current.lastRoute === route) return {};
      const projects = new Map(state.projects);
      projects.set(projectKey, { ...current, lastRoute: route });
      return { projects };
    });

    await window.electronAPI.setProjectLastRoute(project.path, route);
  },

  setSidePanelPinned(pinned) {
    writeSidePanelPinned(pinned);
    if (sidePanelHideTimer) {
      clearTimeout(sidePanelHideTimer);
      sidePanelHideTimer = null;
    }
    set({
      sidePanelPinned: pinned,
      sidePanelHovered: pinned ? false : get().sidePanelHovered,
    });
  },

  toggleSidePanelPinned() {
    if (get().sidePanelPinned) set({ sidePanelHovered: true });
    get().setSidePanelPinned(!get().sidePanelPinned);
  },

  showSidePanel() {
    if (sidePanelHideTimer) {
      clearTimeout(sidePanelHideTimer);
      sidePanelHideTimer = null;
    }
    set({ sidePanelHovered: true });
  },

  hideSidePanel() {
    if (get().sidePanelPinned) return;
    if (sidePanelHideTimer) clearTimeout(sidePanelHideTimer);
    sidePanelHideTimer = setTimeout(() => {
      set({ sidePanelHovered: false });
      sidePanelHideTimer = null;
    }, 120);
  },
}));
