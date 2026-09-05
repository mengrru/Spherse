import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBusStore } from "./bus-store";
import type { HostBridge } from "../lib/host-bridge";
import {
  createMockWebSocket,
  openInstance,
  WS_CONNECTING,
  WS_OPEN,
  type MockWebSocketInstance,
} from "../test/mock-web-socket";

function lastSentSubscribe(instances: MockWebSocketInstance[]) {
  const last = instances[instances.length - 1];
  if (!last) return undefined;
  return last.sent.map((s) => JSON.parse(s)).find((m) => m.kind === "subscribe");
}

function allSends(instances: MockWebSocketInstance[], kind: string) {
  return instances
    .flatMap((i) => i.sent)
    .map((s) => JSON.parse(s))
    .filter((m) => m.kind === kind);
}

function createMockHostBridge(): HostBridge {
  return {
    kind: "electron",
    capabilities: {
      filePicker: true,
      mobileAccess: false,
      openFileExternal: false,
      content: { editable: true },
    },
    getServerBaseUrl: vi.fn().mockResolvedValue("http://localhost:5173"),
    getSettings: vi.fn().mockResolvedValue(null),
    saveSettings: vi.fn().mockResolvedValue({ success: true }),
    openExternal: vi.fn(),
  } as unknown as HostBridge;
}

describe("bus-store", () => {
  let mock: ReturnType<typeof createMockWebSocket>;
  let bridge: HostBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    mock = createMockWebSocket();
    vi.stubGlobal("WebSocket", mock.MockWebSocket);
    bridge = createMockHostBridge();
    useBusStore.getState().teardown();
    useBusStore.setState({ status: "idle" });
  });

  afterEach(() => {
    useBusStore.getState().teardown();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function connect() {
    await useBusStore.getState().init(bridge);
    const socket = mock.instances[mock.instances.length - 1];
    openInstance(socket);
    return socket;
  }

  it("init creates a WebSocket to ws://localhost:<port>/ws/bus and goes open", async () => {
    await useBusStore.getState().init(bridge);
    expect(useBusStore.getState().status).toBe("connecting");
    const socket = mock.instances[mock.instances.length - 1];
    expect(socket.url).toBe("ws://localhost:5173/ws/bus");
    openInstance(socket);
    expect(useBusStore.getState().status).toBe("open");
  });

  it("does not create a socket when the server base url is unavailable", async () => {
    (bridge.getServerBaseUrl as ReturnType<typeof vi.fn>).mockResolvedValue("");
    await useBusStore.getState().init(bridge);
    expect(mock.instances).toHaveLength(0);
    expect(useBusStore.getState().status).toBe("idle");
  });

  it("first subscriber sends a subscribe message", async () => {
    const socket = await connect();
    socket.sent.length = 0;
    const handler = vi.fn();
    useBusStore.getState().addHandler("p1", "trigger", handler);
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toEqual({
      kind: "subscribe",
      projectId: "p1",
      channel: "trigger",
    });
  });

  it("second subscriber on the same key does not send subscribe again", async () => {
    const socket = await connect();
    useBusStore.getState().addHandler("p1", "trigger", vi.fn());
    socket.sent.length = 0;
    useBusStore.getState().addHandler("p1", "trigger", vi.fn());
    expect(socket.sent).toHaveLength(0);
  });

  it("removeHandler last subscriber sends unsubscribe", async () => {
    const socket = await connect();
    const handler = vi.fn();
    useBusStore.getState().addHandler("p1", "trigger", handler);
    socket.sent.length = 0;
    useBusStore.getState().removeHandler("p1", "trigger", handler);
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toEqual({
      kind: "unsubscribe",
      projectId: "p1",
      channel: "trigger",
    });
  });

  it("removeHandler non-last subscriber does not send unsubscribe", async () => {
    const socket = await connect();
    const h1 = vi.fn();
    const h2 = vi.fn();
    useBusStore.getState().addHandler("p1", "trigger", h1);
    useBusStore.getState().addHandler("p1", "trigger", h2);
    socket.sent.length = 0;
    useBusStore.getState().removeHandler("p1", "trigger", h1);
    expect(socket.sent).toHaveLength(0);
  });

  it("dispatches trigger events to matching handlers", async () => {
    const socket = await connect();
    const handler = vi.fn();
    useBusStore.getState().addHandler("p1", "trigger", handler);
    const payload = { agentId: "a1", triggerId: "t1", triggeredAt: 123 };
    socket.onmessage?.({ data: JSON.stringify({
      channel: "trigger",
      projectId: "p1",
      type: "trigger_triggered",
      payload,
    }) } as MessageEvent);
    expect(handler).toHaveBeenCalledWith("trigger_triggered", payload);
  });

  it("dispatches debug events via the __global__::debug key", async () => {
    const socket = await connect();
    const handler = vi.fn();
    useBusStore.getState().addHandler("__global__", "debug", handler);
    socket.onmessage?.({ data: JSON.stringify({
      channel: "debug",
      type: "log",
      payload: { line: "hello" },
    }) } as MessageEvent);
    expect(handler).toHaveBeenCalledWith("log", { line: "hello" });
  });

  it("swallows __system__ pong without calling handlers", async () => {
    const socket = await connect();
    const handler = vi.fn();
    useBusStore.getState().addHandler("p1", "trigger", handler);
    socket.onmessage?.({ data: JSON.stringify({
      channel: "__system__",
      type: "pong",
      payload: {},
    }) } as MessageEvent);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not throw on malformed messages", async () => {
    const socket = await connect();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => {
      socket.onmessage?.({ data: "not-json" } as MessageEvent);
    }).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(useBusStore.getState().status).toBe("open");
    warn.mockRestore();
  });

  it("reconnects with backoff and replays subscriptions on reopen", async () => {
    const socket = await connect();
    useBusStore.getState().addHandler("p1", "trigger", vi.fn());
    expect(allSends(mock.instances, "subscribe")).toHaveLength(1);

    socket.close();
    expect(useBusStore.getState().status).toBe("connecting");

    await vi.advanceTimersByTimeAsync(1000);
    const reopened = mock.instances[mock.instances.length - 1];
    expect(reopened).not.toBe(socket);
    openInstance(reopened);

    expect(useBusStore.getState().status).toBe("open");
    const subscribeAfterReconnect = lastSentSubscribe(mock.instances);
    expect(subscribeAfterReconnect).toEqual({
      kind: "subscribe",
      projectId: "p1",
      channel: "trigger",
    });
  });

  it("heartbeat closes the socket when no pong arrives within 60s", async () => {
    const socket = await connect();
    await vi.advanceTimersByTimeAsync(90000);
    expect(socket.closeSpy).toHaveBeenCalled();
    expect(useBusStore.getState().status).toBe("connecting");
  });

  it("sets resumedAt on open and updates it on reopen", async () => {
    expect(useBusStore.getState().resumedAt).toBeNull();
    const socket = await connect();
    const firstResumedAt = useBusStore.getState().resumedAt;
    expect(firstResumedAt).toBeTypeOf("number");

    await vi.advanceTimersByTimeAsync(1000);
    socket.close();
    await vi.advanceTimersByTimeAsync(1000);
    const reopened = mock.instances[mock.instances.length - 1];
    openInstance(reopened);

    // Strictly greater: catching a regression where onopen stops updating
    // resumedAt (fake timers freeze the clock, so advance first).
    expect(useBusStore.getState().resumedAt).toBeGreaterThan(firstResumedAt!);
  });

  it("teardown resets resumedAt", async () => {
    await connect();
    expect(useBusStore.getState().resumedAt).not.toBeNull();
    useBusStore.getState().teardown();
    expect(useBusStore.getState().resumedAt).toBeNull();
  });

  describe("resumeProbe", () => {
    it("is a no-op when the socket is not OPEN (existing reconnect owns it)", async () => {
      await useBusStore.getState().init(bridge);
      const socket = mock.instances[mock.instances.length - 1];
      socket.readyState = WS_CONNECTING;
      expect(() => useBusStore.getState().resumeProbe()).not.toThrow();
      expect(socket.closeSpy).not.toHaveBeenCalled();
      expect(socket.sent).toHaveLength(0);
    });

    it("re-arms a short probe against the stale pending ping and closes it (intentional change: old lastPongAt model closed immediately; the 60s heartbeat watchdog now owns the hard timeout)", async () => {
      const socket = await connect();
      await vi.advanceTimersByTimeAsync(61000);
      socket.closeSpy.mockClear();
      const sentBefore = socket.sent.length;
      useBusStore.getState().resumeProbe();
      expect(socket.sent).toHaveLength(sentBefore);
      await vi.advanceTimersByTimeAsync(5000);
      expect(socket.closeSpy).toHaveBeenCalled();
      expect(useBusStore.getState().status).toBe("connecting");
    });

    it("pings a healthy socket and does not close when pong arrives in time", async () => {
      const socket = await connect();
      socket.sent.length = 0;
      useBusStore.getState().resumeProbe();
      expect(JSON.parse(socket.sent[0])).toEqual({ kind: "ping" });
      socket.onmessage?.({ data: JSON.stringify({
        channel: "__system__",
        type: "pong",
        payload: {},
      }) } as MessageEvent);
      await vi.advanceTimersByTimeAsync(6000);
      expect(socket.closeSpy).not.toHaveBeenCalled();
      expect(useBusStore.getState().status).toBe("open");
    });

    it("closes the socket when no pong arrives within the probe timeout", async () => {
      const socket = await connect();
      socket.sent.length = 0;
      useBusStore.getState().resumeProbe();
      expect(JSON.parse(socket.sent[0])).toEqual({ kind: "ping" });
      await vi.advanceTimersByTimeAsync(5000);
      expect(socket.closeSpy).toHaveBeenCalled();
      expect(useBusStore.getState().status).toBe("connecting");
    });
  });

  it("init during waiting-backoff is a no-op; the pending backoff still reconnects", async () => {
    const socket = await connect();
    socket.close();
    expect(useBusStore.getState().status).toBe("connecting");
    await useBusStore.getState().init(bridge);
    expect(mock.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mock.instances).toHaveLength(2);
    openInstance(mock.instances[1]);
    expect(useBusStore.getState().status).toBe("open");
  });

  it("keeps the socket reference across state (sanity: open socket is used for sends)", async () => {
    await connect();
    expect(useBusStore.getState().emitAgentTriggerEvent("p1", "evt", "x")).toBeUndefined();
    const socket = mock.instances[mock.instances.length - 1];
    expect(socket.sent.at(-1)).toBe(JSON.stringify({
      kind: "emit-trigger-event",
      projectId: "p1",
      eventName: "evt",
      payload: "x",
    }));
    expect(socket.readyState).toBe(WS_OPEN);
  });
});
