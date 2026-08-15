import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../lib/api";
import type { AgentProfile, SessionInfo } from "../lib/types";
import { useProjectDataStore } from "./project-data-store";

function createAgent(id: string): AgentProfile {
  return {
    id,
    name: id,
    slug: id,
    createdAt: 1,
    systemPrompt: "test",
    filePath: `${id}/profile.md`,
  };
}

function createSession(id: string, agentId = "agent-1"): SessionInfo {
  return {
    id,
    agentId,
    createdAt: 1,
    updatedAt: 1,
    status: "active",
  };
}

function createClient(overrides: Partial<ApiClient>): ApiClient {
  return {
    listAgents: vi.fn().mockResolvedValue([]),
    getAgent: vi.fn(),
    createSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
    getSession: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
    listSessionsPage: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    getSessionMessages: vi.fn().mockResolvedValue([]),
    listContent: vi.fn().mockResolvedValue([]),
    getContent: vi.fn().mockResolvedValue(null),
    saveContent: vi.fn().mockResolvedValue({ ok: true }),
    deleteContent: vi.fn().mockResolvedValue({ ok: true }),
    createAgent: vi.fn().mockResolvedValue({ ok: true, id: "agent-1" }),
    getAgentRaw: vi.fn().mockResolvedValue(""),
    updateAgent: vi.fn().mockResolvedValue({ ok: true, id: "agent-1" }),
    deleteAgent: vi.fn().mockResolvedValue({ ok: true }),
    deleteSession: vi.fn().mockResolvedValue({ ok: true }),
    renameSession: vi.fn().mockResolvedValue({
      id: "session-1",
      agentId: "agent-1",
      title: "Renamed Session",
      createdAt: 1,
      updatedAt: 1,
      status: "active",
    }),
    getFileTree: vi.fn().mockResolvedValue([]),
    getPreviewUrl: vi.fn().mockReturnValue(""),
    getSupportedProviders: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as ApiClient;
}

describe("useProjectDataStore", () => {
  beforeEach(() => {
    useProjectDataStore.setState({ projects: {} });
  });

  it("uses the provided client when refreshing agents", async () => {
    const client = createClient({
      listAgents: vi.fn().mockResolvedValue([createAgent("agent-1")]),
    });

    await useProjectDataStore.getState().refreshAgents("project-1", client);

    expect(client.listAgents).toHaveBeenCalledTimes(1);
    expect(useProjectDataStore.getState().projects["project-1"]?.agents).toEqual([
      createAgent("agent-1"),
    ]);
  });

  it("does not recreate a cleared project when an agents refresh resolves late", async () => {
    let resolveAgents: (agents: AgentProfile[]) => void = () => {};
    const client = createClient({
      listAgents: vi.fn().mockReturnValue(new Promise<AgentProfile[]>((resolve) => {
        resolveAgents = resolve;
      })),
    });

    const refresh = useProjectDataStore.getState().refreshAgents("project-1", client);
    useProjectDataStore.getState().clearProjectData("project-1");
    resolveAgents([createAgent("agent-1")]);
    await refresh;

    expect(client.listAgents).toHaveBeenCalledTimes(1);
    expect(useProjectDataStore.getState().projects["project-1"]).toBeUndefined();
  });

  it("does not recreate a cleared project when a sessions refresh resolves late", async () => {
    let resolveSessions: (page: { items: SessionInfo[]; hasMore: boolean }) => void = () => {};
    const client = createClient({
      listAgents: vi.fn().mockResolvedValue([createAgent("agent-1")]),
      listSessionsPage: vi.fn().mockReturnValue(new Promise<{ items: SessionInfo[]; hasMore: boolean }>((resolve) => {
        resolveSessions = resolve;
      })),
    });

    await useProjectDataStore.getState().refreshAgents("project-1", client);
    const refresh = useProjectDataStore.getState().refreshSessions("project-1", client);
    useProjectDataStore.getState().clearProjectData("project-1");
    resolveSessions({ items: [createSession("session-1")], hasMore: false });
    await refresh;

    expect(client.listSessionsPage).toHaveBeenCalledWith("agent-1", { limit: 10, offset: 0 });
    expect(useProjectDataStore.getState().projects["project-1"]).toBeUndefined();
  });

  it("reports agent creation failure without refreshing agents", async () => {
    const client = createClient({
      createAgent: vi.fn().mockRejectedValue(new Error("create failed")),
      listAgents: vi.fn().mockResolvedValue([createAgent("agent-1")]),
    });

    const ok = await useProjectDataStore.getState().createAgent(
      "project-1",
      client,
      "agent",
      "content",
    );

    expect(ok).toBe(false);
    expect(client.listAgents).not.toHaveBeenCalled();
    expect(useProjectDataStore.getState().projects["project-1"]?.error).toBe("create failed");
  });

  it("keeps a newly created session when the follow-up sessions refresh is stale", async () => {
    let resolveSessions: (page: { items: SessionInfo[]; hasMore: boolean }) => void = () => {};
    const client = createClient({
      listAgents: vi.fn().mockResolvedValue([createAgent("agent-1")]),
      createSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
      listSessionsPage: vi.fn().mockReturnValue(new Promise<{ items: SessionInfo[]; hasMore: boolean }>((resolve) => {
        resolveSessions = resolve;
      })),
    });

    await useProjectDataStore.getState().refreshAgents("project-1", client);
    const session = await useProjectDataStore.getState().createSession(
      "project-1",
      client,
      "agent-1",
      "initial message",
    );
    resolveSessions({ items: [], hasMore: false });

    await vi.waitFor(() => {
      expect(client.listSessionsPage).toHaveBeenCalledWith("agent-1", { limit: 10, offset: 0 });
    });

    expect(session?.id).toBe("session-1");
    expect(useProjectDataStore.getState().projects["project-1"]?.sessions).toMatchObject([
      { id: "session-1", agentId: "agent-1", status: "active" },
    ]);
    expect(useProjectDataStore.getState().projects["project-1"]?.initialMessageBySessionId).toEqual({
      "session-1": "initial message",
    });
  });

  it("passes the title to the client and caches it on the created session", async () => {
    const client = createClient({
      createSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
    });

    await useProjectDataStore.getState().refreshAgents("project-1", client);
    const session = await useProjectDataStore.getState().createSession(
      "project-1",
      client,
      "agent-1",
      "initial message",
      "Trip Plan",
    );

    expect(client.createSession).toHaveBeenCalledWith("agent-1", "Trip Plan");
    expect(session?.title).toBe("Trip Plan");
    expect(useProjectDataStore.getState().projects["project-1"]?.sessions).toMatchObject([
      { id: "session-1", title: "Trip Plan" },
    ]);
  });

  it("creates a session without a title", async () => {
    const client = createClient({
      createSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
    });

    await useProjectDataStore.getState().refreshAgents("project-1", client);
    const session = await useProjectDataStore.getState().createSession(
      "project-1",
      client,
      "agent-1",
      "initial message",
    );

    expect(client.createSession).toHaveBeenCalledWith("agent-1", undefined);
    expect(session?.title).toBeUndefined();
  });

  it("renames a session in the project cache", async () => {
    const client = createClient({
      listAgents: vi.fn().mockResolvedValue([createAgent("agent-1")]),
      listSessionsPage: vi.fn().mockResolvedValue({ items: [createSession("session-1")], hasMore: false }),
      renameSession: vi.fn().mockResolvedValue({
        ...createSession("session-1"),
        title: "Renamed Session",
      }),
    });

    await useProjectDataStore.getState().refreshAgents("project-1", client);
    await useProjectDataStore.getState().refreshSessions("project-1", client);
    const ok = await useProjectDataStore.getState().renameSession(
      "project-1",
      client,
      "session-1",
      "Renamed Session",
    );

    expect(ok).toBe(true);
    expect(client.renameSession).toHaveBeenCalledWith("agent-1", "session-1", "Renamed Session");
    expect(useProjectDataStore.getState().projects["project-1"]?.sessions).toEqual([
      { ...createSession("session-1"), title: "Renamed Session" },
    ]);
  });

  it("keeps the existing session title when rename fails", async () => {
    const original = { ...createSession("session-1"), title: "Original" };
    const client = createClient({
      listAgents: vi.fn().mockResolvedValue([createAgent("agent-1")]),
      listSessionsPage: vi.fn().mockResolvedValue({ items: [original], hasMore: false }),
      renameSession: vi.fn().mockRejectedValue(new Error("rename failed")),
    });

    await useProjectDataStore.getState().refreshAgents("project-1", client);
    await useProjectDataStore.getState().refreshSessions("project-1", client);
    const ok = await useProjectDataStore.getState().renameSession(
      "project-1",
      client,
      "session-1",
      "New Title",
    );

    expect(ok).toBe(false);
    expect(useProjectDataStore.getState().projects["project-1"]?.sessions).toEqual([original]);
    expect(useProjectDataStore.getState().projects["project-1"]?.error).toBe("rename failed");
  });

  it("does not recreate a cleared project when a rename resolves late", async () => {
    let resolveRename: (session: SessionInfo) => void = () => {};
    const client = createClient({
      listAgents: vi.fn().mockResolvedValue([createAgent("agent-1")]),
      listSessionsPage: vi.fn().mockResolvedValue({ items: [createSession("session-1")], hasMore: false }),
      renameSession: vi.fn().mockReturnValue(new Promise<SessionInfo>((resolve) => {
        resolveRename = resolve;
      })),
    });

    await useProjectDataStore.getState().refreshAgents("project-1", client);
    await useProjectDataStore.getState().refreshSessions("project-1", client);
    const rename = useProjectDataStore.getState().renameSession(
      "project-1",
      client,
      "session-1",
      "Renamed Session",
    );
    useProjectDataStore.getState().clearProjectData("project-1");
    resolveRename({ ...createSession("session-1"), title: "Renamed Session" });
    await rename;

    expect(useProjectDataStore.getState().projects["project-1"]).toBeUndefined();
  });

  it("does not create an undefined session when session creation returns no id", async () => {
    const client = createClient({
      createSession: vi.fn().mockResolvedValue({ error: "create failed" }),
    } as Partial<ApiClient>);

    await useProjectDataStore.getState().refreshAgents("project-1", client);
    const session = await useProjectDataStore.getState().createSession(
      "project-1",
      client,
      "agent-1",
      "initial message",
    );

    expect(session).toBeNull();
    expect(useProjectDataStore.getState().projects["project-1"]?.sessions).toEqual([]);
  });

  it("stores the raw error message for Error throws", async () => {
    const client = createClient({
      listAgents: vi.fn().mockRejectedValue(new Error("boom")),
    });

    await useProjectDataStore.getState().refreshAgents("project-1", client);

    expect(useProjectDataStore.getState().projects["project-1"]?.error).toBe("boom");
  });

  it("stores an empty string when a non-Error value is thrown", async () => {
    const client = createClient({
      listAgents: vi.fn().mockRejectedValue("string error"),
    });

    await useProjectDataStore.getState().refreshAgents("project-1", client);

    expect(useProjectDataStore.getState().projects["project-1"]?.error).toBe("");
  });

  it("writes and reads hasEnabledTriggersByAgent via setHasEnabledTriggers", () => {
    useProjectDataStore.getState().setHasEnabledTriggers("project-1", "agent-a", true);

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledTriggersByAgent).toEqual({
      "agent-a": true,
    });
  });

  it("clears hasEnabledTriggersByAgent together with project data", async () => {
    const client = createClient({
      listAgents: vi.fn().mockResolvedValue([createAgent("agent-1")]),
    });
    await useProjectDataStore.getState().refreshAgents("project-1", client);
    useProjectDataStore.getState().setHasEnabledTriggers("project-1", "agent-1", true);

    useProjectDataStore.getState().clearProjectData("project-1");

    expect(useProjectDataStore.getState().projects["project-1"]).toBeUndefined();
  });

  it("isolates hasEnabledTriggersByAgent between projects", () => {
    useProjectDataStore.getState().setHasEnabledTriggers("project-1", "agent-a", true);
    useProjectDataStore.getState().setHasEnabledTriggers("project-2", "agent-a", false);

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledTriggersByAgent).toEqual({
      "agent-a": true,
    });
    expect(useProjectDataStore.getState().projects["project-2"]?.hasEnabledTriggersByAgent).toEqual({
      "agent-a": false,
    });
  });

  it("refreshSessions loads only the first page and tracks paging state", async () => {
    const firstPage = Array.from({ length: 10 }, (_, i) => createSession(`s-${i}`));
    const client = createClient({
      listAgents: vi.fn().mockResolvedValue([createAgent("agent-1")]),
      listSessionsPage: vi.fn().mockResolvedValue({ items: firstPage, hasMore: true }),
    });

    await useProjectDataStore.getState().refreshAgents("project-1", client);
    await useProjectDataStore.getState().refreshSessions("project-1", client);

    expect(client.listSessionsPage).toHaveBeenCalledWith("agent-1", { limit: 10, offset: 0 });
    const project = useProjectDataStore.getState().projects["project-1"];
    expect(project?.sessions).toHaveLength(10);
    expect(project?.sessionPaging["agent-1"]).toEqual({ hasMore: true, offset: 10, loadingMore: false });
  });

  it("loadMoreSessions appends the next page and advances paging offset", async () => {
    const firstPage = Array.from({ length: 10 }, (_, i) => createSession(`s-${i}`));
    const secondPage = [createSession("s-10"), createSession("s-11")];
    const client = createClient({
      listAgents: vi.fn().mockResolvedValue([createAgent("agent-1")]),
      listSessionsPage: vi.fn()
        .mockResolvedValueOnce({ items: firstPage, hasMore: true })
        .mockResolvedValueOnce({ items: secondPage, hasMore: false }),
    });

    await useProjectDataStore.getState().refreshAgents("project-1", client);
    await useProjectDataStore.getState().refreshSessions("project-1", client);
    await useProjectDataStore.getState().loadMoreSessions("project-1", client, "agent-1");

    expect(client.listSessionsPage).toHaveBeenNthCalledWith(2, "agent-1", { limit: 10, offset: 10 });
    const project = useProjectDataStore.getState().projects["project-1"];
    expect(project?.sessions).toHaveLength(12);
    expect(project?.sessionPaging["agent-1"]).toEqual({ hasMore: false, offset: 12, loadingMore: false });
  });

  it("loadMoreSessions is a no-op when there are no more sessions", async () => {
    const firstPage = Array.from({ length: 3 }, (_, i) => createSession(`s-${i}`));
    const client = createClient({
      listAgents: vi.fn().mockResolvedValue([createAgent("agent-1")]),
      listSessionsPage: vi.fn().mockResolvedValue({ items: firstPage, hasMore: false }),
    });

    await useProjectDataStore.getState().refreshAgents("project-1", client);
    await useProjectDataStore.getState().refreshSessions("project-1", client);
    await useProjectDataStore.getState().loadMoreSessions("project-1", client, "agent-1");

    expect(client.listSessionsPage).toHaveBeenCalledTimes(1);
    expect(useProjectDataStore.getState().projects["project-1"]?.sessions).toHaveLength(3);
  });

  it("loadMoreSessions dedupes sessions already present", async () => {
    const firstPage = Array.from({ length: 10 }, (_, i) => createSession(`s-${i}`));
    const secondPage = [createSession("s-0"), createSession("s-10")];
    const client = createClient({
      listAgents: vi.fn().mockResolvedValue([createAgent("agent-1")]),
      listSessionsPage: vi.fn()
        .mockResolvedValueOnce({ items: firstPage, hasMore: true })
        .mockResolvedValueOnce({ items: secondPage, hasMore: false }),
    });

    await useProjectDataStore.getState().refreshAgents("project-1", client);
    await useProjectDataStore.getState().refreshSessions("project-1", client);
    await useProjectDataStore.getState().loadMoreSessions("project-1", client, "agent-1");

    const sessions = useProjectDataStore.getState().projects["project-1"]?.sessions ?? [];
    expect(sessions).toHaveLength(11);
    expect(sessions.filter((s) => s.id === "s-0")).toHaveLength(1);
  });
});
