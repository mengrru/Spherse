import { create } from "zustand";
import type { ApiClient } from "../lib/api";
import type { AgentProfile, SessionInfo } from "../lib/types";

interface SessionPaging {
  hasMore: boolean;
  offset: number;
  loadingMore: boolean;
}

interface ProjectData {
  agents: AgentProfile[];
  sessions: SessionInfo[];
  sessionPaging: Record<string, SessionPaging>;
  initialMessageBySessionId: Record<string, string>;
  streamingSessionIds: Set<string>;
  loading: boolean;
  error: string | null;
  hasEnabledTriggersByAgent: Record<string, boolean>;
}

interface ProjectDataStore {
  projects: Record<string, ProjectData>;
  refreshAgents: (projectId: string, client: ApiClient) => Promise<void>;
  refreshSessions: (projectId: string, client: ApiClient, options?: { mode?: "replace" | "upsert" }) => Promise<void>;
  loadMoreSessions: (projectId: string, client: ApiClient, agentId: string) => Promise<void>;
  createSession: (
    projectId: string,
    client: ApiClient,
    agentId: string,
    initialMessage?: string,
    title?: string,
  ) => Promise<SessionInfo | null>;
  deleteSession: (projectId: string, client: ApiClient, sessionId: string) => Promise<void>;
  renameSession: (projectId: string, client: ApiClient, sessionId: string, title: string) => Promise<boolean>;
  createAgent: (projectId: string, client: ApiClient, slug: string, content: string, themeContent?: string) => Promise<boolean>;
  updateAgent: (projectId: string, client: ApiClient, agentId: string, content: string, themeContent?: string) => Promise<boolean>;
  deleteAgent: (projectId: string, client: ApiClient, agentId: string) => Promise<void>;
  setInitialMessage: (projectId: string, sessionId: string, message: string) => void;
  consumeInitialMessage: (projectId: string, sessionId: string) => string | undefined;
  setStreaming: (projectId: string, sessionId: string, streaming: boolean) => void;
  setHasEnabledTriggers: (projectId: string, agentId: string, has: boolean) => void;
  clearProjectData: (projectId: string) => void;
}

function createProjectData(): ProjectData {
  return {
    agents: [],
    sessions: [],
    sessionPaging: {},
    initialMessageBySessionId: {},
    streamingSessionIds: new Set(),
    loading: false,
    error: null,
    hasEnabledTriggersByAgent: {},
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

export const useProjectDataStore = create<ProjectDataStore>((set, get) => {
  function clearRequestError(projectId: string) {
    set((state) => updateProjectData(state, projectId, (project) => ({
      ...project,
      error: null,
    })));
  }

  function handleRequestError(projectId: string, err: unknown) {
    set((state) => updateProjectData(state, projectId, (project) => ({
      ...project,
      error: getErrorMessage(err),
    }), { createIfMissing: false }));
  }

  return {
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

  /**
   * Re-reads the first page of sessions for every agent.
   *
   * mode "replace" (default): the fetched page becomes the whole list — used
   * by the `agent_updated` event path where a full re-sync (including removal
   * of deleted sessions) is wanted.
   *
   * mode "upsert": fetched sessions are merged into the existing list and
   * locally paginated entries (loaded via loadMoreSessions) are preserved —
   * used by the connection-recovered path so a reconnect does not truncate a
   * list the user has scrolled deeper into. Sessions deleted while
   * disconnected stay until the next "replace" refresh or app restart.
   */
  async refreshSessions(projectId, client, options) {
    const mode = options?.mode ?? "replace";
    clearRequestError(projectId);

    try {
      const agents = get().projects[projectId]?.agents ?? [];
      const pages = await Promise.all(
        agents.map(async (agent) => {
          const page = await client.listSessionsPage(agent.id, { limit: 10, offset: 0 });
          return { agent, page };
        }),
      );
      const fetched = pages.flatMap(({ page }) => page.items);
      const sessionPaging: Record<string, SessionPaging> = {};
      for (const { agent, page } of pages) {
        sessionPaging[agent.id] = { hasMore: page.hasMore, offset: page.items.length, loadingMore: false };
      }
      set((state) => updateProjectData(state, projectId, (project) => {
        if (mode === "upsert") {
          const fetchedIds = new Set(fetched.map((s) => s.id));
          // Prepend the fresh first page (newest), keep local-only entries
          // (deeper pages / optimistic creates) after it in their order.
          const kept = project.sessions.filter((s) => !fetchedIds.has(s.id));
          const merged = [...fetched, ...kept];
          const existingPaging = project.sessionPaging;
          const mergedPaging: Record<string, SessionPaging> = {};
          for (const [agentId, paging] of Object.entries(sessionPaging)) {
            // Preserve the deeper offset the user already loaded for this agent.
            const current = existingPaging[agentId];
            mergedPaging[agentId] = current && current.offset > paging.offset
              ? { hasMore: paging.hasMore, offset: current.offset, loadingMore: false }
              : paging;
          }
          return {
            ...project,
            sessions: merged,
            sessionPaging: mergedPaging,
            error: null,
          };
        }
        return {
          ...project,
          sessions: [
            ...project.sessions.filter((session) =>
              project.initialMessageBySessionId[session.id] &&
              !fetched.some((item) => item.id === session.id),
            ),
            ...fetched,
          ],
          sessionPaging,
          error: null,
        };
      }, { createIfMissing: false }));
    } catch (err) {
      handleRequestError(projectId, err);
    }
  },

  async loadMoreSessions(projectId, client, agentId) {
    const paging = get().projects[projectId]?.sessionPaging[agentId];
    if (!paging || !paging.hasMore || paging.loadingMore) return;
    clearRequestError(projectId);
    set((state) => updateProjectData(state, projectId, (project) => ({
      ...project,
      sessionPaging: {
        ...project.sessionPaging,
        [agentId]: { ...project.sessionPaging[agentId], loadingMore: true },
      },
    }), { createIfMissing: false }));

    try {
      const result = await client.listSessionsPage(agentId, { limit: 10, offset: paging.offset });
      set((state) => updateProjectData(state, projectId, (project) => {
        const existingIds = new Set(project.sessions.map((s) => s.id));
        const newItems = result.items.filter((item) => !existingIds.has(item.id));
        return {
          ...project,
          sessions: [...project.sessions, ...newItems],
          sessionPaging: {
            ...project.sessionPaging,
            [agentId]: { hasMore: result.hasMore, offset: paging.offset + result.items.length, loadingMore: false },
          },
          error: null,
        };
      }, { createIfMissing: false }));
    } catch (err) {
      set((state) => updateProjectData(state, projectId, (project) => ({
        ...project,
        sessionPaging: {
          ...project.sessionPaging,
          [agentId]: { ...project.sessionPaging[agentId], loadingMore: false },
        },
      }), { createIfMissing: false }));
      handleRequestError(projectId, err);
    }
  },

  async createSession(projectId, client, agentId, initialMessage, title) {
    clearRequestError(projectId);

    try {
      const { sessionId } = await client.createSession(agentId, title);
      if (typeof sessionId !== "string" || !sessionId) {
        throw new Error("sessionId is required");
      }
      const session: SessionInfo = {
        id: sessionId,
        agentId,
        ...(title ? { title } : {}),
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
      handleRequestError(projectId, err);
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
      handleRequestError(projectId, err);
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
      handleRequestError(projectId, err);
      return false;
    }
  },

  async createAgent(projectId, client, slugBase, content, themeContent) {
    clearRequestError(projectId);

    try {
      await client.createAgent(slugBase, content, themeContent);
      await get().refreshAgents(projectId, client);
      return true;
    } catch (err) {
      handleRequestError(projectId, err);
      return false;
    }
  },

  async updateAgent(projectId, client, agentId, content, themeContent) {
    clearRequestError(projectId);

    try {
      await client.updateAgent(agentId, content, themeContent);
      await get().refreshAgents(projectId, client);
      return true;
    } catch (err) {
      handleRequestError(projectId, err);
      return false;
    }
  },

  async deleteAgent(projectId, client, agentId) {
    try {
      await client.deleteAgent(agentId);
      await get().refreshAgents(projectId, client);
      await get().refreshSessions(projectId, client);
    } catch (err) {
      handleRequestError(projectId, err);
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

  setHasEnabledTriggers(projectId, agentId, has) {
    set((state) => updateProjectData(state, projectId, (project) => ({
      ...project,
      hasEnabledTriggersByAgent: {
        ...project.hasEnabledTriggersByAgent,
        [agentId]: has,
      },
    })));
  },

  clearProjectData(projectId) {
    set((state) => {
      const { [projectId]: _removed, ...projects } = state.projects;
      return { projects };
    });
  },
  };
});
