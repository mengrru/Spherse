import { create } from "zustand";
import { isPathAtOrUnder } from "../../lib/tab-target";
import { SPLIT_DEFAULT_RATIO, isValidRatio } from "./layout";

export interface SplitPaneState {
  filePath: string;
  ratio: number;
}

type SplitByProject = Record<string, SplitPaneState>;

interface SplitPaneStore {
  byProject: SplitByProject;
  openSplit: (projectId: string, filePath: string) => void;
  closeSplit: (projectId: string) => void;
  closeDeletedSplit: (projectId: string, path: string) => void;
  setRatio: (projectId: string, ratio: number) => void;
  clearProject: (projectId: string) => void;
}

const STORAGE_KEY = "spherse:content-split";

function isSplitPaneState(value: unknown): value is SplitPaneState {
  if (!value || typeof value !== "object") return false;
  const { filePath, ratio } = value as Record<string, unknown>;
  return typeof filePath === "string" && filePath.length > 0 && isValidRatio(ratio);
}

function loadFromStorage(): SplitByProject {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: SplitByProject = {};
    for (const [projectId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (isSplitPaneState(entry)) result[projectId] = { filePath: entry.filePath, ratio: entry.ratio };
    }
    return result;
  } catch {
    return {};
  }
}

function persist(byProject: SplitByProject) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byProject));
  } catch {
    return;
  }
}

function without(byProject: SplitByProject, projectId: string): SplitByProject {
  const { [projectId]: _removed, ...rest } = byProject;
  return rest;
}

export const useSplitPaneStore = create<SplitPaneStore>((set) => {
  function commit(byProject: SplitByProject) {
    persist(byProject);
    return { byProject };
  }

  return {
    byProject: loadFromStorage(),

    openSplit(projectId, filePath) {
      if (!filePath) return;
      set((s) => {
        const current = s.byProject[projectId];
        if (current?.filePath === filePath) return s;
        const ratio = current?.ratio ?? SPLIT_DEFAULT_RATIO;
        return commit({ ...s.byProject, [projectId]: { filePath, ratio } });
      });
    },

    closeSplit(projectId) {
      set((s) => (s.byProject[projectId] ? commit(without(s.byProject, projectId)) : s));
    },

    closeDeletedSplit(projectId, path) {
      set((s) => {
        const current = s.byProject[projectId];
        if (!current || !isPathAtOrUnder(current.filePath, path)) return s;
        return commit(without(s.byProject, projectId));
      });
    },

    setRatio(projectId, ratio) {
      if (!isValidRatio(ratio)) return;
      set((s) => {
        const current = s.byProject[projectId];
        if (!current || current.ratio === ratio) return s;
        return commit({ ...s.byProject, [projectId]: { ...current, ratio } });
      });
    },

    clearProject(projectId) {
      set((s) => (s.byProject[projectId] ? commit(without(s.byProject, projectId)) : s));
    },
  };
});
