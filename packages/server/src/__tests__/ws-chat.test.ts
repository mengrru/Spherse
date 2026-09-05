import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NotFoundError,
  ModelNotConfiguredError,
  MigrationRequiredError,
  ValidationError,
} from "@spherse/core";

import { handleChatWebSocket } from "../ws-chat.js";
import { ChatSessionHub } from "../chat-session-hub.js";
import { CHAT_CLOSE_CODES } from "@spherse/contracts";

interface MockSocket {
  on: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  simulateMessage: (raw: Buffer | string) => void;
  simulateClose: () => void;
}

function createMockSocket(): MockSocket {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      const arr = listeners.get(event) ?? [];
      arr.push(cb);
      listeners.set(event, arr);
    }),
    send: vi.fn(),
    close: vi.fn(),
    simulateMessage: (raw) => {
      for (const cb of listeners.get("message") ?? []) cb(raw);
    },
    simulateClose: () => {
      for (const cb of listeners.get("close") ?? []) cb();
    },
  };
}

function sentObjects(socket: MockSocket): unknown[] {
  return socket.send.mock.calls.map((c) => JSON.parse(c[0] as string));
}

let routeHandler: ((socket: MockSocket, req: unknown) => void) | null = null;
const mockFastify = {
  get: vi.fn((_path: string, _opts: unknown, handler: (socket: MockSocket, req: unknown) => void) => {
    routeHandler = handler;
  }),
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
};

function createMockRegistry() {
  const sessionRuntime = {
    restoreSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    withdrawLastTurn: vi.fn().mockResolvedValue(2),
    abortSession: vi.fn(),
    resolveControlRequest: vi.fn(),
    destroySession: vi.fn(),
    subscribeSessionEvents: vi.fn(() => () => {}),
    readSessionEventsAfter: vi.fn(() => []),
    getSessionLastSeq: vi.fn(() => -1),
  };
  const ctx = { sessionRuntime };
  return {
    registry: { get: vi.fn(() => ctx) },
    ctx,
    sessionRuntime,
  };
}

const hubLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function req(params: Record<string, string>, query?: Record<string, string>): unknown {
  return query ? { params, query } : { params };
}

describe("ws-chat /ws/projects/:p/chat/:a/:s handler", () => {
  let socket: MockSocket;
  let sessionRuntime: ReturnType<typeof createMockRegistry>["sessionRuntime"];

  beforeEach(() => {
    routeHandler = null;
    const mock = createMockRegistry();
    sessionRuntime = mock.sessionRuntime;
    handleChatWebSocket(mockFastify as never, mock.registry as never, new ChatSessionHub(hubLogger));
    socket = createMockSocket();
    routeHandler!(socket, req({ projectId: "p1", agentId: "a1", sessionId: "s1" }));
  });

  it("replies with pong on ping", () => {
    socket.simulateMessage(Buffer.from(JSON.stringify({ type: "ping" })));
    expect(sentObjects(socket)).toContainEqual({ type: "pong" });
  });

  it("sends the session_ready handshake as the first event on connect", async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const sent = sentObjects(socket);
    expect(sent[0]).toEqual({ type: "session_ready", lastSeq: -1, replay: true });
    expect(sent.at(-1)).toEqual({ type: "run_status", active: false });
  });

  it("replays persisted events after the since cursor from the query string", async () => {
    routeHandler = null;
    const mock = createMockRegistry();
    mock.sessionRuntime.getSessionLastSeq.mockReturnValue(9);
    mock.sessionRuntime.readSessionEventsAfter.mockReturnValue([
      { type: "user/message", seq: 8, time: 1, data: { message: { role: "user", content: "hi" } } },
      { type: "turn/start", seq: 9, time: 1, data: {} },
    ]);
    handleChatWebSocket(mockFastify as never, mock.registry as never, new ChatSessionHub(hubLogger));
    const replaySocket = createMockSocket();
    routeHandler!(
      replaySocket,
      req({ projectId: "p1", agentId: "a1", sessionId: "s1" }, { since: "7" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mock.sessionRuntime.readSessionEventsAfter).toHaveBeenCalledWith(
      "a1",
      "s1",
      7,
      expect.any(Number),
    );
    const sent = sentObjects(replaySocket);
    expect(sent.map((event) => (event as { type: string }).type)).toEqual([
      "session_ready",
      "replay_events",
      "replay_done",
      "run_status",
    ]);
    expect(sent[0]).toEqual({ type: "session_ready", lastSeq: 9, replay: true });
    expect(
      (sent[1] as { events: Array<{ seq: number }> }).events.map((event) => event.seq),
    ).toEqual([8, 9]);
  });

  it("ignores a non-numeric since cursor", async () => {
    routeHandler = null;
    const mock = createMockRegistry();
    handleChatWebSocket(mockFastify as never, mock.registry as never, new ChatSessionHub(hubLogger));
    const cursorSocket = createMockSocket();
    routeHandler!(
      cursorSocket,
      req({ projectId: "p1", agentId: "a1", sessionId: "s1" }, { since: "abc" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mock.sessionRuntime.readSessionEventsAfter).not.toHaveBeenCalled();
    expect(sentObjects(cursorSocket).map((event) => (event as { type: string }).type)).toEqual([
      "session_ready",
      "run_status",
    ]);
  });

  it("treats since=-1 as a full-replay cursor", async () => {
    routeHandler = null;
    const mock = createMockRegistry();
    mock.sessionRuntime.readSessionEventsAfter.mockReturnValue([
      { type: "turn/start", seq: 0, time: 1, data: {} },
    ]);
    handleChatWebSocket(mockFastify as never, mock.registry as never, new ChatSessionHub(hubLogger));
    const cursorSocket = createMockSocket();
    routeHandler!(
      cursorSocket,
      req({ projectId: "p1", agentId: "a1", sessionId: "s1" }, { since: "-1" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mock.sessionRuntime.readSessionEventsAfter).toHaveBeenCalledWith(
      "a1",
      "s1",
      -1,
      expect.any(Number),
    );
    expect(
      sentObjects(cursorSocket).map((event) => (event as { type: string }).type),
    ).toEqual(["session_ready", "replay_events", "replay_done", "run_status"]);
  });

  it("routes message sends with a clientId without changing the runtime call", async () => {
    socket.simulateMessage(
      Buffer.from(JSON.stringify({ type: "message", content: "hi", clientId: "c1" })),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sessionRuntime.sendMessage).toHaveBeenCalledWith(
      "s1",
      "hi",
      [],
      expect.any(Function),
    );
  });

  it("routes legacy client messages without a clientId", async () => {
    socket.simulateMessage(Buffer.from(JSON.stringify({ type: "message", content: "hi" })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sessionRuntime.sendMessage).toHaveBeenCalledWith(
      "s1",
      "hi",
      [],
      expect.any(Function),
    );
  });

  it("closes with PROTOCOL_ERROR on an invalid client message", () => {
    socket.simulateMessage(Buffer.from("not-json"));
    expect(sentObjects(socket)).toContainEqual({
      type: "error",
      message: "Invalid WebSocket message",
    });
    expect(socket.close).toHaveBeenCalledWith(
      CHAT_CLOSE_CODES.PROTOCOL_ERROR,
      "Invalid WebSocket message",
    );
  });

  it("closes with PROTOCOL_ERROR on a schema-violating client message", () => {
    socket.simulateMessage(Buffer.from(JSON.stringify({ type: "message" })));
    expect(socket.close).toHaveBeenCalledWith(
      CHAT_CLOSE_CODES.PROTOCOL_ERROR,
      "Invalid WebSocket message",
    );
  });

  it("routes withdraw to withdrawLastTurn and broadcasts turn_withdrawn", async () => {
    socket.simulateMessage(Buffer.from(JSON.stringify({ type: "withdraw" })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sessionRuntime.withdrawLastTurn).toHaveBeenCalledWith("s1");
    expect(sentObjects(socket)).toContainEqual({ type: "turn_withdrawn", seq: 2 });
  });

  it("sends error event when withdrawLastTurn rejects", async () => {
    sessionRuntime.withdrawLastTurn.mockRejectedValue(
      new ValidationError("Session \"s1\" has no user message to withdraw"),
    );
    socket.simulateMessage(Buffer.from(JSON.stringify({ type: "withdraw" })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sentObjects(socket)).toContainEqual({
      type: "error",
      message: 'Session "s1" has no user message to withdraw',
      code: "PERMANENT",
    });
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("routes question resolve_control_request with answer and timedOut false", async () => {
    socket.simulateMessage(
      Buffer.from(
        JSON.stringify({
          type: "resolve_control_request",
          requestId: "req1",
          kind: "question",
          answer: "option B",
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sessionRuntime.resolveControlRequest).toHaveBeenCalledWith(
      "s1",
      "req1",
      { answer: "option B", timedOut: false },
    );
  });

  it("routes approval resolve_control_request with approved and reason", async () => {
    socket.simulateMessage(
      Buffer.from(
        JSON.stringify({
          type: "resolve_control_request",
          requestId: "req2",
          kind: "approval",
          approved: false,
          reason: "not allowed",
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sessionRuntime.resolveControlRequest).toHaveBeenCalledWith(
      "s1",
      "req2",
      { approved: false, reason: "not allowed" },
    );
  });

  it("destroys an idle restored session after the socket closes", async () => {
    socket.simulateClose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sessionRuntime.destroySession).toHaveBeenCalledWith("s1");
  });

  it("forwards runtime events through the server chat hub", async () => {
    routeHandler = null;
    const mock = createMockRegistry();
    mock.sessionRuntime.sendMessage.mockImplementation(
      async (_sessionId: string, _content: string, _attachments: unknown, onEvent: (event: any) => void) => {
        onEvent({ type: "agent_start" });
        onEvent({ type: "agent_end", messages: [] });
      },
    );
    handleChatWebSocket(mockFastify as never, mock.registry as never, new ChatSessionHub(hubLogger));
    const eventSocket = createMockSocket();
    routeHandler!(eventSocket, req({ projectId: "p1", agentId: "a1", sessionId: "s1" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    eventSocket.simulateMessage(
      Buffer.from(JSON.stringify({ type: "message", content: "hi" })),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sentObjects(eventSocket)).toContainEqual({ type: "agent_start" });
    expect(sentObjects(eventSocket)).toContainEqual({
      type: "run_status",
      active: false,
    });
  });

  it("closes the socket when project is unknown", () => {
    routeHandler = null;
    const mock = createMockRegistry();
    mock.registry.get = vi.fn(() => undefined);
    handleChatWebSocket(mockFastify as never, mock.registry as never, new ChatSessionHub(hubLogger));
    const unknownSocket = createMockSocket();
    routeHandler!(unknownSocket, req({ projectId: "missing", agentId: "a1", sessionId: "s1" }));
    expect(unknownSocket.close).toHaveBeenCalled();
  });

  it("closes with SESSION_UNRECOVERABLE when restoreSession rejects NotFoundError", async () => {
    routeHandler = null;
    const mock = createMockRegistry();
    mock.sessionRuntime.restoreSession = vi
      .fn()
      .mockRejectedValue(new NotFoundError("Session s1 not found"));
    handleChatWebSocket(mockFastify as never, mock.registry as never, new ChatSessionHub(hubLogger));
    const errSocket = createMockSocket();
    routeHandler!(errSocket, req({ projectId: "p1", agentId: "a1", sessionId: "s1" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errSocket.send).toHaveBeenCalledTimes(1);
    expect(sentObjects(errSocket)[0]).toMatchObject({ type: "error", message: "Session s1 not found" });
    expect(errSocket.close).toHaveBeenCalledWith(
      CHAT_CLOSE_CODES.SESSION_UNRECOVERABLE,
      "Session s1 not found",
    );
  });

  it("closes with 1000 when restoreSession rejects a generic error", async () => {
    routeHandler = null;
    const mock = createMockRegistry();
    mock.sessionRuntime.restoreSession = vi.fn().mockRejectedValue(new Error("boom"));
    handleChatWebSocket(mockFastify as never, mock.registry as never, new ChatSessionHub(hubLogger));
    const errSocket = createMockSocket();
    routeHandler!(errSocket, req({ projectId: "p1", agentId: "a1", sessionId: "s1" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errSocket.close).toHaveBeenCalledWith(1000, "boom");
  });

  it("closes with MIGRATION_REQUIRED when restore rejects MigrationRequiredError", async () => {
    routeHandler = null;
    const mock = createMockRegistry();
    mock.sessionRuntime.restoreSession = vi.fn().mockRejectedValue(
      new MigrationRequiredError("legacy session must be migrated"),
    );
    handleChatWebSocket(mockFastify as never, mock.registry as never, new ChatSessionHub(hubLogger));
    const errSocket = createMockSocket();
    routeHandler!(errSocket, req({ projectId: "p1", agentId: "a1", sessionId: "s1" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errSocket.close).toHaveBeenCalledWith(
      CHAT_CLOSE_CODES.MIGRATION_REQUIRED,
      "legacy session must be migrated",
    );
  });

  it("closes with SESSION_UNRECOVERABLE when the handshake facade read fails", async () => {
    routeHandler = null;
    const mock = createMockRegistry();
    mock.sessionRuntime.getSessionLastSeq.mockImplementation(() => {
      throw new NotFoundError(`Agent "a1" not found`);
    });
    handleChatWebSocket(mockFastify as never, mock.registry as never, new ChatSessionHub(hubLogger));
    const errSocket = createMockSocket();
    routeHandler!(errSocket, req({ projectId: "p1", agentId: "a1", sessionId: "s1" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errSocket.close).toHaveBeenCalledWith(
      CHAT_CLOSE_CODES.SESSION_UNRECOVERABLE,
      'Agent "a1" not found',
    );
  });

  it("sends error with MODEL_NOT_CONFIGURED code and keeps connection open", async () => {
    sessionRuntime.sendMessage.mockRejectedValue(new ModelNotConfiguredError());
    socket.simulateMessage(Buffer.from(JSON.stringify({ type: "message", content: "hi" })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sentObjects(socket)).toContainEqual({
      type: "error",
      message: "Model is not configured. Please select a model in Settings.",
      code: "MODEL_NOT_CONFIGURED",
    });
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("sends error with TRANSIENT code when sendMessage rejects a generic error", async () => {
    sessionRuntime.sendMessage.mockRejectedValue(new Error("oops"));
    socket.simulateMessage(Buffer.from(JSON.stringify({ type: "message", content: "hi" })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sentObjects(socket)).toContainEqual({ type: "error", message: "oops", code: "TRANSIENT" });
    expect(socket.close).not.toHaveBeenCalled();
  });
});
