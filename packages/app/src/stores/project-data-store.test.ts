import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../lib/api";
import type { AgentProfile, SessionInfo } from "../lib/types";
import { useProjectDataStore } from "./project-data-store";

function createAgent(id: string): AgentProfile {
  return {
    id,
    name: id,
    type: "test",
    systemPrompt: "test",
    filePath: `${id}.agents.md`,
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
    createChatWebSocket: vi.fn(),
    createFsWatchWebSocket: vi.fn(),
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
    let resolveSessions: (sessions: SessionInfo[]) => void = () => {};
    const client = createClient({
      listSessions: vi.fn().mockReturnValue(new Promise<SessionInfo[]>((resolve) => {
        resolveSessions = resolve;
      })),
    });

    const refresh = useProjectDataStore.getState().refreshSessions("project-1", client);
    useProjectDataStore.getState().clearProjectData("project-1");
    resolveSessions([createSession("session-1")]);
    await refresh;

    expect(client.listSessions).toHaveBeenCalledTimes(1);
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
      "agent.agents.md",
      "content",
    );

    expect(ok).toBe(false);
    expect(client.listAgents).not.toHaveBeenCalled();
    expect(useProjectDataStore.getState().projects["project-1"]?.error).toBe("create failed");
  });

  it("keeps a newly created session when the follow-up sessions refresh is stale", async () => {
    let resolveSessions: (sessions: SessionInfo[]) => void = () => {};
    const client = createClient({
      createSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
      listSessions: vi.fn().mockReturnValue(new Promise<SessionInfo[]>((resolve) => {
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
    resolveSessions([]);

    await vi.waitFor(() => {
      expect(client.listSessions).toHaveBeenCalledTimes(1);
    });

    expect(session?.id).toBe("session-1");
    expect(useProjectDataStore.getState().projects["project-1"]?.sessions).toMatchObject([
      { id: "session-1", agentId: "agent-1", status: "active" },
    ]);
    expect(useProjectDataStore.getState().projects["project-1"]?.initialMessageBySessionId).toEqual({
      "session-1": "initial message",
    });
  });

  it("renames a session in the project cache", async () => {
    const client = createClient({
      listSessions: vi.fn().mockResolvedValue([createSession("session-1")]),
      renameSession: vi.fn().mockResolvedValue({
        ...createSession("session-1"),
        title: "Renamed Session",
      }),
    });

    await useProjectDataStore.getState().refreshSessions("project-1", client);
    const ok = await useProjectDataStore.getState().renameSession(
      "project-1",
      client,
      "session-1",
      "Renamed Session",
    );

    expect(ok).toBe(true);
    expect(client.renameSession).toHaveBeenCalledWith("session-1", "Renamed Session");
    expect(useProjectDataStore.getState().projects["project-1"]?.sessions).toEqual([
      { ...createSession("session-1"), title: "Renamed Session" },
    ]);
  });

  it("keeps the existing session title when rename fails", async () => {
    const original = { ...createSession("session-1"), title: "Original" };
    const client = createClient({
      listSessions: vi.fn().mockResolvedValue([original]),
      renameSession: vi.fn().mockRejectedValue(new Error("rename failed")),
    });

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
      listSessions: vi.fn().mockResolvedValue([createSession("session-1")]),
      renameSession: vi.fn().mockReturnValue(new Promise<SessionInfo>((resolve) => {
        resolveRename = resolve;
      })),
    });

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
});
