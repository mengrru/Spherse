import { create } from "zustand";
import { translate } from "@spherse/i18n";
import type { ApiClient } from "../lib/api";
import type { AgentProfile, SessionInfo } from "../lib/types";
import { useSettingsStore } from "../features/settings/store";

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
  renameSession: (projectKey: string, client: ApiClient, sessionId: string, title: string) => Promise<boolean>;
  createAgent: (projectKey: string, client: ApiClient, slug: string, content: string, themeContent?: string) => Promise<boolean>;
  updateAgent: (projectKey: string, client: ApiClient, agentId: string, content: string, themeContent?: string) => Promise<boolean>;
  deleteAgent: (projectKey: string, client: ApiClient, agentId: string) => Promise<void>;
  setInitialMessage: (projectKey: string, sessionId: string, message: string) => void;
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

  async renameSession(projectKey, client, sessionId, title) {
    try {
      const updatedSession = await client.renameSession(sessionId, title);
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

  clearProjectData(projectKey) {
    set((state) => {
      const { [projectKey]: _removed, ...projects } = state.projects;
      return { projects };
    });
  },
}));
