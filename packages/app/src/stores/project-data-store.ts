import { create } from "zustand";
import type { ApiClient } from "../lib/api";
import type { AgentProfile, SessionInfo } from "../lib/types";

interface ProjectData {
  agents: AgentProfile[];
  sessions: SessionInfo[];
  initialMessageBySessionId: Record<string, string>;
  loading: boolean;
  error: string | null;
}

interface ProjectDataStore {
  projects: Record<string, ProjectData>;
  getProjectData: (projectKey: string) => ProjectData;
  refreshAgents: (projectKey: string, client: ApiClient) => Promise<void>;
  refreshSessions: (projectKey: string, client: ApiClient) => Promise<void>;
  createSession: (
    projectKey: string,
    client: ApiClient,
    agentId: string,
    initialMessage?: string,
  ) => Promise<SessionInfo | null>;
  deleteSession: (projectKey: string, client: ApiClient, sessionId: string) => Promise<void>;
  createAgent: (projectKey: string, client: ApiClient, filename: string, content: string) => Promise<boolean>;
  updateAgent: (projectKey: string, client: ApiClient, agentId: string, content: string) => Promise<boolean>;
  deleteAgent: (projectKey: string, client: ApiClient, agentId: string) => Promise<void>;
  consumeInitialMessage: (projectKey: string, sessionId: string) => string | undefined;
  clearProjectData: (projectKey: string) => void;
}

function createProjectData(): ProjectData {
  return {
    agents: [],
    sessions: [],
    initialMessageBySessionId: {},
    loading: false,
    error: null,
  };
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "请求失败";
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
      const sessions = await client.listSessions();
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        sessions,
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
      await client.deleteSession(sessionId);
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

  async createAgent(projectKey, client, filename, content) {
    set((state) => updateProjectData(state, projectKey, (project) => ({
      ...project,
      error: null,
    })));

    try {
      await client.createAgent(filename, content);
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

  async updateAgent(projectKey, client, agentId, content) {
    set((state) => updateProjectData(state, projectKey, (project) => ({
      ...project,
      error: null,
    })));

    try {
      await client.updateAgent(agentId, content);
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
      await Promise.all([
        get().refreshAgents(projectKey, client),
        get().refreshSessions(projectKey, client),
      ]);
    } catch (err) {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
    }
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

  clearProjectData(projectKey) {
    set((state) => {
      const { [projectKey]: _removed, ...projects } = state.projects;
      return { projects };
    });
  },
}));
