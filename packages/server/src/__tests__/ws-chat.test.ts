import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleChatWebSocket } from "../ws-chat.js";

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
    abortSession: vi.fn(),
    destroySession: vi.fn(),
  };
  const ctx = { sessionRuntime };
  return {
    registry: { get: vi.fn(() => ctx) },
    ctx,
    sessionRuntime,
  };
}

function req(params: Record<string, string>): unknown {
  return { params };
}

describe("ws-chat /ws/projects/:p/chat/:a/:s handler", () => {
  let socket: MockSocket;
  let sessionRuntime: ReturnType<typeof createMockRegistry>["sessionRuntime"];

  beforeEach(() => {
    routeHandler = null;
    const mock = createMockRegistry();
    sessionRuntime = mock.sessionRuntime;
    handleChatWebSocket(mockFastify as never, mock.registry as never);
    socket = createMockSocket();
    routeHandler!(socket, req({ projectId: "p1", agentId: "a1", sessionId: "s1" }));
  });

  it("replies with pong on ping", () => {
    socket.simulateMessage(Buffer.from(JSON.stringify({ type: "ping" })));
    expect(sentObjects(socket)).toContainEqual({ type: "pong" });
  });

  it("destroys the session on close", () => {
    socket.simulateClose();
    expect(sessionRuntime.destroySession).toHaveBeenCalledWith("s1");
  });

  it("closes the socket when project is unknown", () => {
    routeHandler = null;
    const mock = createMockRegistry();
    mock.registry.get = vi.fn(() => undefined);
    handleChatWebSocket(mockFastify as never, mock.registry as never);
    const unknownSocket = createMockSocket();
    routeHandler!(unknownSocket, req({ projectId: "missing", agentId: "a1", sessionId: "s1" }));
    expect(unknownSocket.close).toHaveBeenCalled();
  });
});
