import { create } from "zustand";
import { isPathAtOrUnder, tabKey } from "../../lib/tab-target";
import { SPLIT_DEFAULT_RATIO, isValidRatio } from "./layout";
import { toSplitTarget, type SplitTarget } from "./target";

export interface SplitPaneState {
  target: SplitTarget;
  ratio: number;
}

type SplitByProject = Record<string, SplitPaneState>;

interface SplitPaneStore {
  byProject: SplitByProject;
  openSplit: (projectId: string, target: SplitTarget) => void;
  closeSplit: (projectId: string) => void;
  closeDeletedSplit: (projectId: string, path: string) => void;
  setRatio: (projectId: string, ratio: number) => void;
  clearProject: (projectId: string) => void;
}

const STORAGE_KEY = "spherse:content-split";

function parseEntry(value: unknown): SplitPaneState | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (!isValidRatio(entry.ratio)) return null;
  const target = toSplitTarget(entry.target)
    ?? (typeof entry.filePath === "string" ? toSplitTarget({ kind: "file", path: entry.filePath }) : null);
  return target ? { target, ratio: entry.ratio } : null;
}

function loadFromStorage(): SplitByProject {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: SplitByProject = {};
    for (const [projectId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = parseEntry(value);
      if (entry) result[projectId] = entry;
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

    openSplit(projectId, rawTarget) {
      const target = toSplitTarget(rawTarget);
      if (!target) return;
      set((s) => {
        const current = s.byProject[projectId];
        if (current && tabKey(current.target) === tabKey(target)) return s;
        const ratio = current?.ratio ?? SPLIT_DEFAULT_RATIO;
        return commit({ ...s.byProject, [projectId]: { target, ratio } });
      });
    },

    closeSplit(projectId) {
      set((s) => (s.byProject[projectId] ? commit(without(s.byProject, projectId)) : s));
    },

    closeDeletedSplit(projectId, path) {
      set((s) => {
        const target = s.byProject[projectId]?.target;
        if (target?.kind !== "file" || !isPathAtOrUnder(target.path, path)) return s;
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
