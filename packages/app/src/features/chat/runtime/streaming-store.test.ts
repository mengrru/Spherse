import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStreamingStore } from "./streaming-store";
import { useProjectDataStore } from "../../../stores/project-data-store";
import type { ApiClient } from "../../../lib/api";

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
      entries: [],
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

  it("does not treat a delayed heartbeat tick after renderer suspension as a timeout", async () => {
    const socket = await attachAndConnect();
    await vi.advanceTimersByTimeAsync(30_000);
    vi.setSystemTime(Date.now() + 120_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.closeSpy).not.toHaveBeenCalled();
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

  it("keeps the active run streaming across an unexpected close", async () => {
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

    expect(useStreamingStore.getState().sessions.s2.streaming).toBe(true);
    const messages = useStreamingStore.getState().sessions.s2.messages;
    const last = messages[messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last._streaming).toBe(true);
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

  it("does not reconnect after a fatal close code (4401)", async () => {
    const socket = await attachAndConnect("s5");
    expect(mock.instances).toHaveLength(1);

    socket.onclose?.({ code: 4401 } as CloseEvent);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mock.instances).toHaveLength(1);
  });

  it("preserves already-loaded messages after a fatal close", async () => {
    const client: ApiClient = {
      getSessionMessagesPage: vi.fn().mockResolvedValue({
        entries: [
          { id: 1, message: { role: "user", content: "old question" } },
          { id: 2, message: { role: "assistant", content: "old answer" } },
        ],
        hasMore: false,
        oldestId: null,
      }),
    } as unknown as ApiClient;
    useStreamingStore.getState().attach(client, "s7", BASE_URL, "p1", "a1");
    const socket = mock.instances[mock.instances.length - 1];
    socket.readyState = OPEN;
    socket.onopen?.({} as Event);
    await vi.advanceTimersByTimeAsync(0);

    const messagesBefore = useStreamingStore.getState().sessions.s7.messages;
    expect(messagesBefore.length).toBeGreaterThan(0);

    socket.onclose?.({ code: 4401 } as CloseEvent);
    await vi.advanceTimersByTimeAsync(60_000);

    const messagesAfter = useStreamingStore.getState().sessions.s7.messages;
    expect(messagesAfter).toEqual(messagesBefore);
    expect(messagesAfter.length).toBeGreaterThan(0);
  });

  it("reconciles history again on reconnect", async () => {
    const client = createMockClient();
    const historySpy = client.getSessionMessagesPage as ReturnType<typeof vi.fn>;
    useStreamingStore.getState().attach(client, "s8", BASE_URL, "p1", "a1");
    const socket = mock.instances[mock.instances.length - 1];
    socket.readyState = OPEN;
    socket.onopen?.({} as Event);
    await vi.advanceTimersByTimeAsync(0);

    expect(historySpy).toHaveBeenCalledTimes(1);

    socket.close();
    await vi.advanceTimersByTimeAsync(1000);
    const reopened = mock.instances[mock.instances.length - 1];
    reopened.readyState = OPEN;
    reopened.onopen?.({} as Event);
    await vi.advanceTimersByTimeAsync(0);

    expect(historySpy).toHaveBeenCalledTimes(2);
  });

  it("recovers a response that completed while the websocket was disconnected", async () => {
    const client = createMockClient();
    useStreamingStore.getState().attach(client, "s9", BASE_URL, "p1", "a1");
    const socket = mock.instances[mock.instances.length - 1];
    socket.readyState = OPEN;
    socket.onopen?.({} as Event);
    await vi.advanceTimersByTimeAsync(0);

    useStreamingStore.getState().sendMessage("s9", "hi");
    socket.onmessage?.({
      data: JSON.stringify({
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "partial" }],
        },
      }),
    } as MessageEvent);
    await vi.advanceTimersByTimeAsync(0);
    expect(useStreamingStore.getState().sessions.s9.streaming).toBe(true);

    (client.getSessionMessagesPage as ReturnType<typeof vi.fn>).mockResolvedValue({
      entries: [
        { id: 1, message: { role: "user", content: "hi", timestamp: 10 } },
        {
          id: 2,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "done" }],
            timestamp: 20,
          },
        },
      ],
      hasMore: false,
      oldestId: 1,
    });
    socket.close();
    await vi.advanceTimersByTimeAsync(1000);
    const reopened = mock.instances[mock.instances.length - 1];
    reopened.readyState = OPEN;
    reopened.onopen?.({} as Event);
    reopened.onmessage?.({
      data: JSON.stringify({ type: "run_status", active: false }),
    } as MessageEvent);
    await vi.advanceTimersByTimeAsync(0);

    const recovered = useStreamingStore.getState().sessions.s9;
    expect(recovered.streaming).toBe(false);
    expect(recovered.messages.map((message) => message.content)).toEqual([
      "hi",
      "done",
    ]);
  });

  it("refreshHistory reconciles the latest page while retaining older cached messages", async () => {
    const client: ApiClient = {
      getSessionMessagesPage: vi.fn().mockResolvedValue({
        entries: [
          { id: 1, message: { role: "user", content: "old" } },
          { id: 2, message: { role: "assistant", content: "old reply" } },
        ],
        hasMore: false,
        oldestId: 5,
      }),
    } as unknown as ApiClient;
    useStreamingStore.getState().attach(client, "sr", BASE_URL, "p1", "a1");
    const socket = mock.instances[mock.instances.length - 1];
    socket.readyState = OPEN;
    socket.onopen?.({} as Event);
    await vi.advanceTimersByTimeAsync(0);

    (client.getSessionMessagesPage as ReturnType<typeof vi.fn>).mockResolvedValue({
      entries: [
        { id: 3, message: { role: "user", content: "new" } },
        { id: 4, message: { role: "assistant", content: "fresh reply" } },
      ],
      hasMore: true,
      oldestId: 9,
    });

    useStreamingStore.getState().refreshHistory(client, "a1", "sr");
    await vi.advanceTimersByTimeAsync(0);

    const messages = useStreamingStore.getState().sessions.sr.messages;
    expect(messages.map((m) => m.content)).toEqual([
      "old",
      "old reply",
      "new",
      "fresh reply",
    ]);
    expect(useStreamingStore.getState().sessions.sr.hasMore).toBe(true);
  });

  it("refreshHistory is a no-op when the session is not cached", async () => {
    const client = createMockClient();
    const spy = client.getSessionMessagesPage as ReturnType<typeof vi.fn>;
    useStreamingStore.getState().refreshHistory(client, "a1", "unknown");
    await vi.advanceTimersByTimeAsync(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refreshHistory does not clobber a session that is actively streaming", async () => {
    const client: ApiClient = {
      getSessionMessagesPage: vi.fn().mockResolvedValue({ entries: [], hasMore: false, oldestId: null }),
    } as unknown as ApiClient;
    useStreamingStore.getState().attach(client, "ss", BASE_URL, "p1", "a1");
    const socket = mock.instances[mock.instances.length - 1];
    socket.readyState = OPEN;
    socket.onopen?.({} as Event);
    useStreamingStore.getState().sendMessage("ss", "hi");
    socket.onmessage?.({
      data: JSON.stringify({ type: "message_start", message: { role: "assistant" } }),
    } as MessageEvent);
    await vi.advanceTimersByTimeAsync(0);

    expect(useStreamingStore.getState().sessions.ss.streaming).toBe(true);
    const spy = client.getSessionMessagesPage as ReturnType<typeof vi.fn>;
    spy.mockClear();

    useStreamingStore.getState().refreshHistory(client, "a1", "ss");
    await vi.advanceTimersByTimeAsync(0);

    expect(spy).not.toHaveBeenCalled();
  });
});
