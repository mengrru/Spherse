import { create } from "zustand";
import { isPathAtOrUnder, isTabTarget, normalizeTabTarget, tabKey, type TabTarget } from "../../lib/tab-target";

type TabsByProject = Record<string, TabTarget[]>;

interface TabsStore {
  byProject: TabsByProject;
  openTab: (projectId: string, target: TabTarget) => void;
  replaceTab: (projectId: string, oldKey: string, target: TabTarget) => void;
  closeTab: (projectId: string, key: string) => void;
  closeFileTabs: (projectId: string, path: string) => void;
  moveTab: (projectId: string, fromKey: string, toKey: string) => void;
  clearProject: (projectId: string) => void;
}

const STORAGE_KEY = "spherse:tabs";

function dedupe(targets: TabTarget[]): TabTarget[] {
  const seen = new Set<string>();
  const result: TabTarget[] = [];
  for (const target of targets) {
    const key = tabKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalizeTabTarget(target));
  }
  return result;
}

function loadFromStorage(): TabsByProject {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: TabsByProject = {};
    for (const [projectId, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const targets = dedupe(list.filter(isTabTarget));
      if (targets.length > 0) result[projectId] = targets;
    }
    return result;
  } catch {
    return {};
  }
}

function persist(byProject: TabsByProject) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byProject));
  } catch {
    return;
  }
}

function withProject(byProject: TabsByProject, projectId: string, tabs: TabTarget[]): TabsByProject {
  const next = { ...byProject };
  if (tabs.length === 0) delete next[projectId];
  else next[projectId] = tabs;
  return next;
}

export const useTabsStore = create<TabsStore>((set) => {
  function update(projectId: string, fn: (tabs: TabTarget[]) => TabTarget[] | null) {
    set((s) => {
      const current = s.byProject[projectId] ?? [];
      const nextTabs = fn(current);
      if (!nextTabs) return s;
      const byProject = withProject(s.byProject, projectId, nextTabs);
      persist(byProject);
      return { byProject };
    });
  }

  return {
    byProject: loadFromStorage(),

    openTab(projectId, target) {
      const key = tabKey(target);
      update(projectId, (tabs) =>
        tabs.some((t) => tabKey(t) === key) ? null : [...tabs, normalizeTabTarget(target)]);
    },

    replaceTab(projectId, oldKey, target) {
      const key = tabKey(target);
      update(projectId, (tabs) => {
        const index = tabs.findIndex((t) => tabKey(t) === oldKey);
        if (index < 0) {
          return tabs.some((t) => tabKey(t) === key) ? null : [...tabs, normalizeTabTarget(target)];
        }
        if (oldKey === key) return null;
        if (tabs.some((t) => tabKey(t) === key)) return tabs.filter((_, i) => i !== index);
        const next = [...tabs];
        next[index] = normalizeTabTarget(target);
        return next;
      });
    },

    closeTab(projectId, key) {
      update(projectId, (tabs) => {
        const next = tabs.filter((t) => tabKey(t) !== key);
        return next.length === tabs.length ? null : next;
      });
    },

    closeFileTabs(projectId, path) {
      update(projectId, (tabs) => {
        const next = tabs.filter((t) => t.kind !== "file" || !isPathAtOrUnder(t.path, path));
        return next.length === tabs.length ? null : next;
      });
    },

    moveTab(projectId, fromKey, toKey) {
      update(projectId, (tabs) => {
        const from = tabs.findIndex((t) => tabKey(t) === fromKey);
        const to = tabs.findIndex((t) => tabKey(t) === toKey);
        if (from < 0 || to < 0 || from === to) return null;
        const next = [...tabs];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
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
  };
});
