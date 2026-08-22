import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateSession = vi.fn();
const mockSetFloatingChat = vi.fn();
const mockPostMessage = vi.fn();
const mockGetState = vi.fn(() => ({
  projects: {} as Record<string, { agents: Array<{ id: string; slug: string }> }>,
}));

vi.mock("../../lib/project-queries", () => ({
  getCachedAgents: (projectId: string) => mockGetState().projects[projectId]?.agents ?? [],
  ensureProjectAgents: (_projectId: string, client: any) => client.listAgents(),
  createProjectSession: mockCreateSession,
}));

vi.mock("../../features/floating-chat/store", () => ({
  useFloatingChatStore: { getState: () => ({ byProject: {}, setFloatingChat: mockSetFloatingChat }) },
}));

vi.mock("../../features/floating-chat", () => ({
  getDefaultFloatingState: (sessionId: string) => ({ sessionId } as any),
}));

const { dispatchAction } = await import("../registry");
await import("./create-session");

function makeClient(listAgents: () => Promise<any[]>) {
  return { listAgents: vi.fn(listAgents) } as any;
}

function makeCtx(client: any, projectId = "proj-1", hostKind: "electron" | "web" = "electron") {
  return {
    client,
    projectId,
    navigate: vi.fn(),
    hostKind,
  } as any;
}

function makeRequestCtx(client: any, projectId = "proj-1") {
  return {
    ...makeCtx(client, projectId),
    source: { postMessage: mockPostMessage } as any,
    requestId: "req-1",
  } as any;
}

describe("createSession action", () => {
  beforeEach(() => {
    mockCreateSession.mockReset();
    mockSetFloatingChat.mockReset();
    mockPostMessage.mockReset();
    mockGetState.mockReset();
    mockGetState.mockReturnValue({
      projects: {},
    });
    mockCreateSession.mockResolvedValue({ id: "session-1" });
  });

  it("uses agentId directly and does not list agents", async () => {
    const client = makeClient(async () => []);
    await dispatchAction(
      "createSession",
      { agentId: "agent-uuid-1", message: "hi" },
      makeCtx(client),
    );
    expect(client.listAgents).not.toHaveBeenCalled();
    expect(mockCreateSession).toHaveBeenCalledWith("proj-1", client, "agent-uuid-1", "hi", undefined);
  });

  it("passes a string name through as the session title", async () => {
    const client = makeClient(async () => []);
    await dispatchAction(
      "createSession",
      { agentId: "agent-1", name: "Trip Plan" },
      makeCtx(client),
    );
    expect(mockCreateSession).toHaveBeenCalledWith("proj-1", client, "agent-1", undefined, "Trip Plan");
  });

  it("trims the name and ignores blank or non-string names", async () => {
    const client = makeClient(async () => []);
    await dispatchAction(
      "createSession",
      { agentId: "agent-1", name: "  Trip Plan  " },
      makeCtx(client),
    );
    expect(mockCreateSession).toHaveBeenCalledWith("proj-1", client, "agent-1", undefined, "Trip Plan");

    await dispatchAction("createSession", { agentId: "agent-1", name: "   " }, makeCtx(client));
    await dispatchAction("createSession", { agentId: "agent-1", name: 42 }, makeCtx(client));
    expect(mockCreateSession).toHaveBeenLastCalledWith("proj-1", client, "agent-1", undefined, undefined);
  });

  it("resolves agentSlug from cached agents without listing", async () => {
    mockGetState.mockReturnValue({
      projects: { "proj-1": { agents: [{ id: "id-writer", slug: "writer-a1b2c3" }] } },
      createSession: mockCreateSession,
    });
    const client = makeClient(async () => []);
    await dispatchAction(
      "createSession",
      { agentSlug: "writer-a1b2c3" },
      makeCtx(client),
    );
    expect(client.listAgents).not.toHaveBeenCalled();
    expect(mockCreateSession).toHaveBeenCalledWith("proj-1", client, "id-writer", undefined, undefined);
  });

  it("falls back to client.listAgents when slug not in cache", async () => {
    const client = makeClient(async () => [
      { id: "id-historian", slug: "historian-9f8e7d" },
      { id: "id-writer", slug: "writer-a1b2c3" },
    ]);
    await dispatchAction(
      "createSession",
      { agentSlug: "historian-9f8e7d" },
      makeCtx(client),
    );
    expect(client.listAgents).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledWith("proj-1", client, "id-historian", undefined, undefined);
  });

  it("is a no-op when slug cannot be resolved", async () => {
    const client = makeClient(async () => [{ id: "id-x", slug: "x-112233" }]);
    await dispatchAction(
      "createSession",
      { agentSlug: "missing-deadbe" },
      makeCtx(client),
    );
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("is a no-op when client.listAgents rejects", async () => {
    const client = makeClient(async () => {
      throw new Error("network");
    });
    await dispatchAction(
      "createSession",
      { agentSlug: "writer-a1b2c3" },
      makeCtx(client),
    );
    expect(client.listAgents).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("prefers agentId when both agentId and agentSlug are provided", async () => {
    mockGetState.mockReturnValue({
      projects: { "proj-1": { agents: [{ id: "id-writer", slug: "writer-a1b2c3" }] } },
      createSession: mockCreateSession,
    });
    const client = makeClient(async () => []);
    await dispatchAction(
      "createSession",
      { agentId: "explicit-id", agentSlug: "writer-a1b2c3" },
      makeCtx(client),
    );
    expect(client.listAgents).not.toHaveBeenCalled();
    expect(mockCreateSession).toHaveBeenCalledWith("proj-1", client, "explicit-id", undefined, undefined);
  });

  it("falls through to slug resolution when agentId is an empty string", async () => {
    mockGetState.mockReturnValue({
      projects: { "proj-1": { agents: [{ id: "id-writer", slug: "writer-a1b2c3" }] } },
      createSession: mockCreateSession,
    });
    const client = makeClient(async () => []);
    await dispatchAction(
      "createSession",
      { agentId: "", agentSlug: "writer-a1b2c3" },
      makeCtx(client),
    );
    expect(mockCreateSession).toHaveBeenCalledWith("proj-1", client, "id-writer", undefined, undefined);
  });

  it("is a no-op when neither agentId nor agentSlug is provided", async () => {
    const client = makeClient(async () => []);
    await dispatchAction("createSession", { message: "hi" }, makeCtx(client));
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("is a no-op when ctx.client is missing", async () => {
    await dispatchAction("createSession", { agentId: "agent-1" }, {
      projectId: "proj-1",
      navigate: vi.fn(),
    } as any);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("navigates to the chat route by default", async () => {
    const navigate = vi.fn();
    await dispatchAction(
      "createSession",
      { agentId: "agent-1" },
      { client: makeClient(async () => []), projectId: "proj-1", navigate } as any,
    );
    expect(navigate).toHaveBeenCalledWith("/project/proj-1/chat/session-1");
    expect(mockSetFloatingChat).not.toHaveBeenCalled();
  });

  it("opens floating chat when float is true", async () => {
    const navigate = vi.fn();
    await dispatchAction(
      "createSession",
      { agentId: "agent-1", float: true },
      { client: makeClient(async () => []), projectId: "proj-1", navigate, hostKind: "electron" } as any,
    );
    expect(mockSetFloatingChat).toHaveBeenCalledWith("proj-1", { sessionId: "session-1" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("downgrades float to chat page navigation on web", async () => {
    const navigate = vi.fn();
    await dispatchAction(
      "createSession",
      { agentId: "agent-1", float: true },
      { client: makeClient(async () => []), projectId: "proj-1", navigate, hostKind: "web" } as any,
    );
    expect(mockSetFloatingChat).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/project/proj-1/chat/session-1");
  });

  it("responds with the new sessionId on success", async () => {
    await dispatchAction(
      "createSession",
      { agentId: "agent-1" },
      makeRequestCtx(makeClient(async () => [])),
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spherse:response",
        requestId: "req-1",
        ok: true,
        data: { sessionId: "session-1" },
      }),
      "*",
    );
  });

  it("responds agent_not_found when the slug cannot be resolved", async () => {
    const client = makeClient(async () => [{ id: "id-x", slug: "x-112233" }]);
    await dispatchAction(
      "createSession",
      { agentSlug: "missing-deadbe" },
      makeRequestCtx(client),
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        data: { error: "agent_not_found" },
      }),
      "*",
    );
  });

  it("responds create_failed when the store returns null", async () => {
    mockCreateSession.mockResolvedValue(null);
    await dispatchAction(
      "createSession",
      { agentId: "agent-1" },
      makeRequestCtx(makeClient(async () => [])),
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        data: { error: "create_failed" },
      }),
      "*",
    );
  });

  it("skips navigation when open is false", async () => {
    const navigate = vi.fn();
    await dispatchAction(
      "createSession",
      { agentId: "agent-1", open: false },
      { client: makeClient(async () => []), projectId: "proj-1", navigate } as any,
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(mockSetFloatingChat).not.toHaveBeenCalled();
  });

  it("skips navigation when open is false even with float", async () => {
    const navigate = vi.fn();
    await dispatchAction(
      "createSession",
      { agentId: "agent-1", open: false, float: true },
      { client: makeClient(async () => []), projectId: "proj-1", navigate, hostKind: "electron" } as any,
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(mockSetFloatingChat).not.toHaveBeenCalled();
  });
});
