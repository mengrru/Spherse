import { describe, expect, it, vi } from "vitest";
import type { SessionMessagesPageResponse } from "@spherse/contracts";
import type { ApiClient } from "../../../lib/api";
import { createHistoryLoader, type HistoryLoaderHost } from "./history-loader";
import { createSessionState, type ChatSessionState } from "./session-state";
import type { UserEntry } from "../model/entry";

function sessionState(overrides: Partial<ChatSessionState> = {}): ChatSessionState {
  const base = createSessionState("s1", "p1", "a1", 1);
  return {
    ...base,
    history: { status: "ready", hasMore: false, oldestSeq: null, loadingMore: false, error: false },
    ...overrides,
  };
}

function harness() {
  const sessions: Record<string, ChatSessionState> = {};
  const host: HistoryLoaderHost = {
    getSession: (sessionId) => sessions[sessionId],
    updateSession: (sessionId, updater) => {
      const current = sessions[sessionId];
      if (!current) return;
      sessions[sessionId] = updater(current);
    },
  };
  return { host, sessions };
}

function page(entries: SessionMessagesPageResponse["entries"]): SessionMessagesPageResponse {
  return { entries, hasMore: false, oldestId: entries[0]?.id ?? null };
}

function clientWith(result: SessionMessagesPageResponse): ApiClient {
  return { getSessionMessagesPage: vi.fn().mockResolvedValue(result) } as unknown as ApiClient;
}

describe("history loader", () => {
  it("skips loadMore when there is no older page", () => {
    const { host, sessions } = harness();
    sessions.s1 = sessionState();
    const client = clientWith(page([]));
    createHistoryLoader(host).loadMore(client, "s1", "a1");
    expect(client.getSessionMessagesPage).not.toHaveBeenCalled();
  });

  it("prepends older entries and clears the loading flag", async () => {
    const { host, sessions } = harness();
    sessions.s1 = sessionState({
      entries: [{ kind: "user", id: "e5", seq: 5, text: "newer" }],
      history: { status: "ready", hasMore: true, oldestSeq: 5, loadingMore: false, error: false },
    });
    const client = clientWith(page([
      { id: 1, message: { role: "user", content: "older" } },
      { id: 2, message: { role: "assistant", content: "answer" } },
    ]));

    createHistoryLoader(host).loadMore(client, "s1", "a1");
    expect(sessions.s1.history.loadingMore).toBe(true);
    await vi.waitFor(() => expect(sessions.s1.history.loadingMore).toBe(false));

    expect(sessions.s1.entries.map((entry) => entry.seq)).toEqual([1, 2, 5]);
    expect(sessions.s1.history).toMatchObject({ hasMore: false, oldestSeq: 1 });
  });

  it("skips refresh while streaming and retries history errors", async () => {
    const { host, sessions } = harness();
    sessions.s1 = sessionState({
      streaming: true,
      history: { status: "ready", hasMore: false, oldestSeq: null, loadingMore: false, error: true },
    });
    const client = clientWith(page([{ id: 1, message: { role: "user", content: "hi" } }]));
    const loader = createHistoryLoader(host);

    loader.refreshHistory(client, "s1", "a1");
    expect(client.getSessionMessagesPage).not.toHaveBeenCalled();

    sessions.s1 = { ...sessions.s1, streaming: false };
    loader.retryHistory(client, "s1", "a1");
    expect(sessions.s1.history.error).toBe(false);
    await vi.waitFor(() => expect(sessions.s1.history.status).toBe("ready"));
    expect(sessions.s1.entries.map((entry) => entry.seq)).toEqual([1]);
  });

  it("ignores responses for a replaced session generation", async () => {
    const { host, sessions } = harness();
    const fresh = sessionState();
    sessions.s1 = sessionState({ history: { status: "ready", hasMore: true, oldestSeq: 5, loadingMore: false, error: false } });

    let resolvePage: (value: SessionMessagesPageResponse) => void = () => {};
    const client = {
      getSessionMessagesPage: vi.fn().mockReturnValue(new Promise<SessionMessagesPageResponse>((resolve) => {
        resolvePage = resolve;
      })),
    } as unknown as ApiClient;

    createHistoryLoader(host).loadMore(client, "s1", "a1");
    sessions.s1 = { ...fresh, generation: fresh.generation + 1000 };
    const replacement = sessions.s1;
    const user: UserEntry = { kind: "user", id: "e1", seq: 1, text: "stale" };
    resolvePage(page([{ id: 1, message: { role: "user", content: user.text } }]));
    await Promise.resolve();
    await Promise.resolve();

    expect(sessions.s1).toBe(replacement);
    expect(sessions.s1.entries).toHaveLength(0);
  });
});
