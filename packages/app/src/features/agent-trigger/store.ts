import { create } from "zustand";
import type { ApiClient } from "../../lib/api";
import type { TriggerInfo, TriggerServerEvent } from "../../lib/types";
import { useProjectDataStore } from "../../stores/project-data-store";

interface TriggerProjectData {
  triggersByAgent: Record<string, TriggerInfo[]>;
  runningTriggerIdsByAgent: Record<string, string[]>;
  triggerEventVersion: number;
}

interface TriggerStore {
  byProject: Record<string, TriggerProjectData>;
  refreshTriggers: (projectId: string, client: ApiClient, agentId: string) => Promise<void>;
  createTrigger: (projectId: string, client: ApiClient, agentId: string, data: Parameters<ApiClient["createTrigger"]>[1]) => Promise<void>;
  updateTrigger: (projectId: string, client: ApiClient, agentId: string, triggerId: string, data: Parameters<ApiClient["updateTrigger"]>[2]) => Promise<void>;
  deleteTrigger: (projectId: string, client: ApiClient, agentId: string, triggerId: string) => Promise<void>;
  runTrigger: (projectId: string, client: ApiClient, agentId: string, triggerId: string) => Promise<void>;
  handleTriggerEvent: (projectId: string, client: ApiClient, event: TriggerServerEvent) => void;
  clearProject: (projectId: string) => void;
}

function createTriggerProjectData(): TriggerProjectData {
  return {
    triggersByAgent: {},
    runningTriggerIdsByAgent: {},
    triggerEventVersion: 0,
  };
}

function updateTriggerProject(
  state: TriggerStore,
  projectId: string,
  update: (data: TriggerProjectData) => TriggerProjectData,
) {
  const current = state.byProject[projectId] ?? createTriggerProjectData();
  return {
    byProject: {
      ...state.byProject,
      [projectId]: update(current),
    },
  };
}

function addRunningTrigger(data: TriggerProjectData, agentId: string, triggerId: string): TriggerProjectData {
  const current = data.runningTriggerIdsByAgent[agentId] ?? [];
  if (current.includes(triggerId)) return data;
  return {
    ...data,
    runningTriggerIdsByAgent: {
      ...data.runningTriggerIdsByAgent,
      [agentId]: [...current, triggerId],
    },
  };
}

function removeRunningTrigger(data: TriggerProjectData, agentId: string, triggerId: string): TriggerProjectData {
  const current = data.runningTriggerIdsByAgent[agentId] ?? [];
  const next = current.filter((id) => id !== triggerId);
  if (next.length === current.length) return data;
  return {
    ...data,
    runningTriggerIdsByAgent: {
      ...data.runningTriggerIdsByAgent,
      [agentId]: next,
    },
  };
}

export const useTriggerStore = create<TriggerStore>((set, get) => ({
  byProject: {},

  async refreshTriggers(projectId, client, agentId) {
    try {
      const triggers = await client.listTriggers(agentId);
      set((state) => updateTriggerProject(state, projectId, (data) => ({
        ...data,
        triggersByAgent: { ...data.triggersByAgent, [agentId]: triggers },
      })));
      useProjectDataStore.getState().setHasEnabledTriggers(
        projectId,
        agentId,
        triggers.some((t) => t.enabled),
      );
    } catch {
      // silent — trigger refresh failures are non-critical
    }
  },

  async createTrigger(projectId, client, agentId, data) {
    try {
      await client.createTrigger(agentId, data);
      await get().refreshTriggers(projectId, client, agentId);
    } catch {
      // silent
    }
  },

  async updateTrigger(projectId, client, agentId, triggerId, data) {
    try {
      await client.updateTrigger(agentId, triggerId, data);
      await get().refreshTriggers(projectId, client, agentId);
    } catch {
      // silent
    }
  },

  async deleteTrigger(projectId, client, agentId, triggerId) {
    try {
      await client.deleteTrigger(agentId, triggerId);
      await get().refreshTriggers(projectId, client, agentId);
    } catch {
      // silent
    }
  },

  async runTrigger(projectId, client, agentId, triggerId) {
    set((state) => updateTriggerProject(state, projectId, (data) =>
      addRunningTrigger(data, agentId, triggerId)));
    try {
      await client.runTrigger(agentId, triggerId);
    } catch {
      set((state) => updateTriggerProject(state, projectId, (data) =>
        removeRunningTrigger(data, agentId, triggerId)));
    }
  },

  handleTriggerEvent(projectId, client, event) {
    if (event.type === "trigger_triggered") {
      set((state) => updateTriggerProject(state, projectId, (data) => ({
        ...addRunningTrigger(data, event.agentId, event.triggerId),
        triggerEventVersion: data.triggerEventVersion + 1,
      })));
      return;
    }

    if (event.type === "trigger_completed" || event.type === "trigger_failed") {
      set((state) => updateTriggerProject(state, projectId, (data) => ({
        ...removeRunningTrigger(data, event.agentId, event.triggerId),
        triggerEventVersion: data.triggerEventVersion + 1,
      })));
      void get().refreshTriggers(projectId, client, event.agentId);
      if (event.type === "trigger_completed") {
        void useProjectDataStore.getState().refreshSessions(projectId, client);
      }
      return;
    }

    if (event.type === "trigger_updated") {
      set((state) => updateTriggerProject(state, projectId, (data) => ({
        ...data,
        triggerEventVersion: data.triggerEventVersion + 1,
      })));
      void get().refreshTriggers(projectId, client, event.agentId);
    }
  },

  clearProject(projectId) {
    set((state) => {
      const { [projectId]: _removed, ...rest } = state.byProject;
      return { byProject: rest };
    });
  },
}));
