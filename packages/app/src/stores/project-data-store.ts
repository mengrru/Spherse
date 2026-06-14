import { create } from "zustand";
import { translate } from "@spherse/i18n";
import type { ApiClient } from "../lib/api";
import type { AgentProfile, ActiveSessionInfo, SessionInfo, ScheduleInfo, ScheduleServerEvent } from "../lib/types";
import { useSettingsStore } from "../features/settings/store";

interface ProjectData {
  agents: AgentProfile[];
  sessions: SessionInfo[];
  schedulesByAgent: Record<string, ScheduleInfo[]>;
  runningScheduleIdsByAgent: Record<string, string[]>;
  scheduleEventVersion: number;
  initialMessageBySessionId: Record<string, string>;
  loading: boolean;
  error: string | null;
}

interface ProjectDataStore {
  projects: Record<string, ProjectData>;
  getProjectData: (projectId: string) => ProjectData;
  resolveSessionViews: (
    projectId: string,
    activeSessionId: string | null,
    floatingSessionId: string | null,
  ) => {
    selectedSession: SessionInfo | null;
    selectedAgent: AgentProfile | null;
    activeSessions: ActiveSessionInfo[];
  };
  refreshAgents: (projectId: string, client: ApiClient) => Promise<void>;
  refreshSessions: (projectId: string, client: ApiClient) => Promise<void>;
  createSession: (
    projectId: string,
    client: ApiClient,
    agentId: string,
    initialMessage?: string,
  ) => Promise<SessionInfo | null>;
  deleteSession: (projectId: string, client: ApiClient, sessionId: string) => Promise<void>;
  renameSession: (projectId: string, client: ApiClient, sessionId: string, title: string) => Promise<boolean>;
  createAgent: (projectId: string, client: ApiClient, slug: string, content: string, themeContent?: string) => Promise<boolean>;
  updateAgent: (projectId: string, client: ApiClient, agentId: string, content: string, themeContent?: string) => Promise<boolean>;
  deleteAgent: (projectId: string, client: ApiClient, agentId: string) => Promise<void>;
  setInitialMessage: (projectId: string, sessionId: string, message: string) => void;
  consumeInitialMessage: (projectId: string, sessionId: string) => string | undefined;
  refreshSchedules: (projectId: string, client: ApiClient, agentId: string) => Promise<void>;
  createSchedule: (projectId: string, client: ApiClient, agentId: string, data: Parameters<ApiClient["createSchedule"]>[1]) => Promise<void>;
  updateSchedule: (projectId: string, client: ApiClient, agentId: string, scheduleId: string, data: Parameters<ApiClient["updateSchedule"]>[2]) => Promise<void>;
  deleteSchedule: (projectId: string, client: ApiClient, agentId: string, scheduleId: string) => Promise<void>;
  triggerSchedule: (projectId: string, client: ApiClient, agentId: string, scheduleId: string) => Promise<void>;
  handleScheduleEvent: (projectId: string, client: ApiClient, event: ScheduleServerEvent) => void;
  clearProjectData: (projectId: string) => void;
}

function createProjectData(): ProjectData {
  return {
    agents: [],
    sessions: [],
    schedulesByAgent: {},
    runningScheduleIdsByAgent: {},
    scheduleEventVersion: 0,
    initialMessageBySessionId: {},
    loading: false,
    error: null,
  };
}

function addRunningSchedule(project: ProjectData, agentId: string, scheduleId: string): ProjectData {
  const current = project.runningScheduleIdsByAgent[agentId] ?? [];
  if (current.includes(scheduleId)) return project;
  return {
    ...project,
    runningScheduleIdsByAgent: {
      ...project.runningScheduleIdsByAgent,
      [agentId]: [...current, scheduleId],
    },
  };
}

function removeRunningSchedule(project: ProjectData, agentId: string, scheduleId: string): ProjectData {
  const current = project.runningScheduleIdsByAgent[agentId] ?? [];
  const next = current.filter((id) => id !== scheduleId);
  if (next.length === current.length) return project;
  return {
    ...project,
    runningScheduleIdsByAgent: {
      ...project.runningScheduleIdsByAgent,
      [agentId]: next,
    },
  };
}

function getErrorMessage(err: unknown): string {
  const locale = useSettingsStore.getState().locale ?? "zh-CN";
  return err instanceof Error ? err.message : translate(locale, "error.requestFailed");
}

function updateProjectData(
  state: ProjectDataStore,
  projectId: string,
  update: (project: ProjectData) => ProjectData,
  options: { createIfMissing?: boolean } = {},
) {
  const current = state.projects[projectId];
  if (!current && options.createIfMissing === false) return state;
  return {
    projects: {
      ...state.projects,
      [projectId]: update(current ?? createProjectData()),
    },
  };
}

export const useProjectDataStore = create<ProjectDataStore>((set, get) => ({
  projects: {},

  getProjectData(projectId) {
    return get().projects[projectId] ?? createProjectData();
  },

  resolveSessionViews(projectId, activeSessionId, floatingSessionId) {
    const data = get().projects[projectId];
    const agents = data?.agents ?? [];
    const sessions = data?.sessions ?? [];

    const selectedSession = activeSessionId
      ? sessions.find((s) => s.id === activeSessionId) ?? null
      : null;
    const selectedAgent = selectedSession
      ? agents.find((a) => a.id === selectedSession.agentId) ?? null
      : null;

    const floatingSession = floatingSessionId
      ? sessions.find((s) => s.id === floatingSessionId) ?? null
      : null;
    const floatingAgent = floatingSession
      ? agents.find((a) => a.id === floatingSession.agentId) ?? null
      : null;

    const activeSessions: ActiveSessionInfo[] = [];
    if (selectedSession && selectedAgent) {
      activeSessions.push({
        sessionId: selectedSession.id,
        agentName: selectedAgent.name,
        sessionTitle: selectedSession.title,
      });
    }
    if (floatingSession && floatingAgent) {
      activeSessions.push({
        sessionId: floatingSession.id,
        agentName: floatingAgent.name,
        sessionTitle: floatingSession.title,
        floating: true,
      });
    }

    return { selectedSession, selectedAgent, activeSessions };
  },

  async refreshAgents(projectId, client) {
    set((state) => updateProjectData(state, projectId, (project) => ({
      ...project,
      loading: true,
      error: null,
    })));

    try {
      const agents = await client.listAgents();
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project,
        agents,
        loading: false,
        error: null,
      }), { createIfMissing: false }));
    } catch (err) {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project,
        loading: false,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  async refreshSessions(projectId, client) {
    set((state) => updateProjectData(state, projectId, (project) => ({
      ...project,
      error: null,
    })));

    try {
      const agents = get().projects[projectId]?.agents ?? [];
      const allSessions = await Promise.all(
        agents.map((agent) => client.listSessions(agent.id)),
      );
      const sessions = allSessions.flat();
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project,
        sessions: [
          ...project.sessions.filter((session) =>
            project.initialMessageBySessionId[session.id] &&
            !sessions.some((item) => item.id === session.id),
          ),
          ...sessions,
        ],
        error: null,
      }), { createIfMissing: false }));
    } catch (err) {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  async createSession(projectId, client, agentId, initialMessage) {
    set((state) => updateProjectData(state, projectId, (project) => ({
      ...project,
      error: null,
    })));

    try {
      const { sessionId } = await client.createSession(agentId);
      if (typeof sessionId !== "string" || !sessionId) {
        throw new Error("sessionId is required");
      }
      const session: SessionInfo = {
        id: sessionId,
        agentId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "active",
      };
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project,
        sessions: [session, ...project.sessions.filter((item) => item.id !== sessionId)],
        initialMessageBySessionId: initialMessage
          ? { ...project.initialMessageBySessionId, [sessionId]: initialMessage }
          : project.initialMessageBySessionId,
        error: null,
      }), { createIfMissing: false }));
      void get().refreshSessions(projectId, client);
      return session;
    } catch (err) {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
      return null;
    }
  },

  async deleteSession(projectId, client, sessionId) {
    try {
      const project = get().projects[projectId];
      const session = project?.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      await client.deleteSession(session.agentId, sessionId);
      set((state) => updateProjectData(state, projectId, (project) => {
        const { [sessionId]: _removed, ...initialMessageBySessionId } =
          project.initialMessageBySessionId;
        return {
          ...project,
          sessions: project.sessions.filter((session) => session.id !== sessionId),
          initialMessageBySessionId,
          error: null,
        };
      }, { createIfMissing: false }));
    } catch (err) {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  async renameSession(projectId, client, sessionId, title) {
    try {
      const project = get().projects[projectId];
      const session = project?.sessions.find((s) => s.id === sessionId);
      if (!session) return false;
      const updatedSession = await client.renameSession(session.agentId, sessionId, title);
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project,
        sessions: project.sessions.map((session) =>
          session.id === sessionId ? updatedSession : session,
        ),
        error: null,
      }), { createIfMissing: false }));
      return true;
    } catch (err) {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
      return false;
    }
  },

  async createAgent(projectId, client, slug, content, themeContent) {
    set((state) => updateProjectData(state, projectId, (project) => ({
      ...project,
      error: null,
    })));

    try {
      await client.createAgent(slug, content, themeContent);
      await get().refreshAgents(projectId, client);
      return true;
    } catch (err) {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
      return false;
    }
  },

  async updateAgent(projectId, client, agentId, content, themeContent) {
    set((state) => updateProjectData(state, projectId, (project) => ({
      ...project,
      error: null,
    })));

    try {
      await client.updateAgent(agentId, content, themeContent);
      await get().refreshAgents(projectId, client);
      return true;
    } catch (err) {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
      return false;
    }
  },

  async deleteAgent(projectId, client, agentId) {
    try {
      await client.deleteAgent(agentId);
      await get().refreshAgents(projectId, client);
      await get().refreshSessions(projectId, client);
    } catch (err) {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  setInitialMessage(projectId, sessionId, message) {
    set((state) => updateProjectData(state, projectId, (project) => ({
      ...project,
      initialMessageBySessionId: {
        ...project.initialMessageBySessionId,
        [sessionId]: message,
      },
    }), { createIfMissing: false }));
  },

  consumeInitialMessage(projectId, sessionId) {
    const message = get().projects[projectId]?.initialMessageBySessionId[sessionId];
    if (!message) return undefined;
    set((state) => updateProjectData(state, projectId, (project) => {
      const { [sessionId]: _removed, ...initialMessageBySessionId } =
        project.initialMessageBySessionId;
      return {
        ...project,
        initialMessageBySessionId,
      };
    }));
    return message;
  },

  async refreshSchedules(projectId, client, agentId) {
    try {
      const schedules = await client.listSchedules(agentId);
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project,
        schedulesByAgent: { ...project.schedulesByAgent, [agentId]: schedules },
      }), { createIfMissing: false }));
    } catch (err) {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project, error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  async createSchedule(projectId, client, agentId, data) {
    try {
      await client.createSchedule(agentId, data);
      await get().refreshSchedules(projectId, client, agentId);
    } catch (err) {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project, error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  async updateSchedule(projectId, client, agentId, scheduleId, data) {
    try {
      await client.updateSchedule(agentId, scheduleId, data);
      await get().refreshSchedules(projectId, client, agentId);
    } catch (err) {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project, error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  async deleteSchedule(projectId, client, agentId, scheduleId) {
    try {
      await client.deleteSchedule(agentId, scheduleId);
      await get().refreshSchedules(projectId, client, agentId);
    } catch (err) {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project, error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  async triggerSchedule(projectId, client, agentId, scheduleId) {
    set((state) => updateProjectData(state, projectId, (project) =>
      addRunningSchedule(project, agentId, scheduleId), { createIfMissing: false }));
    try {
      await client.triggerSchedule(agentId, scheduleId);
    } catch (err) {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...removeRunningSchedule(project, agentId, scheduleId),
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  handleScheduleEvent(projectId, client, event) {
    if (event.type === "schedule_triggered") {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...addRunningSchedule(project, event.agentId, event.scheduleId),
        scheduleEventVersion: project.scheduleEventVersion + 1,
      }), { createIfMissing: false }));
      return;
    }

    if (event.type === "schedule_completed" || event.type === "schedule_failed") {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...removeRunningSchedule(project, event.agentId, event.scheduleId),
        scheduleEventVersion: project.scheduleEventVersion + 1,
      }), { createIfMissing: false }));
      void get().refreshSchedules(projectId, client, event.agentId);
      if (event.type === "schedule_completed") void get().refreshSessions(projectId, client);
      return;
    }

    if (event.type === "schedule_updated") {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project,
        scheduleEventVersion: project.scheduleEventVersion + 1,
      }), { createIfMissing: false }));
      void get().refreshSchedules(projectId, client, event.agentId);
    }
  },

  clearProjectData(projectId) {
    set((state) => {
      const { [projectId]: _removed, ...projects } = state.projects;
      return { projects };
    });
  },
}));
