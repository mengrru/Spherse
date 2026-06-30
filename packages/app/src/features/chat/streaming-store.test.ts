import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStreamingStore } from "./streaming-store";
import { useProjectDataStore } from "../../stores/project-data-store";
import type { ApiClient } from "../../lib/api";

interface MockWebSocketInstance {
  url: string;
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  sent: string[];
  closeSpy: ReturnType<typeof vi.fn>;
  close: () => void;
}

const OPEN = 1;
const CONNECTING = 0;
const CLOSED = 3;

function createMockWebSocket() {
  const instances: MockWebSocketInstance[] = [];

  class MockWebSocket {
    static OPEN = OPEN;
    static CONNECTING = CONNECTING;
    static CLOSING = 2;
    static CLOSED = CLOSED;
    url: string;
    readyState = CONNECTING;
    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    sent: string[] = [];
    closeSpy = vi.fn();
    constructor(url: string) {
      this.url = url;
      instances.push(this as unknown as MockWebSocketInstance);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.readyState = CLOSED;
      this.closeSpy();
      this.onclose?.({} as CloseEvent);
    }
  }

  return { MockWebSocket, instances };
}

function createMockClient(): ApiClient {
  return {
    getSessionMessagesPage: vi.fn().mockResolvedValue({
      messages: [],
      hasMore: false,
      oldestId: null,
    }),
  } as unknown as ApiClient;
}

const BASE_URL = "http://localhost:5173";

describe("streaming-store resilience", () => {
  let mock: ReturnType<typeof createMockWebSocket>;

  beforeEach(() => {
    vi.useFakeTimers();
    mock = createMockWebSocket();
    vi.stubGlobal("WebSocket", mock.MockWebSocket);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number,
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
    useProjectDataStore.setState({ projects: {} });
  });

  afterEach(() => {
    for (const id of Object.keys(useStreamingStore.getState().sessions)) {
      useStreamingStore.getState().disconnect(id);
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function attachAndConnect(sessionId = "s1") {
    const client = createMockClient();
    useStreamingStore.getState().attach(client, sessionId, BASE_URL, "p1", "a1");
    const socket = mock.instances[mock.instances.length - 1];
    socket.readyState = OPEN;
    socket.onopen?.({} as Event);
    await vi.advanceTimersByTimeAsync(0);
    return socket;
  }

  it("attach opens a websocket to the chat endpoint", async () => {
    const socket = await attachAndConnect();
    expect(socket.url).toBe(`ws://localhost:5173/ws/projects/p1/chat/a1/s1`);
  });

  it("heartbeat sends ping every 30s", async () => {
    const socket = await attachAndConnect();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.sent.map((s) => JSON.parse(s))).toContainEqual({ type: "ping" });
  });

  it("pong resets the heartbeat so the socket stays open", async () => {
    const socket = await attachAndConnect();
    await vi.advanceTimersByTimeAsync(30_000);
    socket.onmessage?.({ data: JSON.stringify({ type: "pong" }) } as MessageEvent);
    await vi.advanceTimersByTimeAsync(30_000);
    socket.onmessage?.({ data: JSON.stringify({ type: "pong" }) } as MessageEvent);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.closeSpy).not.toHaveBeenCalled();
  });

  it("closes the socket when no pong arrives within 60s", async () => {
    const socket = await attachAndConnect();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(socket.closeSpy).toHaveBeenCalled();
  });

  it("reconnects with backoff after an unexpected close while attached", async () => {
    const socket = await attachAndConnect();
    expect(mock.instances).toHaveLength(1);

    socket.close();
    expect(mock.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mock.instances).toHaveLength(2);
    const reopened = mock.instances[mock.instances.length - 1];
    expect(reopened).not.toBe(socket);
    reopened.readyState = OPEN;
    reopened.onopen?.({} as Event);
  });

  it("does not reconnect after disconnect", async () => {
    const socket = await attachAndConnect();
    useStreamingStore.getState().disconnect("s1");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.instances).toHaveLength(1);
    expect(socket.closeSpy).toHaveBeenCalled();
  });

  it("finalizes an orphaned streaming message on unexpected close", async () => {
    const client = createMockClient();
    useStreamingStore.getState().attach(client, "s2", BASE_URL, "p1", "a1");
    const socket = mock.instances[mock.instances.length - 1];
    socket.readyState = OPEN;
    socket.onopen?.({} as Event);

    useStreamingStore.getState().sendMessage("s2", "hi");
    socket.onmessage?.({
      data: JSON.stringify({ type: "message_start", message: { role: "assistant" } }),
    } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "partial" }] },
      }),
    } as MessageEvent);
    await vi.advanceTimersByTimeAsync(0);

    expect(useStreamingStore.getState().sessions.s2.streaming).toBe(true);

    socket.close();
    await vi.advanceTimersByTimeAsync(0);

    expect(useStreamingStore.getState().sessions.s2.streaming).toBe(false);
    const messages = useStreamingStore.getState().sessions.s2.messages;
    const last = messages[messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last._streaming).toBe(false);
  });

  it("escalates backoff across repeated reconnect failures", async () => {
    const socket = await attachAndConnect("s3");
    socket.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mock.instances).toHaveLength(2);
    mock.instances[mock.instances.length - 1].close();
    await vi.advanceTimersByTimeAsync(1999);
    expect(mock.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.instances).toHaveLength(3);
  });

  it("does not resend the initial message on reconnect", async () => {
    const client = createMockClient();
    useStreamingStore.getState().attach(client, "s4", BASE_URL, "p1", "a1", "first message");
    const socket = mock.instances[mock.instances.length - 1];
    socket.readyState = OPEN;
    socket.onopen?.({} as Event);
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.sent.map((s) => JSON.parse(s))).toContainEqual({ type: "message", content: "first message" });

    socket.close();
    await vi.advanceTimersByTimeAsync(1000);
    const reopened = mock.instances[mock.instances.length - 1];
    reopened.readyState = OPEN;
    reopened.onopen?.({} as Event);
    await vi.advanceTimersByTimeAsync(0);
    expect(reopened.sent.map((s) => JSON.parse(s))).not.toContainEqual({ type: "message", content: "first message" });
  });
});
