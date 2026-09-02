import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import type { ChatMessage } from "../types";
import {
  loadMoreHistory,
  refreshSessionHistory,
  type HistoryPaginationState,
  type HistorySessionPort,
} from "./history-actions";

type TestSession = HistoryPaginationState;

function session(overrides: Partial<TestSession> = {}): TestSession {
  return {
    messages: [],
    streaming: false,
    hasMore: false,
    oldestLoadedId: null,
    loadingMore: false,
    historyStatus: "pending",
    historyError: false,
    ...overrides,
  };
}

function portOf(initial: TestSession | undefined) {
  let state = initial;
  const port: HistorySessionPort<TestSession> = {
    getSession: () => state,
    updateSession: (updater) => {
      if (state === undefined) return;
      state = updater(state);
    },
  };
  return {
    port,
    get state() {
      return state;
    },
  };
}

function clientOf(result: () => Promise<unknown>): ApiClient {
  return {
    getSessionMessagesPage: vi.fn(result),
  } as unknown as ApiClient;
}

describe("loadMoreHistory", () => {
  it("does not fetch without a session, while loading, without hasMore, or without oldestLoadedId", async () => {
    const client = clientOf(() => Promise.resolve({}));

    loadMoreHistory(portOf(undefined).port, client, "a1", "s1");
    loadMoreHistory(portOf(session({ loadingMore: true, hasMore: true, oldestLoadedId: 5 })).port, client, "a1", "s1");
    loadMoreHistory(portOf(session({ hasMore: false, oldestLoadedId: 5 })).port, client, "a1", "s1");
    loadMoreHistory(portOf(session({ hasMore: true, oldestLoadedId: null })).port, client, "a1", "s1");

    expect(client.getSessionMessagesPage).not.toHaveBeenCalled();
  });

  it("fetches the page before the oldest loaded id and merges results", async () => {
    const harness = portOf(session({
      messages: [{ role: "assistant", content: "latest", _messageId: 10 } as ChatMessage],
      hasMore: true,
      oldestLoadedId: 10,
    }));
    const client = clientOf(() => Promise.resolve({
      entries: [
        { id: 5, message: { role: "user", content: "older" } },
      ],
      hasMore: false,
      oldestId: 5,
    }));

    loadMoreHistory(harness.port, client, "a1", "s1");
    expect(harness.state?.loadingMore).toBe(true);
    await vi.waitFor(() => {
      expect(harness.state?.loadingMore).toBe(false);
    });

    expect(client.getSessionMessagesPage).toHaveBeenCalledWith("a1", "s1", { limit: 20, before: 10 });
    expect(harness.state?.messages.map((m) => m.content)).toEqual(["older", "latest"]);
    expect(harness.state?.hasMore).toBe(false);
    expect(harness.state?.oldestLoadedId).toBe(5);
  });

  it("clears loadingMore when the fetch fails", async () => {
    const harness = portOf(session({ hasMore: true, oldestLoadedId: 10 }));
    const client = clientOf(() => Promise.reject(new Error("boom")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    loadMoreHistory(harness.port, client, "a1", "s1");
    await vi.waitFor(() => {
      expect(harness.state?.loadingMore).toBe(false);
    });

    warn.mockRestore();
  });
});

describe("refreshSessionHistory", () => {
  it("does not fetch without a session or while streaming", () => {
    const client = clientOf(() => Promise.resolve({}));

    refreshSessionHistory(portOf(undefined).port, client, "a1", "s1");
    refreshSessionHistory(portOf(session({ streaming: true })).port, client, "a1", "s1");

    expect(client.getSessionMessagesPage).not.toHaveBeenCalled();
  });

  it("merges the latest page and marks history ready", async () => {
    const harness = portOf(session({
      messages: [{ role: "assistant", content: "cached old", _messageId: 1 } as ChatMessage],
      historyError: true,
    }));
    const client = clientOf(() => Promise.resolve({
      entries: [
        { id: 3, message: { role: "user", content: "new" } },
        { id: 4, message: { role: "assistant", content: [{ type: "text", text: "fresh reply" }] } },
      ],
      hasMore: true,
      oldestId: 9,
    }));

    refreshSessionHistory(harness.port, client, "a1", "s1");
    await vi.waitFor(() => {
      expect(harness.state?.historyStatus).toBe("ready");
    });

    expect(harness.state?.messages.map((m) => m.content)).toEqual([
      "cached old",
      "new",
      "fresh reply",
    ]);
    expect(harness.state?.hasMore).toBe(true);
    expect(harness.state?.oldestLoadedId).toBe(9);
    expect(harness.state?.historyError).toBe(false);
  });

  it("does not clobber a session that started streaming during the fetch", async () => {
    const harness = portOf(session());
    let flipStreaming: (() => void) | undefined;
    const client = clientOf(() => new Promise((resolve) => {
      flipStreaming = () => resolve({
        entries: [{ id: 1, message: { role: "user", content: "new" } }],
        hasMore: false,
        oldestId: 1,
      });
    }));

    refreshSessionHistory(harness.port, client, "a1", "s1");
    harness.port.updateSession((s) => ({ ...s, streaming: true }));
    const flipped = harness.state;
    flipStreaming?.();
    await vi.waitFor(() => {
      expect(harness.state?.historyStatus).toBe("pending");
    });

    expect(harness.state).toBe(flipped);
    expect(harness.state?.messages).toEqual([]);
  });

  it("backfills older pages until the loaded window covers the previous low watermark", async () => {
    const serverEntries = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      message:
        i % 2 === 0
          ? { role: "user", content: `q${i + 1}` }
          : { role: "assistant", content: [{ type: "text", text: `a${i + 1}` }] },
    }));
    const client: ApiClient = {
      getSessionMessagesPage: vi.fn((_agentId: string, _sessionId: string, params: { limit?: number; before?: number }) => {
        const eligible = serverEntries.filter((entry) => params?.before === undefined || entry.id < params.before);
        const selected = eligible.slice(-(params?.limit ?? 20));
        return Promise.resolve({
          entries: selected,
          hasMore: selected.length < eligible.length,
          oldestId: selected[0]?.id ?? null,
        });
      }),
    } as unknown as ApiClient;
    const harness = portOf(session({
      messages: [
        { role: "user", content: "q1", _messageId: 1 } as ChatMessage,
        { role: "assistant", content: "a2", _messageId: 2 } as ChatMessage,
      ],
      hasMore: true,
      oldestLoadedId: 1,
      historyStatus: "ready",
    }));

    refreshSessionHistory(harness.port, client, "a1", "s1");
    await vi.waitFor(() => {
      expect(harness.state?.oldestLoadedId).toBe(1);
      expect(harness.state?.hasMore).toBe(false);
    });

    expect(harness.state?.messages.map((m) => m.content)).toEqual(
      serverEntries.map((entry, i) => (i % 2 === 0 ? `q${i + 1}` : `a${i + 1}`)),
    );
    expect(client.getSessionMessagesPage).toHaveBeenCalledTimes(2);
  });
});
