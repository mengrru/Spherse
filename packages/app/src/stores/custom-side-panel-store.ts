import { create } from "zustand";

interface CustomSidePanelStore {
  activeByProject: Record<string, boolean>;
  isActive: (projectId: string) => boolean;
  setActive: (projectId: string, active: boolean) => void;
  toggle: (projectId: string) => void;
  clearProject: (projectId: string) => void;
}

const ACTIVE_STORAGE_KEY = "spherse:custom-side-panel:active-by-project";

function readActiveMap(): Record<string, boolean> {
  if (typeof localStorage === "undefined") return {};
  try {
    const stored = localStorage.getItem(ACTIVE_STORAGE_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
}

function writeActiveMap(map: Record<string, boolean>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ACTIVE_STORAGE_KEY, JSON.stringify(map));
}

export const useCustomSidePanelStore = create<CustomSidePanelStore>((set, get) => ({
  activeByProject: readActiveMap(),

  isActive(projectId) {
    return get().activeByProject[projectId] === true;
  },

  setActive(projectId, active) {
    const next = { ...get().activeByProject };
    if (active) next[projectId] = true;
    else delete next[projectId];
    writeActiveMap(next);
    set({ activeByProject: next });
  },

  toggle(projectId) {
    get().setActive(projectId, !get().isActive(projectId));
  },

  clearProject(projectId) {
    if (!(projectId in get().activeByProject)) return;
    const next = { ...get().activeByProject };
    delete next[projectId];
    writeActiveMap(next);
    set({ activeByProject: next });
  },
}));
