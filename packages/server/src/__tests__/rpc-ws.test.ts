import { describe, expect, it, vi } from "vitest";
import type { ProjectContextCompat } from "../registry.js";
import type { ChatSessionAttachment } from "../chat/chat-channel.js";
import type { ChatSessionHub } from "../chat/chat-session-hub.js";
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

interface HubMock {
  hub: ChatSessionHub;
  attach: ReturnType<typeof vi.fn>;
  emit: (ev: unknown) => void;
  attachments: { close: ReturnType<typeof vi.fn>; ready: Promise<void> }[];
}

function createHub(): HubMock {
  const attachments: HubMock["attachments"] = [];
  let currentSubscriber: ((ev: unknown) => void) | undefined;
  const attach = vi.fn(
    (
      _runtime: unknown,
      _agentId: string,
      _sessionId: string,
      subscriber: (ev: unknown) => void,
      options: { since?: number } | undefined,
    ) => {
      currentSubscriber = subscriber;
      const attachment = {
        close: vi.fn(),
        ready: Promise.resolve(),
      };
      attachments.push(attachment);
      void options;
      return attachment as unknown as ChatSessionAttachment;
    },
  );
  const hub = { attach } as unknown as ChatSessionHub;
  return {
    hub,
    attach,
    attachments,
    emit: (ev: unknown) => currentSubscriber?.(ev),
  };
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
  const hubMock = createHub();
  const ctx = {
    resolveProject(projectId: string) {
      if (projectId === "missing") throw new RpcAppError(100, "Unknown project");
      return known;
    },
  };
  const dispatcher = new RpcDispatcher({
    methods: new Map<string, RpcMethodEntry>(Object.entries(sessionMethods)),
    ctx,
    logger,
  });
  const socket = createSocket();
  const handler = new RpcConnectionHandler(socket, dispatcher, hubMock.hub, ctx, logger);
  const sent = () => socket.sent.map((raw) => JSON.parse(raw));
  const receive = (payload: unknown) => handler.onMessage(Buffer.from(JSON.stringify(payload)));
  return { handler, socket, sent, receive, known, hubMock };
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

  it("subscribes chat scopes through the hub with an empty snapshot ack", () => {
    const { receive, sent, hubMock } = createHandler();
    receive({ type: "sub", id: 7, scope: "chat:p1:a1:s1", since: 5 });
    expect(hubMock.attach).toHaveBeenCalledWith(
      expect.objectContaining({}),
      "a1",
      "s1",
      expect.any(Function),
      { since: 5 },
    );
    const frames = sent();
    expect(frames[0]).toEqual({ type: "snapshot", id: 7, events: [] });
  });

  it("forwards hub events as rpc event frames with payload passthrough", () => {
    const { receive, sent, hubMock } = createHandler();
    receive({ type: "sub", id: 1, scope: "chat:p1:a1:s1" });
    hubMock.emit({ type: "session_ready", lastSeq: 9, replay: true });
    hubMock.emit({ type: "assistant_delta", seq: 10, time: 123, data: { text: "hi" } });
    const frames = sent().slice(1);
    expect(frames[0]).toMatchObject({
      type: "event",
      scope: "chat:p1:a1:s1",
      event: "session_ready",
      payload: { type: "session_ready", lastSeq: 9, replay: true },
    });
    expect(frames[1]).toMatchObject({
      type: "event",
      event: "assistant_delta",
      ts: 123,
      payload: { seq: 10, data: { text: "hi" } },
    });
  });

  it("rejects sub frames for non-chat scopes", () => {
    const { receive, sent } = createHandler();
    receive({ type: "sub", id: 7, scope: "trigger:p1" });
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 7,
      ok: false,
      error: { code: -32000 },
    });
  });

  it("rejects chat sub for unknown project", () => {
    const { receive, sent } = createHandler();
    receive({ type: "sub", id: 8, scope: "chat:missing:a:s" });
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 8,
      ok: false,
      error: { code: 100, message: "Unknown project" },
    });
  });

  it("closing a subscription detaches from the hub", () => {
    const { receive, sent, hubMock } = createHandler();
    receive({ type: "sub", id: 1, scope: "chat:p1:a1:s1" });
    receive({ type: "unsub", id: 2, scope: "chat:p1:a1:s1" });
    expect(hubMock.attachments[0].close).toHaveBeenCalledTimes(1);
    expect(sent()[1]).toMatchObject({ type: "result", id: 2, ok: true });
  });

  it("duplicate sub replaces the previous attachment", () => {
    const { receive, hubMock } = createHandler();
    receive({ type: "sub", id: 1, scope: "chat:p1:a1:s1" });
    receive({ type: "sub", id: 2, scope: "chat:p1:a1:s1" });
    expect(hubMock.attachments).toHaveLength(2);
    expect(hubMock.attachments[0].close).toHaveBeenCalledTimes(1);
    expect(hubMock.attachments[1].close).not.toHaveBeenCalled();
  });

  it("connection close detaches all subscriptions", () => {
    const { handler, receive, hubMock } = createHandler();
    receive({ type: "sub", id: 1, scope: "chat:p1:a1:s1" });
    receive({ type: "sub", id: 2, scope: "chat:p1:a2:s2" });
    handler.onClose();
    expect(hubMock.attachments[0].close).toHaveBeenCalledTimes(1);
    expect(hubMock.attachments[1].close).toHaveBeenCalledTimes(1);
  });

  it("ignores non-json and invalid frames", () => {
    const { handler, sent, receive } = createHandler();
    handler.onMessage(Buffer.from("not json"));
    receive({ type: "call", id: 0, method: "sessions.get" });
    receive({ type: "result", id: 1, ok: true });
    expect(sent()).toEqual([]);
  });
});
