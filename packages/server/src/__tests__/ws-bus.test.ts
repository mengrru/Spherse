import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Writable } from "node:stream";

vi.mock("../lib/fs-watcher.js", () => ({
  acquireFsWatch: vi.fn(() => ({ ok: true as const })),
  releaseFsWatch: vi.fn(),
}));

import { acquireFsWatch, releaseFsWatch } from "../lib/fs-watcher.js";
import {
  handleBusWebSocket,
  addDebugSubscriber,
  removeDebugSubscriber,
  createDebugBusStream,
} from "../ws-bus.js";

interface MockSocket {
  on: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  simulateMessage: (raw: Buffer | string) => void;
  simulateClose: () => void;
  simulateError: (err: Error) => void;
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
    simulateError: (err) => {
      for (const cb of listeners.get("error") ?? []) cb(err);
    },
  };
}

function createMockScheduler() {
  const scheduler = new EventEmitter();
  vi.spyOn(scheduler, "on");
  vi.spyOn(scheduler, "off");
  return scheduler;
}

function createMockRegistry(scheduler: EventEmitter, projectRoot = "/proj/p1", projectId = "p1") {
  const ctx = {
    scheduler,
    projectManager: { getRootPath: () => projectRoot },
    projectId,
  };
  return {
    registry: { get: vi.fn((id: string) => (id === projectId ? ctx : undefined)) },
    ctx,
  };
}

function writeAsync(stream: Writable, chunk: Buffer | string): Promise<void> {
  return new Promise((resolve) => {
    stream.write(chunk, () => resolve());
  });
}

function subMsg(projectId: string, channel: string): Buffer {
  return Buffer.from(JSON.stringify({ kind: "subscribe", projectId, channel }));
}

function unsubMsg(projectId: string, channel: string): Buffer {
  return Buffer.from(JSON.stringify({ kind: "unsubscribe", projectId, channel }));
}

function sentObjects(socket: MockSocket): unknown[] {
  return socket.send.mock.calls.map((c) => JSON.parse(c[0] as string));
}

let routeHandler: ((socket: MockSocket) => void) | null = null;
const mockFastify = {
  get: vi.fn((_path: string, _opts: unknown, handler: (socket: MockSocket) => void) => {
    routeHandler = handler;
  }),
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  },
};

describe("ws-bus /ws/bus handler", () => {
  let socket: MockSocket;
  let scheduler: EventEmitter;

  beforeEach(() => {
    routeHandler = null;
    scheduler = createMockScheduler();
    const { registry } = createMockRegistry(scheduler);
    handleBusWebSocket(mockFastify as never, registry as never);
    socket = createMockSocket();
    routeHandler!(socket);
    vi.mocked(acquireFsWatch).mockReturnValue({ ok: true });
  });

  afterEach(() => {
    socket.simulateClose();
    vi.clearAllMocks();
    routeHandler = null;
  });

  describe("schedule channel", () => {
    it("attaches 4 schedule listeners and forwards events as bus envelopes", () => {
      socket.simulateMessage(subMsg("p1", "schedule"));

      expect(scheduler.on).toHaveBeenCalledTimes(4);
      expect(scheduler.on).toHaveBeenCalledWith("schedule_triggered", expect.any(Function));
      expect(scheduler.on).toHaveBeenCalledWith("schedule_completed", expect.any(Function));
      expect(scheduler.on).toHaveBeenCalledWith("schedule_failed", expect.any(Function));
      expect(scheduler.on).toHaveBeenCalledWith("schedule_updated", expect.any(Function));

      scheduler.emit("schedule_triggered", {
        agentId: "a1",
        scheduleId: "s1",
        triggeredAt: 12345,
      });

      expect(sentObjects(socket)).toContainEqual({
        channel: "schedule",
        projectId: "p1",
        type: "schedule_triggered",
        payload: { agentId: "a1", scheduleId: "s1", triggeredAt: 12345 },
      });
    });

    it("forwards schedule_completed with status success", () => {
      socket.simulateMessage(subMsg("p1", "schedule"));

      scheduler.emit("schedule_completed", {
        agentId: "a1",
        scheduleId: "s1",
        sessionId: "sess1",
        status: "success",
      });

      expect(sentObjects(socket)).toContainEqual({
        channel: "schedule",
        projectId: "p1",
        type: "schedule_completed",
        payload: { agentId: "a1", scheduleId: "s1", sessionId: "sess1", status: "success" },
      });
    });

    it("forwards schedule_failed with error", () => {
      socket.simulateMessage(subMsg("p1", "schedule"));

      scheduler.emit("schedule_failed", {
        agentId: "a1",
        scheduleId: "s1",
        error: "boom",
      });

      expect(sentObjects(socket)).toContainEqual({
        channel: "schedule",
        projectId: "p1",
        type: "schedule_failed",
        payload: { agentId: "a1", scheduleId: "s1", error: "boom" },
      });
    });

    it("does not double-attach on duplicate subscribe", () => {
      socket.simulateMessage(subMsg("p1", "schedule"));
      expect(scheduler.on).toHaveBeenCalledTimes(4);

      socket.simulateMessage(subMsg("p1", "schedule"));
      expect(scheduler.on).toHaveBeenCalledTimes(4);
    });

    it("releases 4 listeners on unsubscribe", () => {
      socket.simulateMessage(subMsg("p1", "schedule"));
      expect(scheduler.off).not.toHaveBeenCalled();

      socket.simulateMessage(unsubMsg("p1", "schedule"));
      expect(scheduler.off).toHaveBeenCalledTimes(4);

      scheduler.emit("schedule_triggered", { agentId: "a1", scheduleId: "s1", triggeredAt: 1 });
      expect(socket.send).not.toHaveBeenCalled();
    });
  });

  describe("fs-watch channel", () => {
    it("acquires fs watch with correct projectRoot and forwards change events", () => {
      socket.simulateMessage(subMsg("p1", "fs-watch"));

      expect(acquireFsWatch).toHaveBeenCalledWith("/proj/p1", "p1", expect.any(Function));

      const listener = vi.mocked(acquireFsWatch).mock.calls[0][2];
      listener("p1", { eventType: "change", path: "src/foo.ts" });

      expect(sentObjects(socket)).toContainEqual({
        channel: "fs-watch",
        projectId: "p1",
        type: "change",
        payload: { eventType: "change", path: "src/foo.ts" },
      });
    });

    it("releases fs watch on unsubscribe", () => {
      socket.simulateMessage(subMsg("p1", "fs-watch"));

      socket.simulateMessage(unsubMsg("p1", "fs-watch"));

      expect(releaseFsWatch).toHaveBeenCalledWith("p1", expect.any(Function));
    });

    it("sends fs_watch_error when acquireFsWatch fails", () => {
      vi.mocked(acquireFsWatch).mockReturnValueOnce({
        ok: false,
        error: new Error("watch failed"),
      });

      socket.simulateMessage(subMsg("p1", "fs-watch"));

      expect(sentObjects(socket)).toContainEqual({
        channel: "__system__",
        projectId: "p1",
        type: "fs_watch_error",
        payload: { error: "watch failed" },
      });
    });
  });

  describe("debug channel", () => {
    it("receives debug envelopes via createDebugBusStream", async () => {
      socket.simulateMessage(subMsg("__global__", "debug"));

      const stream = createDebugBusStream();
      await writeAsync(stream, Buffer.from("hello world"));

      expect(socket.send).toHaveBeenCalledWith(
        JSON.stringify({ channel: "debug", type: "log", payload: { line: "hello world" } }),
      );
    });

    it("stops receiving after unsubscribe", async () => {
      socket.simulateMessage(subMsg("__global__", "debug"));

      const stream = createDebugBusStream();
      await writeAsync(stream, Buffer.from("first"));
      expect(socket.send).toHaveBeenCalledTimes(1);

      socket.simulateMessage(unsubMsg("__global__", "debug"));

      await writeAsync(stream, Buffer.from("second"));
      expect(socket.send).toHaveBeenCalledTimes(1);
    });

    it("skips empty lines", async () => {
      socket.simulateMessage(subMsg("__global__", "debug"));

      const stream = createDebugBusStream();
      await writeAsync(stream, Buffer.from("   "));

      expect(socket.send).not.toHaveBeenCalled();
    });
  });

  describe("ping", () => {
    it("replies with pong", () => {
      socket.simulateMessage(Buffer.from(JSON.stringify({ kind: "ping" })));

      expect(sentObjects(socket)).toContainEqual({
        channel: "__system__",
        type: "pong",
        payload: {},
      });
    });
  });

  describe("invalid messages", () => {
    it("silently ignores unparseable JSON", () => {
      socket.simulateMessage(Buffer.from("not json"));
      expect(socket.send).not.toHaveBeenCalled();
    });

    it("silently ignores invalid client message shape", () => {
      socket.simulateMessage(Buffer.from(JSON.stringify({ kind: "bogus" })));
      expect(socket.send).not.toHaveBeenCalled();
    });

    it("silently ignores subscribe with unknown projectId (schedule)", () => {
      socket.simulateMessage(subMsg("unknown", "schedule"));
      expect(scheduler.on).not.toHaveBeenCalled();
      expect(socket.send).not.toHaveBeenCalled();
    });

    it("silently ignores subscribe with unknown projectId (fs-watch)", () => {
      socket.simulateMessage(subMsg("unknown", "fs-watch"));
      expect(acquireFsWatch).not.toHaveBeenCalled();
      expect(socket.send).not.toHaveBeenCalled();
    });
  });

  describe("socket close", () => {
    it("releases all subscriptions on close", () => {
      socket.simulateMessage(subMsg("p1", "schedule"));
      socket.simulateMessage(subMsg("p1", "fs-watch"));
      socket.simulateMessage(subMsg("__global__", "debug"));

      socket.simulateClose();

      expect(scheduler.off).toHaveBeenCalledTimes(4);
      expect(releaseFsWatch).toHaveBeenCalledWith("p1", expect.any(Function));

      const stream = createDebugBusStream();
      return writeAsync(stream, Buffer.from("leaked?")).then(() => {
        expect(socket.send).not.toHaveBeenCalled();
      });
    });

    it("is idempotent on double close (error then close)", () => {
      socket.simulateMessage(subMsg("p1", "schedule"));

      socket.simulateError(new Error("boom"));
      socket.simulateClose();

      expect(scheduler.off).toHaveBeenCalledTimes(4);
    });
  });

  describe("debug subscriber registry", () => {
    it("addDebugSubscriber/removeDebugSubscriber manage the set", () => {
      const fn = vi.fn();
      addDebugSubscriber(fn);
      addDebugSubscriber(fn);

      const stream = createDebugBusStream();
      return writeAsync(stream, Buffer.from("ping")).then(() => {
        expect(fn).toHaveBeenCalledTimes(1);

        removeDebugSubscriber(fn);
        return writeAsync(stream, Buffer.from("pong")).then(() => {
          expect(fn).toHaveBeenCalledTimes(1);
        });
      });
    });
  });
});
