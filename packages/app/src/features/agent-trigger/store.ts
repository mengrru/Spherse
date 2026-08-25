import { create } from "zustand";
import type { ApiClient } from "../../lib/api";
import type { TriggerServerEvent } from "../../lib/types";
import { refreshProjectSessions } from "../../queries/project";
import { queryClient } from "../../queries/client";
import { projectQueryKeys } from "../../queries/keys";
import { selectAgentTriggers } from "../../queries/triggers";

interface TriggerProjectData {
  runningTriggerIdsByAgent: Record<string, string[]>;
  triggerEventVersion: number;
}

interface TriggerStore {
  byProject: Record<string, TriggerProjectData>;
  handleTriggerEvent: (projectId: string, event: TriggerServerEvent) => void;
  runTrigger: (projectId: string, client: ApiClient, agentId: string, triggerId: string) => Promise<void>;
  markTriggerRunning: (projectId: string, agentId: string, triggerId: string, running: boolean) => void;
  clearRunningTriggers: (projectId: string) => void;
  clearProject: (projectId: string) => void;
}

function createTriggerProjectData(): TriggerProjectData {
  return {
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

  markTriggerRunning(projectId, agentId, triggerId, running) {
    set((state) => updateTriggerProject(state, projectId, (data) =>
      running
        ? addRunningTrigger(data, agentId, triggerId)
        : removeRunningTrigger(data, agentId, triggerId)));
  },

  async runTrigger(projectId, client, agentId, triggerId) {
    get().markTriggerRunning(projectId, agentId, triggerId, true);
    try {
      await client.runTrigger(agentId, triggerId);
    } catch (error) {
      get().markTriggerRunning(projectId, agentId, triggerId, false);
      throw error;
    }
  },

  clearRunningTriggers(projectId) {
    set((state) => updateTriggerProject(state, projectId, (data) => ({
      ...data,
      runningTriggerIdsByAgent: {},
    })));
  },

  handleTriggerEvent(projectId, event) {
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
      if (event.type === "trigger_completed") {
        void refreshProjectSessions(projectId);
      }
      return;
    }

    if (event.type === "trigger_updated") {
      set((state) => updateTriggerProject(state, projectId, (data) => ({
        ...data,
        triggerEventVersion: data.triggerEventVersion + 1,
      })));
    }
  },

  clearProject(projectId) {
    set((state) => {
      const { [projectId]: _removed, ...rest } = state.byProject;
      return { byProject: rest };
    });
  },
}));

export function getCachedTriggersForAgent(projectId: string, agentId: string) {
  const data = queryClient.getQueryData<{ triggers: Parameters<typeof selectAgentTriggers>[0] }>(
    projectQueryKeys.triggers(projectId),
  );
  return selectAgentTriggers(data?.triggers, agentId);
}
