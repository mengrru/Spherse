import { useQuery } from "@tanstack/react-query";
import { ApiError, type ApiClient } from "../../lib/api";
import { queryClient } from "../client";
import { projectQueryKeys } from "../keys";
import type { SessionInfo } from "../../lib/types";
import type { SessionListPageResponse } from "@spherse/contracts";
import { useProjectDataStore } from "../../stores/project-data-store";
import { ensureProjectAgents } from "./agents";
import { getProjectGeneration, isCurrentProjectGeneration } from "./lifecycle";

const SESSION_PAGE_SIZE = 10;
const EMPTY_SESSIONS: SessionInfo[] = [];
const EMPTY_SESSION_PAGING: Record<string, SessionPaging> = {};

interface SessionPaging {
  hasMore: boolean;
  offset: number;
  loadingMore: boolean;
}

interface SessionCatalog {
  sessions: SessionInfo[];
  paging: Record<string, SessionPaging>;
}

type SessionPage = Pick<SessionListPageResponse, "items" | "hasMore">;

function toPaging(byAgent: Record<string, { hasMore: boolean; loaded: number }>): Record<string, SessionPaging> {
  return Object.fromEntries(
    Object.entries(byAgent).map(([agentId, cursor]) => [
      agentId,
      { hasMore: cursor.hasMore, offset: cursor.loaded, loadingMore: false },
    ]),
  );
}

function upsertSessionStart(catalog: SessionCatalog | undefined, session: SessionInfo): SessionCatalog {
  return {
    sessions: [session, ...(catalog?.sessions ?? []).filter((item) => item.id !== session.id)],
    paging: catalog?.paging ?? {},
  };
}

function replaceSession(catalog: SessionCatalog, sessionId: string, updated: SessionInfo): SessionCatalog {
  return {
    ...catalog,
    sessions: catalog.sessions.map((item) => (item.id === sessionId ? updated : item)),
  };
}

function removeSession(catalog: SessionCatalog, session: SessionInfo): SessionCatalog {
  const paging = catalog.paging[session.agentId];
  return {
    ...catalog,
    sessions: catalog.sessions.filter((item) => item.id !== session.id),
    paging: paging
      ? { ...catalog.paging, [session.agentId]: { ...paging, offset: Math.max(0, paging.offset - 1) } }
      : catalog.paging,
  };
}

function setPagingLoadingMore(catalog: SessionCatalog, agentId: string, loadingMore: boolean): SessionCatalog {
  const paging = catalog.paging[agentId];
  if (!paging) return catalog;
  return { ...catalog, paging: { ...catalog.paging, [agentId]: { ...paging, loadingMore } } };
}

function appendSessionPage(
  catalog: SessionCatalog,
  agentId: string,
  page: SessionPage,
  previousOffset: number,
): SessionCatalog {
  const existingIds = new Set(catalog.sessions.map((session) => session.id));
  return {
    sessions: [...catalog.sessions, ...page.items.filter((session) => !existingIds.has(session.id))],
    paging: {
      ...catalog.paging,
      [agentId]: { hasMore: page.hasMore, offset: previousOffset + page.items.length, loadingMore: false },
    },
  };
}

export async function fetchProjectSessionCatalog(
  projectId: string,
  client: ApiClient,
): Promise<SessionCatalog> {
  const cached = queryClient.getQueryData<SessionCatalog>(projectQueryKeys.sessions(projectId));
  const result = await client.listProjectSessions({ perPage: SESSION_PAGE_SIZE });
  const initialMessages = useProjectDataStore.getState().projects[projectId]?.initialMessageBySessionId ?? {};
  const fetchedIds = new Set(result.sessions.map((session) => session.id));
  const optimistic = cached?.sessions.filter(
    (session) => initialMessages[session.id] && !fetchedIds.has(session.id),
  ) ?? [];
  return {
    sessions: [...optimistic, ...result.sessions],
    paging: toPaging(result.byAgent),
  };
}

export function useProjectSessions(projectId: string, client: ApiClient | null) {
  const sessionsQuery = useQuery({
    queryKey: projectQueryKeys.sessions(projectId),
    queryFn: () => fetchProjectSessionCatalog(projectId, client!),
    enabled: Boolean(projectId && client),
  });
  return {
    sessions: sessionsQuery.data?.sessions ?? EMPTY_SESSIONS,
    sessionPaging: sessionsQuery.data?.paging ?? EMPTY_SESSION_PAGING,
    loading: sessionsQuery.isPending,
    error: sessionsQuery.error,
  };
}

async function findProjectSession(
  projectId: string,
  client: ApiClient,
  sessionId: string,
): Promise<SessionInfo | null> {
  const cached = getCachedSession(projectId, sessionId);
  if (cached) {
    try {
      return await client.getSession(cached.agentId, cached.id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }
  const catalog = await client.listProjectSessions({ perPage: 100 });
  const direct = catalog.sessions.find((session) => session.id === sessionId);
  if (direct) return direct;
  const agents = await ensureProjectAgents(projectId, client);
  const probes = await Promise.allSettled(
    agents.map((agent) => client.getSession(agent.id, sessionId)),
  );
  for (const probe of probes) {
    if (probe.status === "fulfilled") return probe.value;
  }
  return null;
}

export function useProjectSession(
  projectId: string,
  client: ApiClient,
  sessionId: string | null | undefined,
) {
  return useQuery({
    queryKey: projectQueryKeys.session(projectId, sessionId ?? ""),
    queryFn: () => findProjectSession(projectId, client, sessionId ?? ""),
    enabled: Boolean(sessionId),
  });
}

export async function ensureProjectSession(
  projectId: string,
  client: ApiClient | null,
  sessionId: string,
): Promise<SessionInfo | null> {
  if (!client) return getCachedSession(projectId, sessionId) ?? null;
  return queryClient.ensureQueryData({
    queryKey: projectQueryKeys.session(projectId, sessionId),
    queryFn: () => findProjectSession(projectId, client, sessionId),
  });
}

function getCachedSessions(projectId: string): SessionInfo[] {
  return queryClient.getQueryData<SessionCatalog>(projectQueryKeys.sessions(projectId))?.sessions ?? EMPTY_SESSIONS;
}

export function getCachedSession(projectId: string, sessionId: string): SessionInfo | undefined {
  return queryClient.getQueryData<SessionInfo>(projectQueryKeys.session(projectId, sessionId))
    ?? getCachedSessions(projectId).find((session) => session.id === sessionId);
}

export async function refreshProjectSessions(projectId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: projectQueryKeys.sessions(projectId) }),
    queryClient.invalidateQueries({ queryKey: ["projects", projectId, "session"] }),
  ]);
}

export async function loadMoreProjectSessions(
  projectId: string,
  client: ApiClient,
  agentId: string,
): Promise<void> {
  const generation = getProjectGeneration(projectId);
  const key = projectQueryKeys.sessions(projectId);
  const current = queryClient.getQueryData<SessionCatalog>(key);
  const paging = current?.paging[agentId];
  if (!current || !paging?.hasMore || paging.loadingMore) return;

  queryClient.setQueryData<SessionCatalog>(key, (catalog) =>
    catalog ? setPagingLoadingMore(catalog, agentId, true) : catalog);
  try {
    const page = await client.listSessionsPage(agentId, {
      limit: SESSION_PAGE_SIZE,
      offset: paging.offset,
    });
    if (!isCurrentProjectGeneration(projectId, generation)) return;
    queryClient.setQueryData<SessionCatalog>(key, (catalog) =>
      catalog ? appendSessionPage(catalog, agentId, page, paging.offset) : catalog);
  } catch {
    if (!isCurrentProjectGeneration(projectId, generation)) return;
    queryClient.setQueryData<SessionCatalog>(key, (catalog) =>
      catalog ? setPagingLoadingMore(catalog, agentId, false) : catalog);
  }
}

export async function createProjectSession(
  projectId: string,
  client: ApiClient,
  agentId: string,
  initialMessage?: string,
  title?: string,
): Promise<SessionInfo> {
  const generation = getProjectGeneration(projectId);
  const { sessionId } = await client.createSession(agentId, title);
  if (!sessionId) throw new Error("sessionId is required");
  const session: SessionInfo = {
    id: sessionId,
    agentId,
    ...(title ? { title } : {}),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "active",
  };
  if (!isCurrentProjectGeneration(projectId, generation)) return session;
  queryClient.setQueryData<SessionCatalog>(projectQueryKeys.sessions(projectId), (catalog) =>
    upsertSessionStart(catalog, session));
  queryClient.setQueryData(projectQueryKeys.session(projectId, session.id), session);
  if (initialMessage) {
    useProjectDataStore.getState().setInitialMessage(projectId, session.id, initialMessage);
  }
  return session;
}

export async function renameProjectSession(
  projectId: string,
  client: ApiClient,
  session: SessionInfo,
  title: string,
): Promise<SessionInfo> {
  const generation = getProjectGeneration(projectId);
  const updated = await client.renameSession(session.agentId, session.id, title);
  if (!isCurrentProjectGeneration(projectId, generation)) return updated;
  queryClient.setQueryData<SessionCatalog>(projectQueryKeys.sessions(projectId), (catalog) =>
    catalog ? replaceSession(catalog, session.id, updated) : catalog);
  queryClient.setQueryData(projectQueryKeys.session(projectId, session.id), updated);
  return updated;
}

export async function deleteProjectSession(
  projectId: string,
  client: ApiClient,
  session: SessionInfo,
): Promise<void> {
  const generation = getProjectGeneration(projectId);
  await client.deleteSession(session.agentId, session.id);
  if (!isCurrentProjectGeneration(projectId, generation)) return;
  queryClient.setQueryData<SessionCatalog>(projectQueryKeys.sessions(projectId), (catalog) =>
    catalog ? removeSession(catalog, session) : catalog);
  queryClient.removeQueries({ queryKey: projectQueryKeys.session(projectId, session.id) });
  useProjectDataStore.getState().clearInitialMessage(projectId, session.id);
}
