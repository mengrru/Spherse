import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api";
import {
  clearProjectQueries,
  createProjectSession,
  deleteProjectSession,
  getCachedSession,
  loadMoreProjectSessions,
  renameProjectSession,
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

  it("deletes a provided session without relying on a paginated lookup", async () => {
    const target = session("session-20");
    const client = { deleteSession: vi.fn().mockResolvedValue({ ok: true }) } as unknown as ApiClient;

    await deleteProjectSession("project-1", client, target);

    expect(client.deleteSession).toHaveBeenCalledWith("agent-1", "session-20");
  });

  it("removes only the closed project cache", () => {
    queryClient.setQueryData(projectQueryKeys.agents("project-1"), []);
    queryClient.setQueryData(projectQueryKeys.agents("project-2"), []);

    clearProjectQueries("project-1");

    expect(queryClient.getQueryData(projectQueryKeys.agents("project-1"))).toBeUndefined();
    expect(queryClient.getQueryData(projectQueryKeys.agents("project-2"))).toEqual([]);
  });
});
