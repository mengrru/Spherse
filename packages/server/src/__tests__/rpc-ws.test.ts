import { describe, expect, it, vi } from "vitest";
import type { ProjectContextCompat } from "../registry.js";
import { RpcConnectionHandler } from "../rpc/ws-rpc.js";
import {
  RpcAppError,
  RpcDispatcher,
  sessionMethods,
  type RpcMethodEntry,
} from "../rpc/methods/sessions.js";

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(() => logger),
} as never;

interface SocketMock {
  sent: string[];
  send: (data: string) => void;
}

function createSocket(): SocketMock {
  const sent: string[] = [];
  return { sent, send: (data: string) => sent.push(data) };
}

function createProjectCtx(overrides: Partial<ProjectContextCompat> = {}): ProjectContextCompat {
  return {
    runtime: { deleteSession: vi.fn() },
    projectManager: {
      listProjectSessions: vi.fn(() => ({ sessions: [], byAgent: {} })),
      searchProjectMessages: vi.fn(() => []),
      listSessions: vi.fn(() => []),
      listSessionsPage: vi.fn(() => ({ items: [], hasMore: false })),
      getSession: vi.fn(),
      renameSession: vi.fn(),
      getSessionHistory: vi.fn(() => []),
      getRecentSessionHistory: vi.fn(() => ({
        entries: [],
        hasMore: false,
        oldestId: null,
      })),
    },
    sessionRuntime: { createSession: vi.fn().mockResolvedValue("s1") },
    triggerManager: {},
    ...overrides,
  } as unknown as ProjectContextCompat;
}

function createHandler(ctxOverrides: Partial<ProjectContextCompat> = {}) {
  const known = createProjectCtx(ctxOverrides);
  const dispatcher = new RpcDispatcher({
    methods: new Map<string, RpcMethodEntry>(Object.entries(sessionMethods)),
    ctx: {
      resolveProject(projectId: string) {
        if (projectId === "missing") throw new RpcAppError(100, "Unknown project");
        return known;
      },
    },
    logger,
  });
  const socket = createSocket();
  const handler = new RpcConnectionHandler(socket, dispatcher, logger);
  const sent = () => socket.sent.map((raw) => JSON.parse(raw));
  const receive = (payload: unknown) => handler.onMessage(Buffer.from(JSON.stringify(payload)));
  return { handler, socket, sent, receive, known };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("rpc connection handler", () => {
  it("responds to ping with pong", () => {
    const { receive, sent } = createHandler();
    receive({ type: "ping" });
    expect(sent()).toEqual([{ type: "pong" }]);
  });

  it("dispatches sessions.listProject and validates the response", async () => {
    const { receive, sent, known } = createHandler();
    receive({ type: "call", id: 1, method: "sessions.listProject", params: { projectId: "p1" } });
    await flush();
    expect(known.projectManager.listProjectSessions).toHaveBeenCalledWith(10);
    const frames = sent();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frames[0].data).toEqual({ ok: true, sessions: [], byAgent: {} });
  });

  it("returns method-not-found for unknown methods", async () => {
    const { receive, sent } = createHandler();
    receive({ type: "call", id: 2, method: "sessions.nope" });
    await flush();
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 2,
      ok: false,
      error: { code: -32601 },
    });
  });

  it("returns invalid-params for out-of-range params", async () => {
    const { receive, sent } = createHandler();
    receive({
      type: "call",
      id: 3,
      method: "sessions.listProject",
      params: { projectId: "p1", perPage: 0 },
    });
    await flush();
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 3,
      ok: false,
      error: { code: -32602 },
    });
  });

  it("maps unknown project to app error code", async () => {
    const { receive, sent } = createHandler();
    receive({
      type: "call",
      id: 4,
      method: "sessions.get",
      params: { projectId: "missing", agentId: "a", sessionId: "s" },
    });
    await flush();
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 4,
      ok: false,
      error: { code: 100, message: "Unknown project" },
    });
  });

  it("maps session-not-found from handlers to app error code", async () => {
    const { receive, sent, known } = createHandler();
    (known.projectManager.getSession as ReturnType<typeof vi.fn>).mockReturnValue(null);
    receive({
      type: "call",
      id: 5,
      method: "sessions.get",
      params: { projectId: "p1", agentId: "a", sessionId: "s" },
    });
    await flush();
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 5,
      ok: false,
      error: { code: 100, message: "Session not found" },
    });
  });

  it("maps unexpected handler failures to internal error", async () => {
    const { receive, sent, known } = createHandler();
    (known.projectManager.listProjectSessions as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw new Error("boom");
      },
    );
    receive({ type: "call", id: 6, method: "sessions.listProject", params: { projectId: "p1" } });
    await flush();
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 6,
      ok: false,
      error: { code: -32603, message: "boom" },
    });
  });

  it("rejects sub frames until event scopes are supported", () => {
    const { receive, sent } = createHandler();
    receive({ type: "sub", id: 7, scope: "chat:p:a:s" });
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 7,
      ok: false,
      error: { code: -32000 },
    });
  });

  it("ignores non-json and invalid frames", () => {
    const { handler, sent, receive } = createHandler();
    handler.onMessage(Buffer.from("not json"));
    receive({ type: "call", id: 0, method: "sessions.get" });
    receive({ type: "result", id: 1, ok: true });
    expect(sent()).toEqual([]);
  });
});
