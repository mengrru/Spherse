import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import type { AgentEvent } from "../model/agent-event-parse";
import {
  HistoryReconciler,
  type HistoryReconcilerCallbacks,
} from "./history-reconciler";
import type { ChatSessionRuntimeState } from "./chat-session-runtime";

interface TestSession extends ChatSessionRuntimeState {
  pendingWithdraw: boolean;
}

function session(overrides: Partial<TestSession> = {}): TestSession {
  return {
    messages: [],
    streaming: false,
    lastActivityAt: 1,
    scrollPosition: 0,
    hasMore: false,
    oldestLoadedId: null,
    historyStatus: "pending",
    connectionStatus: "connecting",
    historyError: false,
    reconnectFailed: false,
    pendingWithdraw: false,
    ...overrides,
  };
}

function page(entries: object[] = []) {
  return { entries, hasMore: false, oldestId: null };
}

function createHarness(overrides: Partial<HistoryReconcilerCallbacks<TestSession>> = {}) {
  let current = true;
  let state: TestSession | undefined;
  const applied: AgentEvent[][] = [];
  const streamingNotified: boolean[] = [];
  const updateCount = vi.fn();

  const callbacks: HistoryReconcilerCallbacks<TestSession> = {
    isCurrent: () => current && state !== undefined,
    getSession: () => state,
    updateSession: (updater) => {
      updateCount();
      if (state === undefined) return;
      state = updater(state);
    },
    applyEvents: (events) => {
      applied.push(events);
      if (state === undefined) return;
      for (const event of events) {
        if (event.type === "run_status") state = { ...state!, streaming: event.active };
      }
    },
    setStreaming: (streaming) => streamingNotified.push(streaming),
    ...overrides,
  };

  return {
    callbacks,
    setCurrent(next: boolean) {
      current = next;
    },
    get state() {
      return state;
    },
    set state(next: TestSession | undefined) {
      state = next;
    },
    applied,
    streamingNotified,
    updateCount,
  };
}

function createClient(result: () => Promise<unknown>): ApiClient {
  return {
    getSessionMessagesPage: vi.fn(result),
  } as unknown as ApiClient;
}

describe("HistoryReconciler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("buffers events while reconciling and stops after success", async () => {
    const harness = createHarness();
    harness.state = session();
    const reconciler = new HistoryReconciler<TestSession>(harness.callbacks);
    let release: ((value: unknown) => void) | undefined;
    const client = createClient(() => new Promise((resolve) => {
      release = resolve;
    }));

    reconciler.onOpen();
    expect(reconciler.shouldBuffer()).toBe(true);
    reconciler.buffer({ type: "run_status", active: true } as AgentEvent);

    const promise = reconciler.reconcile(client, "a1", "s1");
    release?.(page());
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(reconciler.shouldBuffer()).toBe(false);
    expect(harness.state?.historyStatus).toBe("ready");
  });

  it("merges history and reduces buffered events in a single update", async () => {
    const harness = createHarness();
    harness.state = session({ messages: [{ role: "user", content: "hi" } as never] });
    const reconciler = new HistoryReconciler<TestSession>(harness.callbacks);
    const client = createClient(() => Promise.resolve(page([
      { id: 1, message: { role: "user", content: "hi", timestamp: 10 } },
      { id: 2, message: { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 20 } },
    ])));

    reconciler.onOpen();
    reconciler.buffer({ type: "run_status", active: false } as AgentEvent);
    await reconciler.reconcile(client, "a1", "s1");

    expect(harness.updateCount).toHaveBeenCalledTimes(1);
    expect(harness.state?.messages.map((m) => m.content)).toEqual(["hi", "done"]);
    expect(harness.state?.streaming).toBe(false);
    expect(harness.state?.historyStatus).toBe("ready");
    expect(harness.applied).toEqual([]);
  });

  it("retries with backoff before succeeding", async () => {
    const harness = createHarness();
    harness.state = session();
    const reconciler = new HistoryReconciler<TestSession>(harness.callbacks);
    let calls = 0;
    const client = createClient(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("boom"));
      return Promise.resolve(page());
    });

    reconciler.onOpen();
    const promise = reconciler.reconcile(client, "a1", "s1");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(calls).toBe(2);
    expect(harness.state?.historyStatus).toBe("ready");
  });

  it("marks historyError and flushes buffered events after exhausting retries", async () => {
    const harness = createHarness();
    harness.state = session();
    const reconciler = new HistoryReconciler<TestSession>(harness.callbacks);
    const client = createClient(() => Promise.reject(new Error("boom")));

    reconciler.onOpen();
    reconciler.buffer({ type: "run_status", active: false } as AgentEvent);
    const promise = reconciler.reconcile(client, "a1", "s1");
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 5000);
    await promise;

    expect(harness.state?.historyStatus).toBe("pending");
    expect(harness.state?.historyError).toBe(true);
    expect(harness.applied).toEqual([[{ type: "run_status", active: false }]]);
    expect(harness.streamingNotified).toEqual([]);
  });

  it("still notifies streaming and keeps ready status when history was ready before", async () => {
    const harness = createHarness();
    harness.state = session({ historyStatus: "ready" });
    const reconciler = new HistoryReconciler<TestSession>(harness.callbacks);
    const client = createClient(() => Promise.reject(new Error("boom")));

    reconciler.onOpen();
    const promise = reconciler.reconcile(client, "a1", "s1");
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 5000);
    await promise;

    expect(harness.state?.historyStatus).toBe("ready");
    expect(harness.state?.historyError).toBe(false);
    expect(harness.streamingNotified).toEqual([false]);
  });

  it("aborts without touching state when the socket was replaced", async () => {
    const harness = createHarness();
    harness.state = session();
    const reconciler = new HistoryReconciler<TestSession>(harness.callbacks);
    let release: ((value: unknown) => void) | undefined;
    const client = createClient(() => new Promise((resolve) => {
      release = resolve;
    }));

    reconciler.onOpen();
    const promise = reconciler.reconcile(client, "a1", "s1");
    harness.setCurrent(false);
    release?.(page());
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(harness.updateCount).not.toHaveBeenCalled();
    expect(harness.streamingNotified).toEqual([]);
  });

  it("flushes buffered events via applyEvents", () => {
    const harness = createHarness();
    harness.state = session();
    const reconciler = new HistoryReconciler<TestSession>(harness.callbacks);
    reconciler.onOpen();
    const events = [{ type: "run_status", active: false } as AgentEvent];
    reconciler.buffer(events[0]);

    reconciler.flushBuffered();
    expect(harness.applied).toEqual([events]);

    reconciler.buffer(events[0]);
    reconciler.flushBuffered();
    expect(harness.applied).toHaveLength(2);
  });

  it("downgrades syncing historyStatus on close based on historyWasReady", () => {
    const fresh = createHarness();
    fresh.state = session({ historyStatus: "pending" });
    const freshReconciler = new HistoryReconciler<TestSession>(fresh.callbacks);
    freshReconciler.onOpen();
    const downgraded = freshReconciler.applyClosedState(
      session({ historyStatus: "syncing" }),
    );
    expect(downgraded.historyStatus).toBe("pending");

    const ready = createHarness();
    ready.state = session({ historyStatus: "ready" });
    const readyReconciler = new HistoryReconciler<TestSession>(ready.callbacks);
    readyReconciler.onOpen();
    expect(
      readyReconciler.applyClosedState(session({ historyStatus: "syncing" })).historyStatus,
    ).toBe("ready");
  });

  it("keeps non-syncing historyStatus untouched on close", () => {
    const harness = createHarness();
    const reconciler = new HistoryReconciler<TestSession>(harness.callbacks);
    const closed = session({ historyStatus: "ready" });
    expect(reconciler.applyClosedState(closed)).toBe(closed);
  });

  it("backfills older pages until the loaded window covers the previous low watermark", async () => {
    const harness = createHarness();
    harness.state = session({
      oldestLoadedId: 2,
      hasMore: true,
      historyStatus: "ready",
    });
    const reconciler = new HistoryReconciler<TestSession>(harness.callbacks);
    const calls: Array<{ limit?: number; before?: number }> = [];
    const client: ApiClient = {
      getSessionMessagesPage: vi.fn((_agentId: string, _sessionId: string, params: { limit?: number; before?: number }) => {
        calls.push(params);
        if (params?.before === undefined) {
          return Promise.resolve({
            entries: Array.from({ length: 20 }, (_, i) => ({
              id: 13 + i,
              message: { role: "assistant", content: [{ type: "text", text: `m${13 + i}` }] },
            })),
            hasMore: true,
            oldestId: 13,
          });
        }
        return Promise.resolve({
          entries: [
            { id: 1, message: { role: "user", content: "old question" } },
            { id: 2, message: { role: "assistant", content: [{ type: "text", text: "old answer" }] } },
          ],
          hasMore: false,
          oldestId: 1,
        });
      }),
    } as unknown as ApiClient;

    reconciler.onOpen();
    await reconciler.reconcile(client, "a1", "s1");

    expect(calls).toEqual([
      { limit: 20 },
      { limit: 20, before: 13 },
    ]);
    expect(harness.state?.oldestLoadedId).toBe(1);
    expect(harness.state?.hasMore).toBe(false);
    expect(harness.state?.messages.map((m) => m.content)).toEqual([
      "old question",
      "old answer",
      ...Array.from({ length: 20 }, (_, i) => `m${13 + i}`),
    ]);
  });

  it("reduces events buffered during the backfill loop with the older page merge", async () => {
    const harness = createHarness();
    harness.state = session({
      oldestLoadedId: 1,
      hasMore: true,
      historyStatus: "ready",
    });
    const reconciler = new HistoryReconciler<TestSession>(harness.callbacks);
    let releaseOlder: ((value: unknown) => void) | undefined;
    const client: ApiClient = {
      getSessionMessagesPage: vi.fn((_agentId: string, _sessionId: string, params: { limit?: number; before?: number }) => {
        if (params?.before === undefined) {
          return Promise.resolve({
            entries: Array.from({ length: 20 }, (_, i) => ({
              id: 13 + i,
              message: { role: "assistant", content: [{ type: "text", text: `m${13 + i}` }] },
            })),
            hasMore: true,
            oldestId: 13,
          });
        }
        return new Promise((resolve) => {
          releaseOlder = resolve;
        });
      }),
    } as unknown as ApiClient;

    reconciler.onOpen();
    const promise = reconciler.reconcile(client, "a1", "s1");
    await vi.advanceTimersByTimeAsync(0);
    reconciler.buffer({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "live during backfill" }] } } as AgentEvent);
    releaseOlder?.({
      entries: [{ id: 1, message: { role: "user", content: "old question" } }],
      hasMore: false,
      oldestId: 1,
    });
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    const texts = harness.state?.messages.map((m) => m.content);
    expect(texts).toContain("live during backfill");
    expect(texts?.[texts.length - 1]).toBe("live during backfill");
  });
});
