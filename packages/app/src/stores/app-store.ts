import { create, type StoreApi } from "zustand";
import { getLastRoute, setLastRoute } from "../lib/localstorage/last-route";
import type { HostBridge } from "../lib/host-bridge";

export interface ConnectionConfig {
  baseUrl: string;
  accessToken: string | null;
}

export interface ProjectState {
  id: string;
  path: string;
  name: string;
  lastRoute?: string;
  lastOpened: string;
}

interface AppStore {
  connection: ConnectionConfig;
  projects: Map<string, ProjectState>;
  activeProjectId: string | null;
  initializing: boolean;
  restoreProjects: (bridge: HostBridge) => Promise<string | null>;
  refreshProjects: (bridge: HostBridge) => Promise<void>;
  refreshConnection: (bridge: HostBridge) => Promise<void>;
  openProject: (bridge: HostBridge) => Promise<string | null>;
  openSampleProject: (bridge: HostBridge, sampleId: string) => Promise<{ projectId: string | null; error?: string }>;
  closeProject: (bridge: HostBridge, projectId: string) => Promise<string | null>;
  openProjectFolder: (bridge: HostBridge, projectId: string) => Promise<void>;
  setActiveProject: (bridge: HostBridge, projectId: string | null) => Promise<void>;
  setProjectLastRoute: (projectId: string, route: string) => Promise<void>;
}

function findProjectIdByPath(projects: Map<string, ProjectState>, projectPath: string): string | null {
  for (const project of projects.values()) {
    if (project.path === projectPath) return project.id;
  }
  return null;
}

type StoreSetter = StoreApi<AppStore>["setState"];
type StoreGetter = StoreApi<AppStore>["getState"];

async function fetchConnection(bridge: HostBridge): Promise<ConnectionConfig> {
  const baseUrl = await bridge.getServerBaseUrl();
  const accessToken = (await bridge.getServerAccessToken?.()) ?? null;
  return { baseUrl, accessToken };
}

function connectionEquals(a: ConnectionConfig, b: ConnectionConfig): boolean {
  return a.baseUrl === b.baseUrl && a.accessToken === b.accessToken;
}

async function registerProject(
  set: StoreSetter,
  get: StoreGetter,
  bridge: HostBridge,
  projectId: string,
  projectPath: string,
): Promise<void> {
  const name = projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath;
  const projects = new Map(get().projects);
  projects.set(projectId, {
    id: projectId,
    path: projectPath,
    name,
    lastOpened: new Date().toISOString(),
  });
  set({ projects, activeProjectId: projectId });
  await bridge.project?.addOpenProject(projectId, projectPath);
  await bridge.project?.setLastActiveProject(projectId);
}

export const useAppStore = create<AppStore>((set, get) => ({
  connection: { baseUrl: "", accessToken: null },
  projects: new Map(),
  activeProjectId: null,
  initializing: true,

  async restoreProjects(bridge) {
    set({ initializing: true });
    try {
      const connection = await fetchConnection(bridge);
      if (!connection.baseUrl) {
        set({ initializing: false, connection });
        return null;
      }
      const restored = (await bridge.project?.restoreProjects()) ?? [];
      const projects = new Map<string, ProjectState>();

      for (const { id, path, name, lastOpened } of restored) {
        projects.set(id, {
          id,
          path,
          name,
          lastRoute: getLastRoute(id) ?? undefined,
          lastOpened,
        });
      }

      const lastActiveId = (await bridge.project?.getLastActiveProject()) ?? null;
      const fallbackId = projects.keys().next().value ?? null;
      const nextActiveId = lastActiveId && projects.has(lastActiveId) ? lastActiveId : fallbackId;
      set({ connection, projects, activeProjectId: nextActiveId, initializing: false });
      return nextActiveId;
    } catch (err) {
      set({ initializing: false });
      throw err;
    }
  },

  /**
   * Runtime (non-startup) refresh of the project list: merges the latest
   * snapshot into the existing map without flipping `initializing` (no
   * full-screen loading flash) and without disturbing the active project
   * unless it disappeared. Projects registered locally after the fetch
   * started (concurrent openProject) are kept so an in-flight snapshot
   * cannot undo them. Connection config is refreshed as a side effect so
   * baseUrl/token snapshots follow localStorage changes. Throws on fetch
   * failure so callers can surface a toast; state is left untouched then.
   */
  async refreshProjects(bridge: HostBridge) {
    const fetchStartedAt = Date.now();
    const connection = await fetchConnection(bridge);
    if (!connection.baseUrl) {
      set((state) => (
        connectionEquals(state.connection, connection) ? {} : { connection }
      ));
      return;
    }
    const restored = (await bridge.project?.restoreProjects()) ?? [];
    const activeBefore = get().activeProjectId;
    set((state) => {
      const projects = new Map<string, ProjectState>();
      for (const { id, path, name, lastOpened } of restored) {
        const prev = state.projects.get(id);
        projects.set(id, {
          id,
          path,
          name,
          lastRoute: prev?.lastRoute ?? getLastRoute(id) ?? undefined,
          lastOpened,
        });
      }
      // Keep projects registered locally while the fetch was in flight so an
      // in-flight snapshot cannot drop a just-opened project.
      for (const [id, local] of state.projects) {
        if (!projects.has(id) && new Date(local.lastOpened).getTime() >= fetchStartedAt) {
          projects.set(id, local);
        }
      }
      let activeProjectId = state.activeProjectId;
      if (activeProjectId !== null && !projects.has(activeProjectId)) {
        // Fall back to the most recently opened project (server list order).
        activeProjectId = projects.keys().next().value ?? null;
      }
      return {
        projects,
        activeProjectId,
        ...(connectionEquals(state.connection, connection) ? {} : { connection }),
      };
    });
    const active = get().activeProjectId;
    if (active !== null && active !== activeBefore) {
      await bridge.project?.setLastActiveProject(active);
    }
  },

  async refreshConnection(bridge) {
    const connection = await fetchConnection(bridge);
    set((state) => (state.connection === connection ? {} : { connection }));
  },

  async openProject(bridge) {
    const dir = (await bridge.project?.selectDirectory()) ?? null;
    if (!dir) return null;

    const existing = findProjectIdByPath(get().projects, dir);
    if (existing) {
      await get().setActiveProject(bridge, existing);
      return existing;
    }

    const result = await bridge.project?.openProject(dir);
    if (!result) return null;
    const { projectId } = result;
    await registerProject(set, get, bridge, projectId, dir);
    return projectId;
  },

  async openSampleProject(bridge, sampleId) {
    const result = await bridge.project?.openSampleProject({ sampleId });
    if (!result) return { projectId: null };
    if ("error" in result) return { projectId: null, error: result.error };
    await registerProject(set, get, bridge, result.projectId, result.path);
    return { projectId: result.projectId };
  },

  async closeProject(bridge, projectId) {
    const project = get().projects.get(projectId);
    if (!project) return get().activeProjectId;

    await bridge.project?.closeProject(projectId, project.path);

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
      try {
        await bridge.project?.setLastActiveProject(nextActiveId);
      } catch (err) {
        console.warn("[app-store] failed to persist last active project:", err);
      }
    }

    return nextActiveId;
  },

  async openProjectFolder(bridge, projectId) {
    const project = get().projects.get(projectId);
    if (!project) return;
    await bridge.project?.openProjectFolder(project.path);
  },

  async setActiveProject(bridge, projectId) {
    if (!projectId) {
      set({ activeProjectId: null });
      return;
    }
    const project = get().projects.get(projectId);
    set({ activeProjectId: project ? projectId : null });
    if (project) {
      await bridge.project?.setLastActiveProject(projectId);
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
