import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStreamingStore } from "./replica-store";
import { collectPendingApprovals } from "./model/approval-notice";
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

interface MockClientOptions {
  page?: { entries: Array<{ id: number; message: object }>; hasMore?: boolean; oldestId?: number | null };
  events?: Array<{ events: object[]; hasMore?: boolean }>;
}

function createMockClient(opts: MockClientOptions = {}): ApiClient {
  return {
    getSessionMessagesPage: vi.fn().mockImplementation(() =>
      Promise.resolve(opts.page ? { hasMore: false, oldestId: null, ...opts.page } : { entries: [], hasMore: false, oldestId: null }),
    ),
    getSessionEvents: vi.fn().mockImplementation(() => {
      const page = opts.events?.shift();
      return Promise.resolve(page ? { hasMore: false, ...page } : { events: [], hasMore: false });
    }),
  } as unknown as ApiClient;
}

const BASE_URL = "http://localhost:5173";

function userMessage(content: string) {
  return { role: "user", content, timestamp: 1 };
}

function assistantText(text: string) {
  return { role: "assistant", content: [{ type: "text", text }], timestamp: 2 };
}

describe("replica-store resilience", () => {
  let mock: ReturnType<typeof createMockWebSocket>;

  beforeEach(() => {
    vi.useFakeTimers();
    mock = createMockWebSocket();
    vi.stubGlobal("WebSocket", mock.MockWebSocket);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 1) as unknown as number,
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

  async function settle(rounds = 8) {
    for (let i = 0; i < rounds; i++) {
      await vi.advanceTimersByTimeAsync(1);
    }
  }

  async function attachAndConnect(sessionId = "s1", client?: ApiClient) {
    const apiClient = client ?? createMockClient();
    useStreamingStore.getState().attach(apiClient, sessionId, BASE_URL, "p1", "a1");
    const socket = mock.instances[mock.instances.length - 1];
    socket.readyState = OPEN;
    socket.onopen?.({} as Event);
    await settle(2);
    socket.onmessage?.({ data: JSON.stringify({ type: "run_status", active: false }) } as MessageEvent);
    await settle();
    return socket;
  }

  function emit(socket: MockWebSocketInstance, events: object[]) {
    for (const event of events) {
      socket.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
    }
  }

  function sentPayloads(socket: MockWebSocketInstance) {
    return socket.sent.map((s) => JSON.parse(s));
  }

  function sessionOf(sessionId: string) {
    return useStreamingStore.getState().sessions[sessionId];
  }

  it("attach opens a websocket to the chat endpoint", async () => {
    const socket = await attachAndConnect();
    expect(socket.url).toBe(`ws://localhost:5173/ws/projects/p1/chat/a1/s1`);
  });

  it("cold start loads the snapshot page and marks history ready", async () => {
    const client = createMockClient({
      page: { entries: [{ id: 0, message: userMessage("cached") }] },
    });
    const socket = await attachAndConnect("cold", client);
    expect(client.getSessionMessagesPage).toHaveBeenCalledWith("a1", "cold", { limit: 20 });
    expect(client.getSessionEvents).toHaveBeenCalled();
    expect(sessionOf("cold").messages.map((message) => message.content)).toEqual(["cached"]);
    expect(sessionOf("cold").historyStatus).toBe("ready");
    void socket;
  });

  it("heartbeat sends ping every 30s", async () => {
    const socket = await attachAndConnect();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sentPayloads(socket)).toContainEqual({ type: "ping" });
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

  describe("sendMessage (intents)", () => {
    it("attaches an optimistic user message, the intentId wire frame, and settles via the confirmation frame", async () => {
      const socket = await attachAndConnect("send1");
      useStreamingStore.getState().sendMessage("send1", "hello");
      await settle(2);

      const record = sessionOf("send1");
      expect(record.streaming).toBe(true);
      expect(record.messages.at(-1)).toMatchObject({ role: "user", content: "hello", _optimistic: true });
      const payload = sentPayloads(socket).find((p) => p.type === "message" && p.content === "hello");
      expect(typeof payload.intentId).toBe("string");

      emit(socket, [
        { type: "message_settled", seq: 0, message: userMessage("hello"), intentId: payload.intentId },
        { type: "run_status", active: true },
      ]);
      await settle(2);
      expect(sessionOf("send1").messages.at(-1)).toMatchObject({ content: "hello", _messageId: 0 });
      expect(sessionOf("send1").messages.at(-1)?._optimistic).toBeUndefined();
    });

    it("marks the intent failed when the socket is closed at send time", async () => {
      const socket = await attachAndConnect("send2");
      socket.readyState = CLOSED;
      useStreamingStore.getState().sendMessage("send2", "never sent");
      await settle(2);
      const last = sessionOf("send2").messages.at(-1);
      expect(last).toMatchObject({ content: "never sent", _sendFailed: true });
      expect(sessionOf("send2").streaming).toBe(false);
    });

    it("attaches image metadata to the optimistic user message and the websocket payload", async () => {
      const socket = await attachAndConnect("img1");
      const image = {
        path: ".spherse/attachments/x.png",
        mimeType: "image/png",
        width: 10,
        height: 20,
        previewUrl: `${BASE_URL}/preview/x.png`,
      };

      useStreamingStore.getState().sendMessage("img1", "look", image);
      await settle(2);

      expect(sessionOf("img1").messages.at(-1)).toMatchObject({
        role: "user",
        content: "look",
        _optimistic: true,
        _attachments: [
          { type: "image", path: ".spherse/attachments/x.png", mimeType: "image/png", width: 10, height: 20 },
        ],
      });
      expect(sentPayloads(socket)).toContainEqual({
        type: "message",
        content: "look",
        attachments: [{ type: "image", path: ".spherse/attachments/x.png", mimeType: "image/png" }],
        intentId: expect.any(String),
      });
    });

    it("sends a text-only message without attachments when no image is provided", async () => {
      const socket = await attachAndConnect("img2");
      useStreamingStore.getState().sendMessage("img2", "hello");
      await settle(2);

      const payload = sentPayloads(socket).find((p) => p.type === "message" && p.content === "hello");
      expect(payload.attachments).toBeUndefined();
      expect(sessionOf("img2").messages.at(-1)?._attachments).toBeUndefined();
    });
  });

  describe("withdraw", () => {
    it("sends withdraw and applies turn_withdrawn{seq, upTo} to drop the last user turn", async () => {
      const socket = await attachAndConnect("w1");
      useStreamingStore.getState().sendMessage("w1", "q2");
      const intentId = sentPayloads(socket).find((p) => p.type === "message")?.intentId;
      emit(socket, [
        { type: "message_settled", seq: 0, message: userMessage("q2"), intentId },
        { type: "message_end", message: assistantText("a2"), seq: 1 },
        { type: "message_settled", seq: 1, message: assistantText("a2") },
        { type: "run_status", active: false },
      ]);
      await settle(2);
      expect(sessionOf("w1").streaming).toBe(false);

      useStreamingStore.getState().withdrawLastTurn("w1");
      expect(sentPayloads(socket)).toContainEqual({ type: "withdraw" });

      emit(socket, [{ type: "turn_withdrawn", seq: 0, upTo: 2 }]);
      await settle(2);
      expect(sessionOf("w1").messages).toEqual([]);
    });

    it("is a no-op while streaming", async () => {
      const socket = await attachAndConnect("w2");
      useStreamingStore.getState().sendMessage("w2", "hi");
      await settle(2);
      expect(sessionOf("w2").streaming).toBe(true);

      useStreamingStore.getState().withdrawLastTurn("w2");
      expect(sentPayloads(socket)).not.toContainEqual({ type: "withdraw" });
    });

    it("is a no-op when the last user message failed to send", async () => {
      const socket = await attachAndConnect("w3");
      socket.readyState = CLOSED;
      useStreamingStore.getState().sendMessage("w3", "never sent");
      await settle(2);
      const failed = sessionOf("w3").messages.at(-1);
      expect(failed?._sendFailed).toBe(true);

      useStreamingStore.getState().withdrawLastTurn("w3");
      expect(sentPayloads(socket)).not.toContainEqual({ type: "withdraw" });
    });

    it("marks a withdraw failure error bubble as non-retryable", async () => {
      const socket = await attachAndConnect("w4");
      useStreamingStore.getState().sendMessage("w4", "q1");
      const intentId = sentPayloads(socket).find((p) => p.type === "message")?.intentId;
      emit(socket, [
        { type: "message_settled", seq: 0, message: userMessage("q1"), intentId },
        { type: "message_settled", seq: 1, message: assistantText("a1") },
        { type: "run_status", active: false },
      ]);
      await settle(2);

      useStreamingStore.getState().withdrawLastTurn("w4");
      emit(socket, [
        { type: "error", message: "Session \"w4\" has no user message to withdraw", code: "PERMANENT" },
      ]);
      await settle(2);

      const last = sessionOf("w4").messages.at(-1);
      expect(last?._error).toContain("no user message to withdraw");
      expect(last?._withdrawError).toBe(true);
    });
  });

  describe("reconnect and resync", () => {
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

    it("does not reconnect after a fatal close code (4401)", async () => {
      const socket = await attachAndConnect("s5");
      expect(mock.instances).toHaveLength(1);

      socket.onclose?.({ code: 4401 } as CloseEvent);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mock.instances).toHaveLength(1);
    });

    it("preserves already-loaded messages after a fatal close", async () => {
      const client = createMockClient({
        page: { entries: [
          { id: 1, message: userMessage("old question") },
          { id: 2, message: assistantText("old answer") },
        ] },
      });
      useStreamingStore.getState().attach(client, "s7", BASE_URL, "p1", "a1");
      const socket = mock.instances[mock.instances.length - 1];
      socket.readyState = OPEN;
      socket.onopen?.({} as Event);
      await settle(2);
      socket.onmessage?.({ data: JSON.stringify({ type: "run_status", active: false }) } as MessageEvent);
      await settle();

      const messagesBefore = sessionOf("s7").messages;
      expect(messagesBefore.length).toBeGreaterThan(0);

      socket.onclose?.({ code: 4401 } as CloseEvent);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(sessionOf("s7").messages).toEqual(messagesBefore);
    });

    it("keeps the active run streaming across an unexpected close", async () => {
      const socket = await attachAndConnect("s2");
      useStreamingStore.getState().sendMessage("s2", "hi");
      emit(socket, [
        { type: "run_status", active: true },
        { type: "message_start", message: { role: "assistant", content: [], timestamp: 1 } },
        { type: "message_update", message: assistantText("partial") },
      ]);
      await settle(2);
      expect(sessionOf("s2").streaming).toBe(true);

      socket.close();
      await settle(2);

      expect(sessionOf("s2").streaming).toBe(true);
      const last = sessionOf("s2").messages.at(-1);
      expect(last).toMatchObject({ role: "assistant", _streaming: true });
    });

    it("does not resend the initial message on reconnect", async () => {
      const client = createMockClient();
      useStreamingStore.getState().attach(client, "s4", BASE_URL, "p1", "a1", "first message");
      const socket = mock.instances[mock.instances.length - 1];
      socket.readyState = OPEN;
      socket.onopen?.({} as Event);
      await settle(2);
      expect(sentPayloads(socket)).toContainEqual({ type: "message", content: "first message", intentId: expect.any(String) });

      socket.close();
      await vi.advanceTimersByTimeAsync(1000);
      const reopened = mock.instances[mock.instances.length - 1];
      reopened.readyState = OPEN;
      reopened.onopen?.({} as Event);
      await settle(2);
      expect(sentPayloads(reopened)).not.toContainEqual({ type: "message", content: "first message", intentId: expect.any(String) });
    });

    it("runs a catch-up sync on reconnect (events endpoint)", async () => {
      const client = createMockClient();
      const eventsSpy = client.getSessionEvents as ReturnType<typeof vi.fn>;
      await attachAndConnect("s8", client);
      expect(eventsSpy).toHaveBeenCalledTimes(1);

      const socket = mock.instances[mock.instances.length - 1];
      socket.close();
      await vi.advanceTimersByTimeAsync(1000);
      const reopened = mock.instances[mock.instances.length - 1];
      reopened.readyState = OPEN;
      reopened.onopen?.({} as Event);
      emit(reopened, [{ type: "run_status", active: false }]);
      await settle(2);

      expect(eventsSpy).toHaveBeenCalledTimes(2);
    });

    it("recovers a response that completed while the websocket was disconnected via tier-2 events", async () => {
      const client = createMockClient();
      useStreamingStore.getState().attach(client, "s9", BASE_URL, "p1", "a1");
      const socket = mock.instances[mock.instances.length - 1];
      socket.readyState = OPEN;
      socket.onopen?.({} as Event);
      await settle(2);

      useStreamingStore.getState().sendMessage("s9", "hi");
      const intentId = sentPayloads(socket).find((p) => p.type === "message")?.intentId;
      emit(socket, [
        { type: "run_status", active: true },
        { type: "message_update", message: assistantText("partial") },
      ]);
      await settle(2);
      expect(sessionOf("s9").streaming).toBe(true);

      (client.getSessionEvents as ReturnType<typeof vi.fn>).mockResolvedValue({
        events: [
          { type: "message_settled", seq: 0, message: userMessage("hi"), intentId },
          { type: "message_settled", seq: 1, message: assistantText("done") },
        ],
        hasMore: false,
      });

      socket.close();
      await vi.advanceTimersByTimeAsync(1000);
      const reopened = mock.instances[mock.instances.length - 1];
      reopened.readyState = OPEN;
      reopened.onopen?.({} as Event);
      emit(reopened, [{ type: "run_status", active: false }]);
      await settle(2);

      const record = sessionOf("s9");
      expect(record.streaming).toBe(false);
      expect(record.messages.map((message) => message.content)).toEqual(["hi", "done"]);
    });

    it("resync range-replaces the newest window while retaining the older loaded prefix", async () => {
      const client = createMockClient({
        page: { entries: [
          { id: 1, message: userMessage("old") },
          { id: 2, message: assistantText("old reply") },
        ] },
      });
      await attachAndConnect("sr", client);

      (client.getSessionMessagesPage as ReturnType<typeof vi.fn>).mockResolvedValue({
        entries: [
          { id: 3, message: userMessage("new") },
          { id: 4, message: assistantText("fresh reply") },
        ],
        hasMore: true,
        oldestId: 9,
      });

      useStreamingStore.getState().resync(client, "a1", "sr");
      await settle(2);

      const record = sessionOf("sr");
      expect(record.messages.map((message) => message.content)).toEqual([
        "old",
        "old reply",
        "new",
        "fresh reply",
      ]);
      expect(record.hasMore).toBe(true);
    });

    it("resync is a no-op when the session is not cached", async () => {
      const client = createMockClient();
      const spy = client.getSessionMessagesPage as ReturnType<typeof vi.fn>;
      useStreamingStore.getState().resync(client, "a1", "unknown");
      await settle(2);
      expect(spy).not.toHaveBeenCalled();
    });

    it("resync does not clobber a session that is actively streaming", async () => {
      const client = createMockClient();
      const socket = await attachAndConnect("ss", client);
      useStreamingStore.getState().sendMessage("ss", "hi");
      emit(socket, [{ type: "run_status", active: true }]);
      await settle(2);

      expect(sessionOf("ss").streaming).toBe(true);
      const spy = client.getSessionMessagesPage as ReturnType<typeof vi.fn>;
      spy.mockClear();

      useStreamingStore.getState().resync(client, "a1", "ss");
      await settle(2);

      expect(spy).not.toHaveBeenCalled();
    });

    it("loadMore prepends the older page through the loadMoreApplied frame", async () => {
      const client = createMockClient({
        page: { entries: [
          { id: 5, message: userMessage("recent") },
        ], hasMore: true, oldestId: 5 },
      });
      await attachAndConnect("lm", client);
      expect(sessionOf("lm").messages.map((m) => m.content)).toEqual(["recent"]);

      (client.getSessionMessagesPage as ReturnType<typeof vi.fn>).mockResolvedValue({
        entries: [{ id: 3, message: userMessage("older") }],
        hasMore: false,
        oldestId: 3,
      });
      useStreamingStore.getState().loadMore(client, "lm", "a1");
      await settle(2);

      const record = sessionOf("lm");
      expect(record.messages.map((m) => m.content)).toEqual(["older", "recent"]);
      expect(record.hasMore).toBe(false);
      expect(record.loadingMore).toBe(false);
      expect(record.replica.durable.highSeq).toBe(5);
    });
  });

  describe("retry", () => {
    const transientFailureEvents = [
      { type: "run_status", active: true },
      { type: "message_start", message: { role: "assistant", content: [], timestamp: 1 } },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "" }], stopReason: "error", errorMessage: "rate limit exceeded", timestamp: 2 }, seq: 1 },
      { type: "message_settled", seq: 1, message: { role: "assistant", content: [], stopReason: "error", errorMessage: "rate limit exceeded", timestamp: 2 } },
      { type: "agent_end", messages: [] },
      { type: "run_status", active: false },
    ];

    it("leaves a transient failure rendered without auto retry", async () => {
      const socket = await attachAndConnect("rt1");
      useStreamingStore.getState().sendMessage("rt1", "hi");
      const intentId = sentPayloads(socket).find((p) => p.type === "message")?.intentId;
      emit(socket, [
        { type: "message_settled", seq: 0, message: userMessage("hi"), intentId },
        ...transientFailureEvents,
      ]);
      await settle(2);
      await vi.advanceTimersByTimeAsync(6000);

      const record = sessionOf("rt1");
      const last = record.messages.at(-1);
      expect(last?._error).toBe("rate limit exceeded");
      expect(last?._turnError).toBe(true);
      expect(record.streaming).toBe(false);
      expect(sentPayloads(socket).some((p) => p.type === "retry")).toBe(false);
    });

    it("sends a retry frame and marks the failed turn retrying (retry-last)", async () => {
      const socket = await attachAndConnect("rt2");
      useStreamingStore.getState().sendMessage("rt2", "hi");
      const intentId = sentPayloads(socket).find((p) => p.type === "message")?.intentId;
      emit(socket, [
        { type: "message_settled", seq: 0, message: userMessage("hi"), intentId },
        ...transientFailureEvents,
      ]);
      await settle(2);

      useStreamingStore.getState().retry("rt2");
      await settle(2);

      expect(sentPayloads(socket)).toContainEqual({ type: "retry" });
      const record = sessionOf("rt2");
      expect(record.streaming).toBe(true);
      const last = record.messages.at(-1);
      expect(last?._error).toBeUndefined();
      expect(last?._streaming).toBe(true);
    });

    it("pure-resends (rebuild intent) for a send failure without triggering withdraw", async () => {
      const socket = await attachAndConnect("rt3");
      socket.readyState = CLOSED;
      useStreamingStore.getState().sendMessage("rt3", "hi");
      await settle(2);
      expect(sessionOf("rt3").messages.at(-1)?._sendFailed).toBe(true);

      socket.readyState = OPEN;
      useStreamingStore.getState().retry("rt3");
      await settle(2);

      expect(sentPayloads(socket).some((p) => p.type === "withdraw")).toBe(false);
      const payloads = sentPayloads(socket).filter((p) => p.type === "message");
      expect(payloads).toHaveLength(1);
      expect(sessionOf("rt3").messages.at(-1)).toMatchObject({ content: "hi", _optimistic: true });
      expect(sessionOf("rt3").messages.some((m) => m._sendFailed)).toBe(false);
    });

    it("composite-resends (withdraw then send) when the failed pair is committed", async () => {
      const socket = await attachAndConnect("rt4");
      useStreamingStore.getState().sendMessage("rt4", "hi");
      const intentId = sentPayloads(socket).find((p) => p.type === "message")?.intentId;
      emit(socket, [
        { type: "message_settled", seq: 0, message: userMessage("hi"), intentId },
        { type: "run_status", active: true },
        { type: "error", message: "model backend unavailable", code: "TRANSIENT" },
        { type: "run_status", active: false },
      ]);
      await settle(2);

      useStreamingStore.getState().retry("rt4");
      await settle(2);

      expect(sentPayloads(socket)).toContainEqual({ type: "withdraw" });
      expect(sentPayloads(socket).filter((p) => p.type === "message")).toHaveLength(1);

      emit(socket, [{ type: "turn_withdrawn", seq: 0, upTo: 1 }]);
      await settle(2);

      const payloads = sentPayloads(socket).filter((p) => p.type === "message");
      expect(payloads).toHaveLength(2);
      expect(sessionOf("rt4").messages.map((m) => m.content)).toEqual(["hi"]);
    });

    it("falls back to a pure send when the composite withdraw is rejected", async () => {
      const socket = await attachAndConnect("rt5");
      useStreamingStore.getState().sendMessage("rt5", "hi");
      const intentId = sentPayloads(socket).find((p) => p.type === "message")?.intentId;
      emit(socket, [
        { type: "message_settled", seq: 0, message: userMessage("hi"), intentId },
        { type: "run_status", active: true },
        { type: "error", message: "model backend unavailable", code: "TRANSIENT" },
        { type: "run_status", active: false },
      ]);
      await settle(2);

      useStreamingStore.getState().retry("rt5");
      await settle(2);
      emit(socket, [{ type: "error", message: "cannot withdraw", code: "PERMANENT" }]);
      await settle(2);

      const payloads = sentPayloads(socket).filter((p) => p.type === "message");
      expect(payloads).toHaveLength(2);
      const record = sessionOf("rt5");
      expect(record.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["hi", "hi"]);
      expect(record.messages.some((m) => m._error)).toBe(true);
    });
  });

  describe("multi-client visibility (design e2e hook)", () => {
    it("a settled frame from another client's run folds into an attached subscriber", async () => {
      const socket = await attachAndConnect("mc1");
      emit(socket, [
        { type: "message_settled", seq: 0, message: userMessage("from mobile") },
      ]);
      await settle(2);
      expect(sessionOf("mc1").messages.map((m) => m.content)).toEqual(["from mobile"]);
    });
  });

  describe("project lifecycle", () => {
    it("disconnectProject drops all sessions of the project and keeps other projects", async () => {
      const client = createMockClient();
      useStreamingStore.getState().attach(client, "target-1", BASE_URL, "closing", "a1");
      const targetSocket = mock.instances[mock.instances.length - 1];
      targetSocket.readyState = OPEN;
      targetSocket.onopen?.({} as Event);
      useStreamingStore.getState().attach(client, "other-1", BASE_URL, "staying", "a1");
      const otherSocket = mock.instances[mock.instances.length - 1];
      otherSocket.readyState = OPEN;
      otherSocket.onopen?.({} as Event);
      await settle(2);

      useStreamingStore.getState().disconnectProject("closing");
      await vi.advanceTimersByTimeAsync(60_000);

      expect(sessionOf("target-1")).toBeUndefined();
      expect(sessionOf("other-1")).toBeDefined();
      expect(targetSocket.closeSpy).toHaveBeenCalled();
      expect(otherSocket.closeSpy).not.toHaveBeenCalled();
      expect(mock.instances.filter((s) => s.readyState !== CLOSED)).toHaveLength(1);
    });

    it("disconnectProject disconnects a streaming session that cleanupExpired would keep", async () => {
      const client = createMockClient();
      useStreamingStore.getState().attach(client, "leak", BASE_URL, "closing", "a1");
      const socket = mock.instances[mock.instances.length - 1];
      socket.readyState = OPEN;
      socket.onopen?.({} as Event);

      useStreamingStore.getState().sendMessage("leak", "hi");
      emit(socket, [{ type: "run_status", active: true }]);
      await settle(2);
      expect(sessionOf("leak").streaming).toBe(true);

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(sessionOf("leak")).toBeDefined();

      const instancesBeforeDisconnect = mock.instances.length;
      useStreamingStore.getState().disconnectProject("closing");
      expect(sessionOf("leak")).toBeUndefined();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(mock.instances).toHaveLength(instancesBeforeDisconnect);
    });
  });

  describe("control responses", () => {
    it("respondQuestion routes the answer to the session runtime", async () => {
      const socket = await attachAndConnect("qs1");
      const delivered = useStreamingStore.getState().respondQuestion("qs1", "req-1", "yes");
      expect(delivered).toBe(true);
      expect(sentPayloads(socket)).toContainEqual({
        type: "resolve_control_request",
        requestId: "req-1",
        kind: "question",
        answer: "yes",
      });
    });

    it("respondQuestion returns false when no runtime is attached", () => {
      expect(useStreamingStore.getState().respondQuestion("missing", "req-1", "yes")).toBe(false);
    });
  });

  describe("streaming side-band propagation", () => {
    it("notifies the project data store when streaming toggles", async () => {
      const setStreaming = vi.spyOn(useProjectDataStore.getState(), "setStreaming");
      const socket = await attachAndConnect("side");
      setStreaming.mockClear();

      useStreamingStore.getState().sendMessage("side", "hi");
      const intentId = sentPayloads(socket).find((p) => p.type === "message")?.intentId;
      await settle(2);
      expect(setStreaming).toHaveBeenCalledWith("p1", "side", true);

      emit(socket, [
        { type: "message_settled", seq: 0, message: userMessage("hi"), intentId },
        { type: "run_status", active: true },
        { type: "message_end", message: assistantText("done"), seq: 1 },
        { type: "message_settled", seq: 1, message: assistantText("done") },
        { type: "run_status", active: false },
      ]);
      await settle(2);
      expect(setStreaming).toHaveBeenCalledWith("p1", "side", false);
    });
  });

  describe("resumeProbeAll", () => {
    it("probes attached sessions and closes the socket when no pong arrives", async () => {
      const socket = await attachAndConnect("s1");
      socket.sent.length = 0;
      useStreamingStore.getState().resumeProbeAll();
      expect(sentPayloads(socket)).toContainEqual({ type: "ping" });
      await vi.advanceTimersByTimeAsync(5000);
      expect(socket.closeSpy).toHaveBeenCalled();
    });

    it("keeps the socket open when a pong arrives within the probe timeout", async () => {
      const socket = await attachAndConnect("s1");
      socket.sent.length = 0;
      useStreamingStore.getState().resumeProbeAll();
      socket.onmessage?.({ data: JSON.stringify({ type: "pong" }) } as MessageEvent);
      await vi.advanceTimersByTimeAsync(6000);
      expect(socket.closeSpy).not.toHaveBeenCalled();
    });

    it("skips detached sessions", async () => {
      const socket = await attachAndConnect("s1");
      useStreamingStore.getState().detach("s1");
      socket.sent.length = 0;
      useStreamingStore.getState().resumeProbeAll();
      expect(socket.sent).toHaveLength(0);
    });

    it("is a no-op when no session ever attached", () => {
      expect(() => useStreamingStore.getState().resumeProbeAll()).not.toThrow();
    });
  });

  describe("pending approvals scan (ApprovalNoticeBridge compat)", () => {
    it("collectPendingApprovals sees pending approval cards in cached sessions including active runs", async () => {
      const socket = await attachAndConnect("ap1");
      emit(socket, [
        { type: "run_status", active: true },
        { type: "tool_execution_start", toolCallId: "t1", toolName: "run_command", args: { command: "npm test" } },
        { type: "control_request", requestId: "req-9", kind: "approval", toolCallId: "t1", toolName: "run_command", args: { command: "npm test" } },
      ]);
      await settle(2);

      const sessions = useStreamingStore.getState().sessions;
      const pending = collectPendingApprovals(sessions);
      expect(pending).toContainEqual(
        expect.objectContaining({ kind: "approval", requestId: "req-9", sessionId: "ap1", projectId: "p1", command: "npm test" }),
      );
    });
  });
});
