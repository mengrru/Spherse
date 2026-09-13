import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMessagesPageResponse } from "@spherse/contracts";
import type { ApiClient } from "../../../lib/api";
import {
  createMockWebSocket,
  openInstance,
} from "../../../test/mock-web-socket";
import { useChatSessionStore } from "./session-store";
import type { AssistantEntry, ToolResultEntry, UserEntry } from "../model/entry";

const BASE_URL = "http://localhost:5173";

function createMockClient(): ApiClient {
  return {
    getSessionMessagesPage: vi.fn().mockResolvedValue({
      entries: [],
      hasMore: false,
      oldestId: null,
    }),
  } as unknown as ApiClient;
}

function historyPage(
  entries: SessionMessagesPageResponse["entries"],
  hasMore = false,
): SessionMessagesPageResponse {
  return { entries, hasMore, oldestId: entries[0]?.id ?? null };
}

function assistantMessage(text: string, extra: Record<string, unknown> = {}) {
  return { role: "assistant", content: [{ type: "text", text }], ...extra };
}

let mock: ReturnType<typeof createMockWebSocket>;

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("chat session store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock = createMockWebSocket();
    vi.stubGlobal("WebSocket", mock.MockWebSocket);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 0) as unknown as number,
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    for (const sessionId of Object.keys(useChatSessionStore.getState().sessions)) {
      useChatSessionStore.getState().disconnect(sessionId);
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function session(sessionId = "s1") {
    return useChatSessionStore.getState().sessions[sessionId];
  }

  async function attachAndOpen(sessionId = "s1", client = createMockClient()) {
    useChatSessionStore.getState().attach(client, sessionId, BASE_URL, "p1", "a1");
    await flush();
    const socket = mock.instances[mock.instances.length - 1];
    openInstance(socket);
    await flush();
    return socket;
  }

  it("opens a websocket to the chat endpoint and reuses it on re-attach", async () => {
    const socket = await attachAndOpen();
    expect(socket.url).toBe("ws://localhost:5173/ws/projects/p1/chat/a1/s1");
    useChatSessionStore.getState().attach(createMockClient(), "s1", BASE_URL, "p1", "a1");
    await flush();
    expect(mock.instances).toHaveLength(1);
    expect(session().attachedCount).toBe(2);
  });

  it("sends an optimistic user entry with a clientId", async () => {
    const socket = await attachAndOpen();
    expect(useChatSessionStore.getState().sendMessage("s1", "hi")).toBe(true);
    await flush();

    const current = session();
    const entry = current.entries[0] as UserEntry;
    expect(entry).toMatchObject({ kind: "user", text: "hi", optimistic: true });
    expect(entry.clientId).toBeTruthy();
    expect(current.streaming).toBe(true);
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      type: "message",
      content: "hi",
      clientId: entry.clientId,
    });
  });

  it("marks the message as failed when the socket is not open", async () => {
    useChatSessionStore.getState().attach(createMockClient(), "s1", BASE_URL, "p1", "a1");
    await flush();

    expect(useChatSessionStore.getState().sendMessage("s1", "hi")).toBe(true);
    const entry = session().entries[0] as UserEntry;
    expect(entry.sendFailed).toBe(true);
    expect(session().streaming).toBe(false);
    expect(mock.instances[0].sent).toHaveLength(0);
  });

  it("streams assistant events and closes the run on run_status", async () => {
    const socket = await attachAndOpen();
    socket.onmessage?.({ data: JSON.stringify({ type: "run_status", active: true }) } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ type: "message_start", message: assistantMessage("") }) } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({ type: "message_update", message: assistantMessage("hello") }),
    } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({ type: "message_end", message: assistantMessage("hello", { timestamp: 5 }) }),
    } as MessageEvent);
    await flush();

    let current = session();
    const assistant = current.entries.at(-1) as AssistantEntry;
    expect(assistant).toMatchObject({ kind: "assistant", text: "hello", time: 5 });
    expect(current.streaming).toBe(true);

    socket.onmessage?.({ data: JSON.stringify({ type: "run_status", active: false }) } as MessageEvent);
    await flush();
    current = session();
    expect(current.streaming).toBe(false);
    expect(current.openStreamId).toBeNull();
  });

  it("recovers a response that completed while the socket was disconnected", async () => {
    const client = createMockClient();
    const socket = await attachAndOpen("s1", client);

    useChatSessionStore.getState().sendMessage("s1", "hi");
    await flush();
    socket.onmessage?.({
      data: JSON.stringify({ type: "message_update", message: assistantMessage("partial") }),
    } as MessageEvent);
    await flush();
    expect(session().streaming).toBe(true);

    (client.getSessionMessagesPage as ReturnType<typeof vi.fn>).mockResolvedValue(historyPage([
      { id: 1, message: { role: "user", content: "hi", timestamp: 10 } },
      { id: 2, message: assistantMessage("done", { timestamp: 20 }) },
    ]));
    socket.close();
    await vi.advanceTimersByTimeAsync(1000);

    const reopened = mock.instances[mock.instances.length - 1];
    openInstance(reopened);
    reopened.onmessage?.({ data: JSON.stringify({ type: "run_status", active: false }) } as MessageEvent);
    await flush();

    const recovered = session();
    expect(recovered.entries.map((entry) => (entry.kind === "assistant" ? entry.text : entry.kind === "user" ? entry.text : entry.kind))).toEqual(["hi", "done"]);
    expect(recovered.entries.filter((entry) => entry.kind === "assistant" && entry.streaming)).toHaveLength(0);
    expect(recovered.streaming).toBe(false);
    expect(recovered.cursor).toBe(2);
  });

  it("does not reconnect after detach", async () => {
    const socket = await attachAndOpen();
    useChatSessionStore.getState().detach("s1");
    socket.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.instances).toHaveLength(1);
    expect(session().connection.state).toBe("closed");
  });

  it("stops reconnecting on a fatal close code", async () => {
    const socket = await attachAndOpen();
    socket.onclose?.({ code: 4401 } as CloseEvent);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.instances).toHaveLength(1);
    expect(session().connection.state).toBe("fatal");
  });

  it("clears the streaming run state on a fatal close code", async () => {
    const socket = await attachAndOpen();
    socket.onmessage?.({ data: JSON.stringify({ type: "run_status", active: true }) } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ type: "message_start", message: assistantMessage("") }) } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({ type: "message_update", message: assistantMessage("partial") }),
    } as MessageEvent);
    await flush();
    expect(session().streaming).toBe(true);

    socket.onclose?.({ code: 4401 } as CloseEvent);
    await flush();
    expect(session().streaming).toBe(false);
    expect(session().openStreamId).toBeNull();
    expect((session().entries[0] as AssistantEntry).streaming).toBe(false);
  });

  it("keeps the cursor when messages are cleared by ttl cleanup", async () => {
    await attachAndOpen();
    useChatSessionStore.getState().detach("s1");
    useChatSessionStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        s1: { ...state.sessions.s1, lastActivityAt: Date.now() - 10 * 60 * 1000 },
      },
    }));
    useChatSessionStore.getState().cleanupExpired(5 * 60 * 1000);
    expect(session()).toBeUndefined();
  });

  it("prepends older pages on loadMore", async () => {
    const client = createMockClient();
    const first = historyPage([
      { id: 5, message: { role: "user", content: "newer" } },
      { id: 6, message: assistantMessage("newer answer") },
    ], true);
    (client.getSessionMessagesPage as ReturnType<typeof vi.fn>).mockResolvedValue(first);
    await attachAndOpen("s1", client);
    expect(session().history).toMatchObject({ hasMore: true, oldestSeq: 5 });

    (client.getSessionMessagesPage as ReturnType<typeof vi.fn>).mockResolvedValueOnce(historyPage([
      { id: 1, message: { role: "user", content: "older" } },
      { id: 2, message: assistantMessage("older answer") },
    ]));
    useChatSessionStore.getState().loadMore(client, "s1", "a1");
    await flush();

    expect(session().entries.map((entry) => entry.seq)).toEqual([1, 2, 5, 6]);
    expect(session().history).toMatchObject({ hasMore: false, oldestSeq: 1, loadingMore: false });
  });

  it("sends withdraw and truncates on turn_withdrawn", async () => {
    const socket = await attachAndOpen();
    useChatSessionStore.getState().sendMessage("s1", "q2");
    socket.onmessage?.({ data: JSON.stringify({ type: "agent_end", messages: [] }) } as MessageEvent);
    await flush();
    expect(session().streaming).toBe(false);

    useChatSessionStore.getState().withdrawLastTurn("s1");
    expect(session().pendingWithdraw).toBe(true);
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: "withdraw" });

    socket.onmessage?.({ data: JSON.stringify({ type: "turn_withdrawn", seq: 1 }) } as MessageEvent);
    await flush();
    expect(session().entries).toHaveLength(0);
    expect(session().pendingWithdraw).toBe(false);
  });

  it("retries a turn error with the retry payload and clears the error", async () => {
    const socket = await attachAndOpen();
    useChatSessionStore.getState().sendMessage("s1", "hi");
    await flush();
    socket.onmessage?.({ data: JSON.stringify({ type: "message_start", message: assistantMessage("") }) } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({ type: "message_end", message: assistantMessage("", { stopReason: "error", errorMessage: "boom" }) }),
    } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ type: "run_status", active: false }) } as MessageEvent);
    await flush();

    useChatSessionStore.getState().retry("s1");
    await flush();
    const assistant = session().entries.at(-1) as AssistantEntry;
    expect(assistant.streaming).toBe(true);
    expect(assistant.error).toBeUndefined();
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: "retry" });
  });

  it("responds false to control requests when the socket is not open", async () => {
    useChatSessionStore.getState().attach(createMockClient(), "s1", BASE_URL, "p1", "a1");
    await flush();
    expect(useChatSessionStore.getState().respondApproval("s1", "r1", true)).toBe(false);
    expect(useChatSessionStore.getState().respondQuestion("s1", "r1", "yes")).toBe(false);
  });

  it("delivers tool results into the owning assistant entry", async () => {
    const socket = await attachAndOpen();
    socket.onmessage?.({ data: JSON.stringify({ type: "message_start", message: assistantMessage("") }) } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({ type: "message_end", message: assistantMessage("", { stopReason: "toolUse" }) }),
    } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({ type: "tool_execution_start", toolCallId: "tc1", toolName: "run_command", args: { command: "ls" } }),
    } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({ type: "tool_execution_end", toolCallId: "tc1", toolName: "run_command", result: { details: { cardType: "command", command: "ls", stdout: "ok", status: "completed" } }, isError: false }),
    } as MessageEvent);
    await flush();

    const assistant = session().entries[0] as AssistantEntry;
    const result = session().entries.find((entry) => entry.kind === "tool-result") as ToolResultEntry;
    expect(assistant.toolCalls).toHaveLength(1);
    expect(result.ownerId).toBe(assistant.id);
  });
});
