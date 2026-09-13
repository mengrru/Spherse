import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMessagesPageResponse } from "@spherse/contracts";
import { createHttpRecovery, type RecoveryHost } from "./session-recovery";
import type { AgentEvent } from "../model/agent-event-parse";

function page(): SessionMessagesPageResponse {
  return { entries: [], hasMore: false, oldestId: null };
}

function event(type: string): AgentEvent {
  return { type } as unknown as AgentEvent;
}

function createHost(overrides: Partial<RecoveryHost> = {}) {
  const calls = {
    applied: 0,
    emitted: [] as AgentEvent[][],
    history: [] as Array<[string, boolean]>,
  };
  const host: RecoveryHost = {
    fetchPage: vi.fn().mockResolvedValue(page()),
    applyPage: () => {
      calls.applied += 1;
    },
    emitEvents: (events) => {
      calls.emitted.push(events);
    },
    setHistory: (status, error) => {
      calls.history.push([status, error]);
    },
    getHistoryStatus: () => "pending",
    isAlive: () => true,
    ...overrides,
  };
  return { host, calls };
}

describe("http recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("buffers frames during sync, applies the page, then emits buffered events", async () => {
    const { host, calls } = createHost();
    const recovery = createHttpRecovery(host);

    recovery.onOpen();
    expect(calls.history[0]).toEqual(["syncing", false]);
    expect(recovery.onFrame(event("buffered"))).toBe(true);

    await vi.advanceTimersByTimeAsync(0);
    expect(calls.applied).toBe(1);
    expect(calls.emitted).toEqual([[event("buffered")]]);
    expect(calls.history.at(-1)).toEqual(["ready", false]);
    expect(recovery.onFrame(event("live"))).toBe(false);
  });

  it("retries with backoff before failing and keeps the never-ready error semantics", async () => {
    const fetchPage = vi.fn()
      .mockRejectedValueOnce(new Error("nope"))
      .mockRejectedValueOnce(new Error("nope"))
      .mockRejectedValueOnce(new Error("nope"))
      .mockRejectedValueOnce(new Error("nope"));

    const pending = createHost({ fetchPage });
    const pendingRecovery = createHttpRecovery(pending.host);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    pendingRecovery.onOpen();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(pending.calls.history.at(-1)).toEqual(["pending", true]);
    warn.mockRestore();

    const ready = createHost({
      fetchPage: vi.fn().mockRejectedValue(new Error("nope")),
      getHistoryStatus: () => "ready",
    });
    const readyRecovery = createHttpRecovery(ready.host);
    const warn2 = vi.spyOn(console, "warn").mockImplementation(() => {});
    readyRecovery.onOpen();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(ready.calls.history.at(-1)).toEqual(["ready", false]);
    warn2.mockRestore();
  });

  it("succeeds after a transient failure", async () => {
    const fetchPage = vi.fn()
      .mockRejectedValueOnce(new Error("nope"))
      .mockResolvedValue(page());
    const { host, calls } = createHost({ fetchPage });
    const recovery = createHttpRecovery(host);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    recovery.onOpen();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.applied).toBe(1);
    expect(calls.history.at(-1)).toEqual(["ready", false]);
    warn.mockRestore();
  });

  it("cancel stops the retry chain", async () => {
    const fetchPage = vi.fn().mockRejectedValue(new Error("nope"));
    const { host } = createHost({ fetchPage });
    const recovery = createHttpRecovery(host);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    recovery.onOpen();
    await vi.advanceTimersByTimeAsync(0);
    recovery.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("flushes buffered frames and restores history status when the socket closes mid-sync", async () => {
    const { host, calls } = createHost({
      fetchPage: vi.fn().mockImplementation(() => new Promise(() => {})),
    });
    const recovery = createHttpRecovery(host);

    recovery.onOpen();
    recovery.onFrame(event("buffered"));
    recovery.onClose();

    expect(calls.emitted).toEqual([[event("buffered")]]);
    expect(calls.history.at(-1)).toEqual(["pending", false]);
  });
});
