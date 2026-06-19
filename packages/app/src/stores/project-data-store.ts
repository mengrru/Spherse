import { create } from "zustand";
import type { ApiClient } from "../lib/api";
import type { AgentProfile, SessionInfo } from "../lib/types";

interface ProjectData {
  agents: AgentProfile[];
  sessions: SessionInfo[];
  initialMessageBySessionId: Record<string, string>;
  streamingSessionIds: Set<string>;
  loading: boolean;
  error: string | null;
}

interface ProjectDataStore {
  projects: Record<string, ProjectData>;
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
  setStreaming: (projectId: string, sessionId: string, streaming: boolean) => void;
  clearProjectData: (projectId: string) => void;
}

function createProjectData(): ProjectData {
  return {
    agents: [],
    sessions: [],
    initialMessageBySessionId: {},
    streamingSessionIds: new Set(),
    loading: false,
    error: null,
  };
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "";
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

  setStreaming(projectId, sessionId, streaming) {
    set((state) => {
      const project = state.projects[projectId];
      if (!project) return state;
      const current = project.streamingSessionIds;
      const next = new Set(current);
      if (streaming) {
        next.add(sessionId);
      } else {
        next.delete(sessionId);
      }
      if (next.size === current.size && (streaming === current.has(sessionId))) return state;
      return updateProjectData(state, projectId, (p) => ({
        ...p,
        streamingSessionIds: next,
      }));
    });
  },

  clearProjectData(projectId) {
    set((state) => {
      const { [projectId]: _removed, ...projects } = state.projects;
      return { projects };
    });
  },
}));
