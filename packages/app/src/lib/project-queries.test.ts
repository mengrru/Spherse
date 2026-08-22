import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "./api";
import {
  clearProjectQueries,
  createProjectSession,
  deleteProjectSession,
  fetchProjectSessionCatalog,
  getCachedSession,
  loadMoreProjectSessions,
  renameProjectSession,
  ensureProjectSession,
} from "./project-queries";
import { projectQueryKeys, queryClient } from "./query-client";
import type { SessionInfo } from "./types";

function session(id: string): SessionInfo {
  return {
    id,
    agentId: "agent-1",
    createdAt: 1,
    updatedAt: 1,
    status: "active",
  };
}

describe("project queries", () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it("caches created and renamed sessions", async () => {
    const renamed = { ...session("session-1"), title: "Renamed" };
    const client = {
      createSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
      renameSession: vi.fn().mockResolvedValue(renamed),
    } as unknown as ApiClient;

    const created = await createProjectSession("project-1", client, "agent-1", undefined, "Title");
    expect(getCachedSession("project-1", "session-1")?.title).toBe("Title");

    await renameProjectSession("project-1", client, created, "Renamed");
    expect(getCachedSession("project-1", "session-1")?.title).toBe("Renamed");
  });

  it("loads and deduplicates another session page", async () => {
    queryClient.setQueryData(projectQueryKeys.sessions("project-1"), {
      sessions: [session("session-1")],
      paging: { "agent-1": { hasMore: true, offset: 1, loadingMore: false } },
    });
    const client = {
      listSessionsPage: vi.fn().mockResolvedValue({
        items: [session("session-1"), session("session-2")],
        hasMore: false,
      }),
    } as unknown as ApiClient;

    await loadMoreProjectSessions("project-1", client, "agent-1");

    expect(getCachedSession("project-1", "session-2")?.id).toBe("session-2");
    expect(client.listSessionsPage).toHaveBeenCalledWith("agent-1", { limit: 10, offset: 1 });
  });

  it("refreshes the loaded prefix so deleted sessions do not survive or shift the next offset", async () => {
    queryClient.setQueryData(projectQueryKeys.sessions("project-1"), {
      sessions: [session("session-1"), session("session-2"), session("session-3")],
      paging: { "agent-1": { hasMore: true, offset: 3, loadingMore: false } },
    });
    const client = {
      listSessionsPage: vi.fn().mockResolvedValue({
        items: [session("session-2"), session("session-3"), session("session-4")],
        hasMore: true,
      }),
    } as unknown as ApiClient;

    const catalog = await fetchProjectSessionCatalog(
      "project-1",
      client,
      [{ id: "agent-1" } as never],
    );
    queryClient.setQueryData(projectQueryKeys.sessions("project-1"), catalog);

    expect(catalog.sessions.map((item) => item.id)).toEqual(["session-2", "session-3", "session-4"]);
    expect(client.listSessionsPage).toHaveBeenCalledWith("agent-1", { limit: 10, offset: 0 });
    expect(catalog.paging["agent-1"].offset).toBe(3);
  });

  it("deletes a provided session without relying on a paginated lookup", async () => {
    const target = session("session-20");
    const client = { deleteSession: vi.fn().mockResolvedValue({ ok: true }) } as unknown as ApiClient;
    queryClient.setQueryData(projectQueryKeys.sessions("project-1"), {
      sessions: [target],
      paging: { "agent-1": { hasMore: true, offset: 20, loadingMore: false } },
    });

    await deleteProjectSession("project-1", client, target);

    expect(client.deleteSession).toHaveBeenCalledWith("agent-1", "session-20");
    expect(queryClient.getQueryData<{ paging: Record<string, { offset: number }> }>(
      projectQueryKeys.sessions("project-1"),
    )?.paging["agent-1"].offset).toBe(19);
  });

  it("removes only the closed project cache", () => {
    queryClient.setQueryData(projectQueryKeys.agents("project-1"), []);
    queryClient.setQueryData(projectQueryKeys.agents("project-2"), []);

    clearProjectQueries("project-1");

    expect(queryClient.getQueryData(projectQueryKeys.agents("project-1"))).toBeUndefined();
    expect(queryClient.getQueryData(projectQueryKeys.agents("project-2"))).toEqual([]);
  });

  it("does not recreate project cache when a mutation resolves after close", async () => {
    let resolveCreate!: (value: { sessionId: string }) => void;
    const client = {
      createSession: vi.fn().mockReturnValue(new Promise((resolve) => {
        resolveCreate = resolve;
      })),
    } as unknown as ApiClient;

    const create = createProjectSession("project-1", client, "agent-1");
    clearProjectQueries("project-1");
    resolveCreate({ sessionId: "session-late" });
    await create;

    expect(queryClient.getQueryData(projectQueryKeys.sessions("project-1"))).toBeUndefined();
    expect(queryClient.getQueryData(projectQueryKeys.session("project-1", "session-late"))).toBeUndefined();
  });

  it("does not treat transient session lookup failures as not found", async () => {
    const target = session("session-1");
    queryClient.setQueryData(projectQueryKeys.sessions("project-1"), {
      sessions: [target],
      paging: { "agent-1": { hasMore: false, offset: 1, loadingMore: false } },
    });
    const client = {
      getSession: vi.fn().mockRejectedValue(new ApiError("unavailable", 503)),
    } as unknown as ApiClient;

    await expect(ensureProjectSession("project-1", client, target.id)).rejects.toThrow("unavailable");
  });
});
