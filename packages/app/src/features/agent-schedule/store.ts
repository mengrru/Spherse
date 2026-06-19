import { create } from "zustand";
import type { ApiClient } from "../../lib/api";
import type { ScheduleInfo, ScheduleServerEvent } from "../../lib/types";
import { useProjectDataStore } from "../../stores/project-data-store";

interface ScheduleProjectData {
  schedulesByAgent: Record<string, ScheduleInfo[]>;
  runningScheduleIdsByAgent: Record<string, string[]>;
  scheduleEventVersion: number;
}

interface ScheduleStore {
  byProject: Record<string, ScheduleProjectData>;
  refreshSchedules: (projectId: string, client: ApiClient, agentId: string) => Promise<void>;
  createSchedule: (projectId: string, client: ApiClient, agentId: string, data: Parameters<ApiClient["createSchedule"]>[1]) => Promise<void>;
  updateSchedule: (projectId: string, client: ApiClient, agentId: string, scheduleId: string, data: Parameters<ApiClient["updateSchedule"]>[2]) => Promise<void>;
  deleteSchedule: (projectId: string, client: ApiClient, agentId: string, scheduleId: string) => Promise<void>;
  triggerSchedule: (projectId: string, client: ApiClient, agentId: string, scheduleId: string) => Promise<void>;
  handleScheduleEvent: (projectId: string, client: ApiClient, event: ScheduleServerEvent) => void;
  clearProject: (projectId: string) => void;
}

function createScheduleProjectData(): ScheduleProjectData {
  return {
    schedulesByAgent: {},
    runningScheduleIdsByAgent: {},
    scheduleEventVersion: 0,
  };
}

function updateScheduleProject(
  state: ScheduleStore,
  projectId: string,
  update: (data: ScheduleProjectData) => ScheduleProjectData,
) {
  const current = state.byProject[projectId] ?? createScheduleProjectData();
  return {
    byProject: {
      ...state.byProject,
      [projectId]: update(current),
    },
  };
}

function addRunningSchedule(data: ScheduleProjectData, agentId: string, scheduleId: string): ScheduleProjectData {
  const current = data.runningScheduleIdsByAgent[agentId] ?? [];
  if (current.includes(scheduleId)) return data;
  return {
    ...data,
    runningScheduleIdsByAgent: {
      ...data.runningScheduleIdsByAgent,
      [agentId]: [...current, scheduleId],
    },
  };
}

function removeRunningSchedule(data: ScheduleProjectData, agentId: string, scheduleId: string): ScheduleProjectData {
  const current = data.runningScheduleIdsByAgent[agentId] ?? [];
  const next = current.filter((id) => id !== scheduleId);
  if (next.length === current.length) return data;
  return {
    ...data,
    runningScheduleIdsByAgent: {
      ...data.runningScheduleIdsByAgent,
      [agentId]: next,
    },
  };
}

export const useScheduleStore = create<ScheduleStore>((set, get) => ({
  byProject: {},

  async refreshSchedules(projectId, client, agentId) {
    try {
      const schedules = await client.listSchedules(agentId);
      set((state) => updateScheduleProject(state, projectId, (data) => ({
        ...data,
        schedulesByAgent: { ...data.schedulesByAgent, [agentId]: schedules },
      })));
    } catch {
      // silent — schedule refresh failures are non-critical
    }
  },

  async createSchedule(projectId, client, agentId, data) {
    try {
      await client.createSchedule(agentId, data);
      await get().refreshSchedules(projectId, client, agentId);
    } catch {
      // silent
    }
  },

  async updateSchedule(projectId, client, agentId, scheduleId, data) {
    try {
      await client.updateSchedule(agentId, scheduleId, data);
      await get().refreshSchedules(projectId, client, agentId);
    } catch {
      // silent
    }
  },

  async deleteSchedule(projectId, client, agentId, scheduleId) {
    try {
      await client.deleteSchedule(agentId, scheduleId);
      await get().refreshSchedules(projectId, client, agentId);
    } catch {
      // silent
    }
  },

  async triggerSchedule(projectId, client, agentId, scheduleId) {
    set((state) => updateScheduleProject(state, projectId, (data) =>
      addRunningSchedule(data, agentId, scheduleId)));
    try {
      await client.triggerSchedule(agentId, scheduleId);
    } catch {
      set((state) => updateScheduleProject(state, projectId, (data) =>
        removeRunningSchedule(data, agentId, scheduleId)));
    }
  },

  handleScheduleEvent(projectId, client, event) {
    if (event.type === "schedule_triggered") {
      set((state) => updateScheduleProject(state, projectId, (data) => ({
        ...addRunningSchedule(data, event.agentId, event.scheduleId),
        scheduleEventVersion: data.scheduleEventVersion + 1,
      })));
      return;
    }

    if (event.type === "schedule_completed" || event.type === "schedule_failed") {
      set((state) => updateScheduleProject(state, projectId, (data) => ({
        ...removeRunningSchedule(data, event.agentId, event.scheduleId),
        scheduleEventVersion: data.scheduleEventVersion + 1,
      })));
      void get().refreshSchedules(projectId, client, event.agentId);
      if (event.type === "schedule_completed") {
        void useProjectDataStore.getState().refreshSessions(projectId, client);
      }
      return;
    }

    if (event.type === "schedule_updated") {
      set((state) => updateScheduleProject(state, projectId, (data) => ({
        ...data,
        scheduleEventVersion: data.scheduleEventVersion + 1,
      })));
      void get().refreshSchedules(projectId, client, event.agentId);
    }
  },

  clearProject(projectId) {
    set((state) => {
      const { [projectId]: _removed, ...rest } = state.byProject;
      return { byProject: rest };
    });
  },
}));
