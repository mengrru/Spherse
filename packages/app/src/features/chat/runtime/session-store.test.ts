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

  it("settles the optimistic entry from the live echo and drops abandoned seqs on retry", async () => {
    const socket = await attachAndOpen();
    useChatSessionStore.getState().sendMessage("s1", "hi");
    await flush();
    const clientId = (session().entries[0] as UserEntry).clientId;

    socket.onmessage?.({
      data: JSON.stringify({ type: "user_message", seq: 1, message: { role: "user", content: "hi" }, clientId }),
    } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ type: "message_start", message: assistantMessage(""), messageId: "m1" }) } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({ type: "message_end", message: assistantMessage("", { stopReason: "error", errorMessage: "boom" }), messageId: "m1", seq: 2 }),
    } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ type: "run_status", active: false }) } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ type: "turn_retried", seq: 3, abandonedSeqs: [2] }) } as MessageEvent);
    await flush();

    expect(session().entries.map((entry) => entry.kind)).toEqual(["user"]);
    expect((session().entries[0] as UserEntry).seq).toBe(1);
    expect((session().entries[0] as UserEntry).optimistic).toBeUndefined();
    expect(session().cursor).toBe(3);
  });

  it("replays persisted events after a v2 reconnect and drops stale transient windows", async () => {
    const client = createMockClient();
    const socket = await attachAndOpen("s1", client);
    useChatSessionStore.getState().sendMessage("s1", "hi");
    await flush();
    const clientId = (session().entries[0] as UserEntry).clientId;
    socket.onmessage?.({
      data: JSON.stringify({ type: "user_message", seq: 1, message: { role: "user", content: "hi" }, clientId }),
    } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ type: "message_start", message: assistantMessage(""), messageId: "m1" }) } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({ type: "message_update", message: assistantMessage("partial"), messageId: "m1" }),
    } as MessageEvent);
    await flush();
    expect(session().cursor).toBe(1);

    socket.close();
    await vi.advanceTimersByTimeAsync(1000);
    const reopened = mock.instances[mock.instances.length - 1];
    expect(reopened.url).toContain("since=1");
    openInstance(reopened);
    reopened.onmessage?.({ data: JSON.stringify({ type: "session_ready", lastSeq: 3, replay: true }) } as MessageEvent);
    reopened.onmessage?.({
      data: JSON.stringify({
        type: "replay_events",
        events: [
          {
            type: "assistant/message",
            seq: 2,
            time: 20,
            data: { message: assistantMessage("done", { timestamp: 20 }) },
          },
          { type: "turn/end", seq: 3, time: 21, data: { reason: "completed" } },
        ],
      }),
    } as MessageEvent);
    reopened.onmessage?.({ data: JSON.stringify({ type: "replay_done" }) } as MessageEvent);
    reopened.onmessage?.({ data: JSON.stringify({ type: "run_status", active: false }) } as MessageEvent);
    await flush();

    const recovered = session();
    expect(recovered.entries.map((entry) => entry.kind)).toEqual(["user", "assistant"]);
    expect(recovered.entries[1]).toMatchObject({ id: "e2", seq: 2, text: "done", streaming: false });
    expect(recovered.entries.filter((entry) => entry.kind === "assistant" && entry.streaming)).toHaveLength(0);
    expect(recovered.cursor).toBe(3);
    expect(recovered.history.status).toBe("ready");
    expect(client.getSessionMessagesPage).toHaveBeenCalledTimes(1);
  });

  it("rebuilds a live window from the snapshot after replay and dedups on message_end", async () => {
    const client = createMockClient();
    const socket = await attachAndOpen("s1", client);
    socket.onmessage?.({
      data: JSON.stringify({ type: "user_message", seq: 1, message: { role: "user", content: "hi" } }),
    } as MessageEvent);
    await flush();

    socket.close();
    await vi.advanceTimersByTimeAsync(1000);
    const reopened = mock.instances[mock.instances.length - 1];
    openInstance(reopened);
    reopened.onmessage?.({ data: JSON.stringify({ type: "session_ready", lastSeq: 4, replay: true }) } as MessageEvent);
    reopened.onmessage?.({
      data: JSON.stringify({
        type: "replay_events",
        events: [
          { type: "turn/start", seq: 2, time: 20, data: {} },
        ],
      }),
    } as MessageEvent);
    reopened.onmessage?.({ data: JSON.stringify({ type: "replay_done" }) } as MessageEvent);
    reopened.onmessage?.({ data: JSON.stringify({ type: "message_start", message: assistantMessage(""), messageId: "m1" }) } as MessageEvent);
    reopened.onmessage?.({
      data: JSON.stringify({ type: "message_update", message: assistantMessage("partial"), messageId: "m1" }),
    } as MessageEvent);
    await flush();
    expect(session().entries.filter((entry) => entry.kind === "assistant")).toHaveLength(1);

    reopened.onmessage?.({
      data: JSON.stringify({ type: "message_end", message: assistantMessage("final"), messageId: "m1", seq: 4 }),
    } as MessageEvent);
    await flush();

    const assistants = session().entries.filter((entry) => entry.kind === "assistant") as AssistantEntry[];
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({ id: "m1", text: "final", seq: 4 });
    expect(session().cursor).toBe(4);
  });

  it("settles a missed echo from the reconnect page when no cursor was recorded", async () => {
    const client = createMockClient();
    await attachAndOpen("s1", client);
    useChatSessionStore.getState().sendMessage("s1", "hi");
    await flush();

    (client.getSessionMessagesPage as ReturnType<typeof vi.fn>).mockResolvedValue(historyPage([
      { id: 1, message: { role: "user", content: "hi", timestamp: 10 } },
    ]));
    const socket = mock.instances[mock.instances.length - 1];
    socket.close();
    await vi.advanceTimersByTimeAsync(1000);
    openInstance(mock.instances[mock.instances.length - 1]);
    await flush();

    expect(session().entries).toHaveLength(1);
    expect(session().entries[0]).toMatchObject({ kind: "user", seq: 1, text: "hi" });
    expect((session().entries[0] as UserEntry).optimistic).toBeUndefined();
    expect(session().cursor).toBe(1);
  });

  it("settles a missed echo from the replay by unique text", async () => {
    const client = createMockClient();
    const socket = await attachAndOpen("s1", client);
    socket.onmessage?.({
      data: JSON.stringify({ type: "user_message", seq: 1, message: { role: "user", content: "older" } }),
    } as MessageEvent);
    await flush();
    useChatSessionStore.getState().sendMessage("s1", "hi");
    await flush();
    expect(session().cursor).toBe(1);
    expect(session().entries[1]).toMatchObject({ optimistic: true });

    socket.close();
    await vi.advanceTimersByTimeAsync(1000);
    const reopened = mock.instances[mock.instances.length - 1];
    expect(reopened.url).toContain("since=1");
    openInstance(reopened);
    reopened.onmessage?.({ data: JSON.stringify({ type: "session_ready", lastSeq: 2, replay: true }) } as MessageEvent);
    reopened.onmessage?.({
      data: JSON.stringify({
        type: "replay_events",
        events: [
          {
            type: "user/message",
            seq: 2,
            time: 10,
            data: { message: { role: "user", content: "hi", timestamp: 10 } },
          },
        ],
      }),
    } as MessageEvent);
    reopened.onmessage?.({ data: JSON.stringify({ type: "replay_done" }) } as MessageEvent);
    await flush();

    const users = session().entries.filter((entry) => entry.kind === "user") as UserEntry[];
    expect(users).toHaveLength(2);
    expect(users[1]).toMatchObject({ seq: 2, text: "hi" });
    expect(users[1].optimistic).toBeUndefined();
  });

  it("keeps reconciling over HTTP while the first page never loaded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createMockClient();
    (client.getSessionMessagesPage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("nope"));
    const socket = await attachAndOpen("s1", client);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(5000);
    await flush();
    expect(session().history).toMatchObject({ status: "pending", error: true });

    socket.onmessage?.({
      data: JSON.stringify({ type: "user_message", seq: 1, message: { role: "user", content: "hi" } }),
    } as MessageEvent);
    await flush();
    expect(session().cursor).toBe(1);

    (client.getSessionMessagesPage as ReturnType<typeof vi.fn>).mockResolvedValue(historyPage([
      { id: 1, message: { role: "user", content: "hi", timestamp: 10 } },
    ]));
    socket.close();
    await vi.advanceTimersByTimeAsync(1000);
    const reopened = mock.instances[mock.instances.length - 1];
    expect(reopened.url).not.toContain("since=");
    openInstance(reopened);
    await flush();

    expect(session().history).toMatchObject({ status: "ready", error: false });
    expect(session().entries).toHaveLength(1);
    warn.mockRestore();
  });
});
