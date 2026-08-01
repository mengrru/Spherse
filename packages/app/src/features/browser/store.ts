import { create } from "zustand";
import { getDefaultPosition } from "../../components/floating-frame/defaults";
import { FLOAT_DEFAULT_WIDTH, FLOAT_DEFAULT_HEIGHT, CASCADE_STEP, CASCADE_WRAP } from "./defaults";

export interface BrowserWindow {
  url: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface BrowserStore {
  byProject: Record<string, Record<string, BrowserWindow>>;
  openFloat: (projectId: string, url: string) => void;
  closeFloat: (projectId: string, url: string) => void;
  navigateFloat: (projectId: string, oldUrl: string, newUrl: string) => void;
  setPosition: (projectId: string, url: string, pos: { x: number; y: number }) => void;
  setSize: (
    projectId: string,
    url: string,
    size: { width: number; height: number },
    pos: { x: number; y: number },
  ) => void;
  clearProject: (projectId: string) => void;
}

const STORAGE_KEY = "spherse:floating-browser";

function loadFromStorage(): Record<string, Record<string, BrowserWindow>> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Record<string, BrowserWindow>>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persist(byProject: Record<string, Record<string, BrowserWindow>>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byProject));
  } catch {
    // storage full or unavailable — non-fatal
  }
}

function nextCascadeOffset(count: number): number {
  return (count % CASCADE_WRAP) * CASCADE_STEP;
}

export const useBrowserStore = create<BrowserStore>((set, get) => ({
  byProject: loadFromStorage(),

  openFloat(projectId, url) {
    const existing = get().byProject[projectId];
    if (existing && existing[url]) return;
    const count = existing ? Object.keys(existing).length : 0;
    const window: BrowserWindow = {
      url,
      position: getDefaultPosition(FLOAT_DEFAULT_WIDTH, FLOAT_DEFAULT_HEIGHT, nextCascadeOffset(count)),
      size: { width: FLOAT_DEFAULT_WIDTH, height: FLOAT_DEFAULT_HEIGHT },
    };
    set((s) => {
      const projectWindows = { ...(s.byProject[projectId] ?? {}) };
      projectWindows[url] = window;
      const byProject = { ...s.byProject, [projectId]: projectWindows };
      persist(byProject);
      return { byProject };
    });
  },

  closeFloat(projectId, url) {
    set((s) => {
      const projectWindows = s.byProject[projectId];
      if (!projectWindows || !projectWindows[url]) return s;
      const { [url]: _removed, ...rest } = projectWindows;
      const byProject = { ...s.byProject };
      if (Object.keys(rest).length === 0) {
        delete byProject[projectId];
      } else {
        byProject[projectId] = rest;
      }
      persist(byProject);
      return { byProject };
    });
  },

  navigateFloat(projectId, oldUrl, newUrl) {
    if (newUrl === oldUrl) return;
    set((s) => {
      const projectWindows = s.byProject[projectId];
      if (!projectWindows || !projectWindows[oldUrl]) return s;
      const old = projectWindows[oldUrl];
      const updated = { ...projectWindows };
      delete updated[oldUrl];
      if (!updated[newUrl]) {
        updated[newUrl] = { ...old, url: newUrl };
      }
      const byProject = { ...s.byProject, [projectId]: updated };
      persist(byProject);
      return { byProject };
    });
  },

  setPosition(projectId, url, pos) {
    set((s) => {
      const projectWindows = s.byProject[projectId];
      if (!projectWindows || !projectWindows[url]) return s;
      const byProject = {
        ...s.byProject,
        [projectId]: {
          ...projectWindows,
          [url]: { ...projectWindows[url], position: pos },
        },
      };
      persist(byProject);
      return { byProject };
    });
  },

  setSize(projectId, url, size, pos) {
    set((s) => {
      const projectWindows = s.byProject[projectId];
      if (!projectWindows || !projectWindows[url]) return s;
      const byProject = {
        ...s.byProject,
        [projectId]: {
          ...projectWindows,
          [url]: { ...projectWindows[url], position: pos, size },
        },
      };
      persist(byProject);
      return { byProject };
    });
  },

  clearProject(projectId) {
    set((s) => {
      if (!s.byProject[projectId]) return s;
      const { [projectId]: _removed, ...rest } = s.byProject;
      persist(rest);
      return { byProject: rest };
    });
  },
}));
