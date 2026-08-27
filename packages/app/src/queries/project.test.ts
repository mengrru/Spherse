import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "../lib/api";
import {
  clearProjectQueries,
  createProjectSession,
  deleteProjectSession,
  fetchProjectSessionCatalog,
  getCachedSession,
  loadMoreProjectSessions,
  renameProjectSession,
  ensureProjectSession,
} from "./project";
import { queryClient } from "./client";
import { projectQueryKeys } from "./keys";
import type { SessionInfo } from "../lib/types";

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

  it("fetches the catalog with a single project-level call and maps byAgent into paging", async () => {
    const client = {
      listProjectSessions: vi.fn().mockResolvedValue({
        ok: true,
        sessions: [session("session-1"), session("session-2")],
        byAgent: {
          "agent-1": { hasMore: true, loaded: 2 },
          "agent-2": { hasMore: false, loaded: 0 },
        },
      }),
    } as unknown as ApiClient;

    const catalog = await fetchProjectSessionCatalog("project-1", client);

    expect(client.listProjectSessions).toHaveBeenCalledTimes(1);
    expect(client.listProjectSessions).toHaveBeenCalledWith({ perPage: 10 });
    expect(catalog.sessions.map((item) => item.id)).toEqual(["session-1", "session-2"]);
    expect(catalog.paging["agent-1"]).toEqual({ hasMore: true, offset: 2, loadingMore: false });
  });

  it("omits agents without sessions from the paging map", async () => {
    const client = {
      listProjectSessions: vi.fn().mockResolvedValue({
        ok: true,
        sessions: [session("session-1")],
        byAgent: { "agent-1": { hasMore: false, loaded: 1 } },
      }),
    } as unknown as ApiClient;

    const catalog = await fetchProjectSessionCatalog("project-1", client);

    expect(catalog.paging).toEqual({ "agent-1": { hasMore: false, offset: 1, loadingMore: false } });
  });

  it("preserves optimistic sessions that carry an unsent initial message", async () => {
    queryClient.setQueryData(projectQueryKeys.sessions("project-1"), {
      sessions: [session("session-optimistic")],
      paging: {},
    });
    const { useProjectDataStore } = await import("../stores/project-data-store");
    useProjectDataStore.getState().setInitialMessage("project-1", "session-optimistic", "hello");
    const client = {
      listProjectSessions: vi.fn().mockResolvedValue({
        ok: true,
        sessions: [session("session-1")],
        byAgent: { "agent-1": { hasMore: false, loaded: 1 } },
      }),
    } as unknown as ApiClient;

    const catalog = await fetchProjectSessionCatalog("project-1", client);

    const ids = catalog.sessions.map((item) => item.id);
    expect(ids).toContain("session-optimistic");
    expect(ids).toContain("session-1");
    useProjectDataStore.getState().clearInitialMessage("project-1", "session-optimistic");
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

  it("resets loadingMore and keeps paging intact when loading another page fails", async () => {
    queryClient.setQueryData(projectQueryKeys.sessions("project-1"), {
      sessions: [session("session-1")],
      paging: { "agent-1": { hasMore: true, offset: 1, loadingMore: false } },
    });
    const client = {
      listSessionsPage: vi.fn().mockRejectedValue(new Error("network down")),
    } as unknown as ApiClient;

    await loadMoreProjectSessions("project-1", client, "agent-1");

    expect(
      queryClient.getQueryData<{ paging: Record<string, { hasMore: boolean; offset: number; loadingMore: boolean }> }>(
        projectQueryKeys.sessions("project-1"),
      )?.paging["agent-1"],
    ).toEqual({ hasMore: true, offset: 1, loadingMore: false });
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

  it("finds an uncached session via a single project-level lookup", async () => {
    const target = { ...session("session-deep"), agentId: "agent-9" };
    const client = {
      listProjectSessions: vi.fn().mockResolvedValue({
        ok: true,
        sessions: [target],
        byAgent: { "agent-9": { hasMore: false, loaded: 1 } },
      }),
      getSession: vi.fn().mockResolvedValue(target),
    } as unknown as ApiClient;

    const found = await ensureProjectSession("project-1", client, "session-deep");

    expect(found?.id).toBe("session-deep");
    expect(client.listProjectSessions).toHaveBeenCalledWith({ perPage: 100 });
  });

  it("returns null when the project-level lookup cannot find the session", async () => {
    const client = {
      listProjectSessions: vi.fn().mockResolvedValue({
        ok: true,
        sessions: [],
        byAgent: {},
      }),
      listAgents: vi.fn().mockResolvedValue([]),
    } as unknown as ApiClient;

    const found = await ensureProjectSession("project-1", client, "session-missing");

    expect(found).toBeNull();
  });

  it("falls back to per-agent probes when the session lives beyond the first 100", async () => {
    const target = { ...session("session-deep"), agentId: "agent-9" };
    const client = {
      listProjectSessions: vi.fn().mockResolvedValue({
        ok: true,
        sessions: [],
        byAgent: {},
      }),
      listAgents: vi.fn().mockResolvedValue([{ id: "agent-1" }, { id: "agent-9" }]),
      getSession: vi.fn((agentId: string) =>
        agentId === "agent-9"
          ? Promise.resolve(target)
          : Promise.reject(new ApiError("not found", 404)),
      ),
    } as unknown as ApiClient;

    const found = await ensureProjectSession("project-1", client, "session-deep");

    expect(found?.id).toBe("session-deep");
    expect(client.getSession).toHaveBeenCalledTimes(2);
  });
});
