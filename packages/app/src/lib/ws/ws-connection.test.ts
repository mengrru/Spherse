import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WsConnection, type WsConnectionStateChange } from "./ws-connection";
import {
  createMockWebSocket,
  openInstance,
  type MockWebSocketInstance,
} from "../../test/mock-web-socket";

const PING = JSON.stringify({ kind: "ping" });
const PONG = JSON.stringify({ channel: "__system__", type: "pong", payload: {} });

function createConfig(overrides?: Partial<ConstructorParameters<typeof WsConnection>[0]>) {
  return {
    url: () => "ws://localhost:5173/ws/bus",
    heartbeat: { pingIntervalMs: 30_000, pongTimeoutMs: 60_000 },
    backoffMs: [1000, 2000, 5000, 10_000, 30_000],
    maxRetries: 10,
    fatalCloseCodes: new Set([4400, 4401, 4402]),
    probeTimeoutMs: 5000,
    pingPayload: PING,
    isPong: (parsed: unknown) =>
      (parsed as { channel?: string; type?: string })?.channel === "__system__" &&
      (parsed as { type?: string })?.type === "pong",
    label: "test-ws",
    ...overrides,
  };
}

function harness(configOverrides?: Parameters<typeof createConfig>[0]) {
  const states: WsConnectionStateChange[] = [];
  const messages: unknown[] = [];
  const conn = new WsConnection(createConfig(configOverrides), {
    onMessage: (parsed) => messages.push(parsed),
    onStateChange: (change) => states.push(change),
  });
  return { conn, states, messages };
}

function lastInstance(): MockWebSocketInstance {
  const inst = mock.instances[mock.instances.length - 1];
  if (!inst) throw new Error("no websocket instance");
  return inst;
}

let mock: ReturnType<typeof createMockWebSocket>;

async function connectAndOpen(h: ReturnType<typeof harness>) {
  h.conn.connect();
  await vi.advanceTimersByTimeAsync(0);
  openInstance(lastInstance());
}

describe("WsConnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock = createMockWebSocket();
    vi.stubGlobal("WebSocket", mock.MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("connect / state machine", () => {
    it("goes idle → connecting → open and evaluates url per attempt", async () => {
      let urlCalls = 0;
      const h = harness({ url: () => `ws://host/${urlCalls++}` });
      h.conn.connect();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.states.map((s) => s.state)).toEqual(["connecting"]);
      expect(lastInstance().url).toBe("ws://host/0");
      openInstance(lastInstance());
      expect(h.states.map((s) => s.state)).toEqual(["connecting", "open"]);
    });

    it("supports async url resolution", async () => {
      const h = harness({ url: async () => "ws://async/host" });
      h.conn.connect();
      expect(mock.instances).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(lastInstance().url).toBe("ws://async/host");
    });

    it("is a no-op when already connecting or open", async () => {
      const h = harness();
      h.conn.connect();
      await vi.advanceTimersByTimeAsync(0);
      h.conn.connect();
      await vi.advanceTimersByTimeAsync(0);
      openInstance(lastInstance());
      h.conn.connect();
      await vi.advanceTimersByTimeAsync(0);
      expect(mock.instances).toHaveLength(1);
    });

    it("stays silent when url resolves empty (caller decides)", async () => {
      const h = harness({ url: () => "" });
      h.conn.connect();
      await vi.advanceTimersByTimeAsync(0);
      expect(mock.instances).toHaveLength(0);
      expect(h.states).toHaveLength(0);
      expect(h.conn.getState()).toBe("idle");
    });

    it("keeps retrying when url resolves empty during a retry cycle and recovers", async () => {
      const urls = ["ws://host/1", "", "ws://host/2"];
      const h = harness({ url: () => urls.shift() ?? "ws://host/2" });
      await connectAndOpen(h);
      lastInstance().close();
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.states.at(-1)).toMatchObject({ state: "waiting-backoff", attempt: 2, delayMs: 2000 });
      await vi.advanceTimersByTimeAsync(2000);
      openInstance(lastInstance());
      expect(lastInstance().url).toBe("ws://host/2");
      expect(h.conn.getState()).toBe("open");
    });

    it("retries with backoff when the WebSocket constructor throws", async () => {
      class ThrowingWebSocket extends mock.MockWebSocket {
        constructor(url: string) {
          super(url);
          throw new Error("invalid url");
        }
      }
      vi.stubGlobal("WebSocket", ThrowingWebSocket);
      const h = harness({ url: () => "ws://host/x", maxRetries: 1 });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      h.conn.connect();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.states.at(-1)).toMatchObject({ state: "waiting-backoff", attempt: 1 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.states.at(-1)?.state).toBe("failed");
      warn.mockRestore();
    });

    it("delivers parsed non-pong messages and swallows pongs", async () => {
      const h = harness();
      await connectAndOpen(h);
      const ws = lastInstance();
      ws.onmessage?.({ data: JSON.stringify({ channel: "trigger", type: "t" }) } as MessageEvent);
      ws.onmessage?.({ data: PONG } as MessageEvent);
      expect(h.messages).toEqual([{ channel: "trigger", type: "t" }]);
    });

    it("warns but does not throw on unparseable messages", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const h = harness();
      await connectAndOpen(h);
      expect(() => {
        lastInstance().onmessage?.({ data: "not-json" } as MessageEvent);
      }).not.toThrow();
      expect(warn).toHaveBeenCalled();
      expect(h.conn.getState()).toBe("open");
      warn.mockRestore();
    });

    it("ignores events from a superseded socket", async () => {
      const h = harness();
      await connectAndOpen(h);
      const stale = lastInstance();
      h.conn.close();
      h.conn.connect();
      await vi.advanceTimersByTimeAsync(0);
      const fresh = lastInstance();
      expect(fresh).not.toBe(stale);
      const statesBefore = h.states.length;
      stale.onclose?.({ code: 1000 } as CloseEvent);
      stale.onmessage?.({ data: JSON.stringify({ x: 1 }) } as MessageEvent);
      expect(h.states).toHaveLength(statesBefore);
      expect(h.messages).toHaveLength(0);
      expect(h.conn.getState()).toBe("connecting");
    });
  });

  describe("backoff / retries", () => {
    it("follows the backoff sequence and reports waiting-backoff with attempt/delay", async () => {
      const h = harness();
      await connectAndOpen(h);
      lastInstance().close();
      expect(h.states.at(-1)).toMatchObject({ state: "waiting-backoff", attempt: 1, delayMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.states.at(-1)?.state).toBe("connecting");
      lastInstance().close();
      expect(h.states.at(-1)).toMatchObject({ state: "waiting-backoff", attempt: 2, delayMs: 2000 });
      await vi.advanceTimersByTimeAsync(2000);
      lastInstance().close();
      expect(h.states.at(-1)).toMatchObject({ state: "waiting-backoff", attempt: 3, delayMs: 5000 });
    });

    it("caps the delay at the last backoff entry", async () => {
      const h = harness();
      await connectAndOpen(h);
      for (let i = 0; i < 6; i++) {
        lastInstance().close();
        await vi.advanceTimersByTimeAsync(h.states.at(-1)!.delayMs);
      }
      lastInstance().close();
      expect(h.states.at(-1)).toMatchObject({ state: "waiting-backoff", delayMs: 30_000 });
    });

    it("transitions to failed when retries are exhausted", async () => {
      const h = harness({ maxRetries: 2 });
      await connectAndOpen(h);
      lastInstance().close();
      await vi.advanceTimersByTimeAsync(1000);
      lastInstance().close();
      await vi.advanceTimersByTimeAsync(2000);
      lastInstance().close();
      expect(h.states.at(-1)?.state).toBe("failed");
      expect(mock.instances).toHaveLength(3);
    });

    it("stops reconnecting forever on a fatal close code and reports the code", async () => {
      const h = harness({ maxRetries: Infinity });
      await connectAndOpen(h);
      const ws = lastInstance();
      ws.readyState = 3;
      ws.onclose?.({ code: 4401 } as CloseEvent);
      expect(h.states.at(-1)).toMatchObject({ state: "fatal", closeCode: 4401 });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mock.instances).toHaveLength(1);
    });

    it("reconnect() resets the attempt counter and connects immediately", async () => {
      const h = harness();
      await connectAndOpen(h);
      lastInstance().close();
      expect(h.states.at(-1)).toMatchObject({ state: "waiting-backoff", attempt: 1 });
      h.conn.reconnect();
      await vi.advanceTimersByTimeAsync(0);
      expect(mock.instances).toHaveLength(2);
      openInstance(lastInstance());
      lastInstance().close();
      expect(h.states.at(-1)).toMatchObject({ state: "waiting-backoff", attempt: 1, delayMs: 1000 });
    });

    it("reconnect() while open replaces the socket instead of orphaning it", async () => {
      const h = harness();
      await connectAndOpen(h);
      const first = lastInstance();
      h.conn.reconnect();
      await vi.advanceTimersByTimeAsync(0);
      expect(mock.instances).toHaveLength(2);
      expect(first.closeSpy).toHaveBeenCalled();
      expect(h.conn.getState()).toBe("connecting");
      openInstance(lastInstance());
      expect(h.conn.getState()).toBe("open");
    });

    it("manual close goes to closed and never reconnects", async () => {
      const h = harness();
      await connectAndOpen(h);
      h.conn.close();
      expect(h.conn.getState()).toBe("closed");
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mock.instances).toHaveLength(1);
      expect(h.states.at(-1)?.state).toBe("closed");
    });
  });

  describe("send", () => {
    it("returns false unless open", async () => {
      const h = harness();
      expect(h.conn.send("x")).toBe(false);
      h.conn.connect();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.conn.send("x")).toBe(false);
      openInstance(lastInstance());
      expect(h.conn.send("x")).toBe(true);
      expect(lastInstance().sent).toEqual(["x"]);
    });
  });

  describe("heartbeat", () => {
    it("closes the socket when no pong arrives within pongTimeout", async () => {
      const h = harness();
      await connectAndOpen(h);
      await vi.advanceTimersByTimeAsync(90_000);
      expect(lastInstance().closeSpy).toHaveBeenCalled();
      expect(h.conn.getState()).toBe("waiting-backoff");
    });

    it("does not close while pongs arrive", async () => {
      const h = harness();
      await connectAndOpen(h);
      const ws = lastInstance();
      for (let t = 0; t < 120_000; t += 30_000) {
        await vi.advanceTimersByTimeAsync(30_000);
        ws.onmessage?.({ data: PONG } as MessageEvent);
      }
      expect(ws.closeSpy).not.toHaveBeenCalled();
      expect(h.conn.getState()).toBe("open");
    });

    it("treats any incoming message as liveness (not only pongs)", async () => {
      const h = harness();
      await connectAndOpen(h);
      const ws = lastInstance();
      await vi.advanceTimersByTimeAsync(30_000);
      ws.onmessage?.({ data: JSON.stringify({ channel: "trigger", type: "x" }) } as MessageEvent);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(ws.closeSpy).not.toHaveBeenCalled();
    });

    it("resets the pong wait after a wall-clock jump (suspend resume)", async () => {
      const h = harness();
      await connectAndOpen(h);
      const ws = lastInstance();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(ws.sent.at(-1)).toBe(PING);
      vi.setSystemTime(Date.now() + 70_000);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(ws.closeSpy).not.toHaveBeenCalled();
      expect(h.conn.getState()).toBe("open");
    });
  });

  describe("probe", () => {
    it("is a no-op when the socket is not open", async () => {
      const h = harness();
      h.conn.connect();
      await vi.advanceTimersByTimeAsync(0);
      expect(() => h.conn.probe()).not.toThrow();
      expect(lastInstance().sent).toHaveLength(0);
    });

    it("pings a healthy socket and clears the probe on pong", async () => {
      const h = harness();
      await connectAndOpen(h);
      const ws = lastInstance();
      h.conn.probe();
      expect(ws.sent).toEqual([PING]);
      ws.onmessage?.({ data: PONG } as MessageEvent);
      await vi.advanceTimersByTimeAsync(6000);
      expect(ws.closeSpy).not.toHaveBeenCalled();
      expect(h.conn.getState()).toBe("open");
    });

    it("closes the socket when the probe ping goes unanswered", async () => {
      const h = harness();
      await connectAndOpen(h);
      const ws = lastInstance();
      h.conn.probe();
      await vi.advanceTimersByTimeAsync(5000);
      expect(ws.closeSpy).toHaveBeenCalled();
      expect(h.conn.getState()).toBe("waiting-backoff");
    });

    it("re-arms a short probe against an already pending ping without double ping", async () => {
      const h = harness();
      await connectAndOpen(h);
      const ws = lastInstance();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(ws.sent.at(-1)).toBe(PING);
      const sentBefore = ws.sent.length;
      h.conn.probe();
      expect(ws.sent).toHaveLength(sentBefore);
      await vi.advanceTimersByTimeAsync(5000);
      expect(ws.closeSpy).toHaveBeenCalled();
    });

    it("closes immediately when the pending ping already exceeded pongTimeout", async () => {
      const h = harness();
      await connectAndOpen(h);
      const ws = lastInstance();
      await vi.advanceTimersByTimeAsync(30_000);
      vi.setSystemTime(Date.now() + 61_000);
      h.conn.probe();
      expect(ws.closeSpy).toHaveBeenCalled();
      expect(ws.sent).toHaveLength(1);
    });
  });
});
