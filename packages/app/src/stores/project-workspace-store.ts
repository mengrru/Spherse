import { create } from "zustand";
import type { AgentProfile, SessionInfo } from "../lib/types";
import { useAppStore } from "./app-store";

interface ProjectWorkspace {
  agents: AgentProfile[];
  sessions: SessionInfo[];
  collapsedAgentIds: Set<string>;
  initialMessageBySessionId: Record<string, string>;
  lastContentPath: string | null;
  activeSessionId: string | null;
  loading: boolean;
  error: string | null;
}

interface ProjectWorkspaceStore {
  workspaces: Record<string, ProjectWorkspace>;
  getWorkspace: (projectKey: string) => ProjectWorkspace;
  refreshAgents: (projectKey: string) => Promise<void>;
  refreshSessions: (projectKey: string) => Promise<void>;
  createSession: (
    projectKey: string,
    agentId: string,
    initialMessage?: string,
  ) => Promise<SessionInfo | null>;
  deleteSession: (projectKey: string, sessionId: string) => Promise<void>;
  deleteAgent: (projectKey: string, agentId: string) => Promise<void>;
  setActiveSession: (projectKey: string, sessionId: string | null) => void;
  consumeInitialMessage: (projectKey: string, sessionId: string) => string | undefined;
  rememberContentPath: (projectKey: string, filePath: string | null) => void;
  toggleAgentCollapsed: (projectKey: string, agentId: string) => void;
  clearProject: (projectKey: string) => void;
}

function createWorkspace(): ProjectWorkspace {
  return {
    agents: [],
    sessions: [],
    collapsedAgentIds: new Set(),
    initialMessageBySessionId: {},
    lastContentPath: null,
    activeSessionId: null,
    loading: false,
    error: null,
  };
}

function getClient(projectKey: string) {
  return useAppStore.getState().projects.get(projectKey)?.ctx.client ?? null;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "请求失败";
}

function updateWorkspace(
  state: ProjectWorkspaceStore,
  projectKey: string,
  update: (workspace: ProjectWorkspace) => ProjectWorkspace,
) {
  const current = state.workspaces[projectKey] ?? createWorkspace();
  return {
    workspaces: {
      ...state.workspaces,
      [projectKey]: update(current),
    },
  };
}

export const useProjectWorkspaceStore = create<ProjectWorkspaceStore>((set, get) => ({
  workspaces: {},

  getWorkspace(projectKey) {
    return get().workspaces[projectKey] ?? createWorkspace();
  },

  async refreshAgents(projectKey) {
    const client = getClient(projectKey);
    if (!client) return;

    set((state) => updateWorkspace(state, projectKey, (workspace) => ({
      ...workspace,
      loading: true,
      error: null,
    })));

    try {
      const agents = await client.listAgents();
      set((state) => updateWorkspace(state, projectKey, (workspace) => {
        const knownCollapsed = workspace.collapsedAgentIds;
        const collapsedAgentIds =
          knownCollapsed.size === 0
            ? new Set(agents.slice(1).map((agent) => agent.id))
            : new Set([...knownCollapsed].filter((id) => agents.some((agent) => agent.id === id)));
        return {
          ...workspace,
          agents,
          collapsedAgentIds,
          loading: false,
          error: null,
        };
      }));
    } catch (err) {
      set((state) => updateWorkspace(state, projectKey, (workspace) => ({
        ...workspace,
        loading: false,
        error: getErrorMessage(err),
      })));
    }
  },

  async refreshSessions(projectKey) {
    const client = getClient(projectKey);
    if (!client) return;

    try {
      const sessions = await client.listSessions();
      set((state) => updateWorkspace(state, projectKey, (workspace) => ({
        ...workspace,
        sessions,
        error: null,
      })));
    } catch (err) {
      set((state) => updateWorkspace(state, projectKey, (workspace) => ({
        ...workspace,
        error: getErrorMessage(err),
      })));
    }
  },

  async createSession(projectKey, agentId, initialMessage) {
    const client = getClient(projectKey);
    if (!client) return null;

    try {
      const { sessionId } = await client.createSession(agentId);
      const session: SessionInfo = {
        id: sessionId,
        agentId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "active",
      };
      set((state) => updateWorkspace(state, projectKey, (workspace) => ({
        ...workspace,
        sessions: [session, ...workspace.sessions.filter((item) => item.id !== sessionId)],
        activeSessionId: sessionId,
        initialMessageBySessionId: initialMessage
          ? { ...workspace.initialMessageBySessionId, [sessionId]: initialMessage }
          : workspace.initialMessageBySessionId,
        error: null,
      })));
      void get().refreshSessions(projectKey);
      return session;
    } catch (err) {
      set((state) => updateWorkspace(state, projectKey, (workspace) => ({
        ...workspace,
        error: getErrorMessage(err),
      })));
      return null;
    }
  },

  async deleteSession(projectKey, sessionId) {
    const client = getClient(projectKey);
    if (!client) return;

    try {
      await client.deleteSession(sessionId);
      set((state) => updateWorkspace(state, projectKey, (workspace) => {
        const { [sessionId]: _removed, ...initialMessageBySessionId } =
          workspace.initialMessageBySessionId;
        return {
          ...workspace,
          sessions: workspace.sessions.filter((session) => session.id !== sessionId),
          activeSessionId:
            workspace.activeSessionId === sessionId ? null : workspace.activeSessionId,
          initialMessageBySessionId,
          error: null,
        };
      }));
    } catch (err) {
      set((state) => updateWorkspace(state, projectKey, (workspace) => ({
        ...workspace,
        error: getErrorMessage(err),
      })));
    }
  },

  async deleteAgent(projectKey, agentId) {
    const client = getClient(projectKey);
    if (!client) return;

    try {
      await client.deleteAgent(agentId);
      await Promise.all([
        get().refreshAgents(projectKey),
        get().refreshSessions(projectKey),
      ]);
    } catch (err) {
      set((state) => updateWorkspace(state, projectKey, (workspace) => ({
        ...workspace,
        error: getErrorMessage(err),
      })));
    }
  },

  setActiveSession(projectKey, sessionId) {
    set((state) => updateWorkspace(state, projectKey, (workspace) => ({
      ...workspace,
      activeSessionId: sessionId,
    })));
  },

  consumeInitialMessage(projectKey, sessionId) {
    const message = get().workspaces[projectKey]?.initialMessageBySessionId[sessionId];
    if (!message) return undefined;
    set((state) => updateWorkspace(state, projectKey, (workspace) => {
      const { [sessionId]: _removed, ...initialMessageBySessionId } =
        workspace.initialMessageBySessionId;
      return {
        ...workspace,
        initialMessageBySessionId,
      };
    }));
    return message;
  },

  rememberContentPath(projectKey, filePath) {
    set((state) => updateWorkspace(state, projectKey, (workspace) => ({
      ...workspace,
      lastContentPath: filePath,
    })));
  },

  toggleAgentCollapsed(projectKey, agentId) {
    set((state) => updateWorkspace(state, projectKey, (workspace) => {
      const collapsedAgentIds = new Set(workspace.collapsedAgentIds);
      if (collapsedAgentIds.has(agentId)) {
        collapsedAgentIds.delete(agentId);
      } else {
        collapsedAgentIds.add(agentId);
      }
      return {
        ...workspace,
        collapsedAgentIds,
      };
    }));
  },

  clearProject(projectKey) {
    set((state) => {
      const { [projectKey]: _removed, ...workspaces } = state.workspaces;
      return { workspaces };
    });
  },
}));
