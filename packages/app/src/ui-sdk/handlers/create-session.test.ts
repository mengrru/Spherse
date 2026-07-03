import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateSession = vi.fn();
const mockSetFloatingChat = vi.fn();
const mockGetState = vi.fn(() => ({
  projects: {} as Record<string, { agents: Array<{ id: string; slug: string }> }>,
  createSession: mockCreateSession,
}));

vi.mock("../../stores/project-data-store", () => ({
  useProjectDataStore: { getState: () => mockGetState() },
}));

vi.mock("../../features/floating-chat/store", () => ({
  useFloatingChatStore: { getState: () => ({ setFloatingChat: mockSetFloatingChat }) },
}));

vi.mock("../../features/floating-chat", () => ({
  getDefaultFloatingState: (sessionId: string) => ({ sessionId } as any),
}));

const { dispatchAction } = await import("../registry");
await import("./create-session");

function makeClient(listAgents: () => Promise<any[]>) {
  return { listAgents: vi.fn(listAgents) } as any;
}

function makeCtx(client: any, projectId = "proj-1") {
  return {
    client,
    projectId,
    navigate: vi.fn(),
  } as any;
}

describe("createSession action", () => {
  beforeEach(() => {
    mockCreateSession.mockReset();
    mockSetFloatingChat.mockReset();
    mockGetState.mockReset();
    mockGetState.mockReturnValue({
      projects: {},
      createSession: mockCreateSession,
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
    expect(mockCreateSession).toHaveBeenCalledWith("proj-1", client, "agent-uuid-1", "hi");
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
    expect(mockCreateSession).toHaveBeenCalledWith("proj-1", client, "id-writer", undefined);
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
    expect(mockCreateSession).toHaveBeenCalledWith("proj-1", client, "id-historian", undefined);
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
    expect(mockCreateSession).toHaveBeenCalledWith("proj-1", client, "explicit-id", undefined);
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
    expect(mockCreateSession).toHaveBeenCalledWith("proj-1", client, "id-writer", undefined);
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
      { client: makeClient(async () => []), projectId: "proj-1", navigate } as any,
    );
    expect(mockSetFloatingChat).toHaveBeenCalledWith("proj-1", { sessionId: "session-1" });
    expect(navigate).not.toHaveBeenCalled();
  });
});
