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
  getProjectData: (projectKey: string) => ProjectData;
  resolveSessionViews: (
    projectKey: string,
    activeSessionId: string | null,
    floatingSessionId: string | null,
  ) => {
    selectedSession: SessionInfo | null;
    selectedAgent: AgentProfile | null;
    activeSessions: ActiveSessionInfo[];
  };
  refreshAgents: (projectKey: string, client: ApiClient) => Promise<void>;
  refreshSessions: (projectKey: string, client: ApiClient) => Promise<void>;
  createSession: (
    projectKey: string,
    client: ApiClient,
    agentId: string,
    initialMessage?: string,
  ) => Promise<SessionInfo | null>;
  deleteSession: (projectKey: string, client: ApiClient, sessionId: string) => Promise<void>;
  renameSession: (projectKey: string, client: ApiClient, sessionId: string, title: string) => Promise<boolean>;
  createAgent: (projectKey: string, client: ApiClient, slug: string, content: string, themeContent?: string) => Promise<boolean>;
  updateAgent: (projectKey: string, client: ApiClient, agentId: string, content: string, themeContent?: string) => Promise<boolean>;
  deleteAgent: (projectKey: string, client: ApiClient, agentId: string) => Promise<void>;
  setInitialMessage: (projectKey: string, sessionId: string, message: string) => void;
  consumeInitialMessage: (projectKey: string, sessionId: string) => string | undefined;
  refreshSchedules: (projectKey: string, client: ApiClient, agentId: string) => Promise<void>;
  createSchedule: (projectKey: string, client: ApiClient, agentId: string, data: Parameters<ApiClient["createSchedule"]>[1]) => Promise<void>;
  updateSchedule: (projectKey: string, client: ApiClient, agentId: string, scheduleId: string, data: Parameters<ApiClient["updateSchedule"]>[2]) => Promise<void>;
  deleteSchedule: (projectKey: string, client: ApiClient, agentId: string, scheduleId: string) => Promise<void>;
  triggerSchedule: (projectKey: string, client: ApiClient, agentId: string, scheduleId: string) => Promise<void>;
  handleScheduleEvent: (projectKey: string, client: ApiClient, event: ScheduleServerEvent) => void;
  clearProjectData: (projectKey: string) => void;
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
  projectKey: string,
  update: (project: ProjectData) => ProjectData,
  options: { createIfMissing?: boolean } = {},
) {
  const current = state.projects[projectKey];
  if (!current && options.createIfMissing === false) return state;
  return {
    projects: {
      ...state.projects,
      [projectKey]: update(current ?? createProjectData()),
    },
  };
}

export const useProjectDataStore = create<ProjectDataStore>((set, get) => ({
  projects: {},

  getProjectData(projectKey) {
    return get().projects[projectKey] ?? createProjectData();
  },

  resolveSessionViews(projectKey, activeSessionId, floatingSessionId) {
    const data = get().projects[projectKey];
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

  async refreshAgents(projectKey, client) {
    set((state) => updateProjectData(state, projectKey, (project) => ({
      ...project,
      loading: true,
      error: null,
    })));

    try {
      const agents = await client.listAgents();
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        agents,
        loading: false,
        error: null,
      }), { createIfMissing: false }));
    } catch (err) {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        loading: false,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  async refreshSessions(projectKey, client) {
    set((state) => updateProjectData(state, projectKey, (project) => ({
      ...project,
      error: null,
    })));

    try {
      const agents = get().projects[projectKey]?.agents ?? [];
      const allSessions = await Promise.all(
        agents.map((agent) => client.listSessions(agent.id)),
      );
      const sessions = allSessions.flat();
      set((state) => updateProjectData(state, projectKey, (project) => ({
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
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  async createSession(projectKey, client, agentId, initialMessage) {
    set((state) => updateProjectData(state, projectKey, (project) => ({
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
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        sessions: [session, ...project.sessions.filter((item) => item.id !== sessionId)],
        initialMessageBySessionId: initialMessage
          ? { ...project.initialMessageBySessionId, [sessionId]: initialMessage }
          : project.initialMessageBySessionId,
        error: null,
      }), { createIfMissing: false }));
      void get().refreshSessions(projectKey, client);
      return session;
    } catch (err) {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
      return null;
    }
  },

  async deleteSession(projectKey, client, sessionId) {
    try {
      const project = get().projects[projectKey];
      const session = project?.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      await client.deleteSession(session.agentId, sessionId);
      set((state) => updateProjectData(state, projectKey, (project) => {
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
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  async renameSession(projectKey, client, sessionId, title) {
    try {
      const project = get().projects[projectKey];
      const session = project?.sessions.find((s) => s.id === sessionId);
      if (!session) return false;
      const updatedSession = await client.renameSession(session.agentId, sessionId, title);
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        sessions: project.sessions.map((session) =>
          session.id === sessionId ? updatedSession : session,
        ),
        error: null,
      }), { createIfMissing: false }));
      return true;
    } catch (err) {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
      return false;
    }
  },

  async createAgent(projectKey, client, slug, content, themeContent) {
    set((state) => updateProjectData(state, projectKey, (project) => ({
      ...project,
      error: null,
    })));

    try {
      await client.createAgent(slug, content, themeContent);
      await get().refreshAgents(projectKey, client);
      return true;
    } catch (err) {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
      return false;
    }
  },

  async updateAgent(projectKey, client, agentId, content, themeContent) {
    set((state) => updateProjectData(state, projectKey, (project) => ({
      ...project,
      error: null,
    })));

    try {
      await client.updateAgent(agentId, content, themeContent);
      await get().refreshAgents(projectKey, client);
      return true;
    } catch (err) {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
      return false;
    }
  },

  async deleteAgent(projectKey, client, agentId) {
    try {
      await client.deleteAgent(agentId);
      await get().refreshAgents(projectKey, client);
      await get().refreshSessions(projectKey, client);
    } catch (err) {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  setInitialMessage(projectKey, sessionId, message) {
    set((state) => updateProjectData(state, projectKey, (project) => ({
      ...project,
      initialMessageBySessionId: {
        ...project.initialMessageBySessionId,
        [sessionId]: message,
      },
    }), { createIfMissing: false }));
  },

  consumeInitialMessage(projectKey, sessionId) {
    const message = get().projects[projectKey]?.initialMessageBySessionId[sessionId];
    if (!message) return undefined;
    set((state) => updateProjectData(state, projectKey, (project) => {
      const { [sessionId]: _removed, ...initialMessageBySessionId } =
        project.initialMessageBySessionId;
      return {
        ...project,
        initialMessageBySessionId,
      };
    }));
    return message;
  },

  async refreshSchedules(projectKey, client, agentId) {
    try {
      const schedules = await client.listSchedules(agentId);
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        schedulesByAgent: { ...project.schedulesByAgent, [agentId]: schedules },
      }), { createIfMissing: false }));
    } catch (err) {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project, error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  async createSchedule(projectKey, client, agentId, data) {
    try {
      await client.createSchedule(agentId, data);
      await get().refreshSchedules(projectKey, client, agentId);
    } catch (err) {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project, error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  async updateSchedule(projectKey, client, agentId, scheduleId, data) {
    try {
      await client.updateSchedule(agentId, scheduleId, data);
      await get().refreshSchedules(projectKey, client, agentId);
    } catch (err) {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project, error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  async deleteSchedule(projectKey, client, agentId, scheduleId) {
    try {
      await client.deleteSchedule(agentId, scheduleId);
      await get().refreshSchedules(projectKey, client, agentId);
    } catch (err) {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project, error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  async triggerSchedule(projectKey, client, agentId, scheduleId) {
    set((state) => updateProjectData(state, projectKey, (project) =>
      addRunningSchedule(project, agentId, scheduleId), { createIfMissing: false }));
    try {
      await client.triggerSchedule(agentId, scheduleId);
    } catch (err) {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...removeRunningSchedule(project, agentId, scheduleId),
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
  },

  handleScheduleEvent(projectKey, client, event) {
    if (event.type === "schedule_triggered") {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...addRunningSchedule(project, event.agentId, event.scheduleId),
        scheduleEventVersion: project.scheduleEventVersion + 1,
      }), { createIfMissing: false }));
      return;
    }

    if (event.type === "schedule_completed" || event.type === "schedule_failed") {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...removeRunningSchedule(project, event.agentId, event.scheduleId),
        scheduleEventVersion: project.scheduleEventVersion + 1,
      }), { createIfMissing: false }));
      void get().refreshSchedules(projectKey, client, event.agentId);
      if (event.type === "schedule_completed") void get().refreshSessions(projectKey, client);
      return;
    }

    if (event.type === "schedule_updated") {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        scheduleEventVersion: project.scheduleEventVersion + 1,
      }), { createIfMissing: false }));
      void get().refreshSchedules(projectKey, client, event.agentId);
    }
  },

  clearProjectData(projectKey) {
    set((state) => {
      const { [projectKey]: _removed, ...projects } = state.projects;
      return { projects };
    });
  },
}));
