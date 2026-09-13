import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMessagesPageResponse } from "@spherse/contracts";
import { createSessionRecovery, type RecoveryHost } from "./session-recovery";
import type { AgentEvent } from "../model/agent-event-parse";
import type { DecodedFrame } from "./decode";

function page(): SessionMessagesPageResponse {
  return { entries: [], hasMore: false, oldestId: null };
}

function event(type: string): DecodedFrame {
  return { kind: "event", event: { type } as unknown as AgentEvent };
}

function sessionReady(replay = true): DecodedFrame {
  return { kind: "session-ready", lastSeq: 0, replay };
}

function createHost(overrides: Partial<RecoveryHost> = {}) {
  const calls = {
    applied: 0,
    finished: 0,
    persisted: [] as string[][],
    emitted: [] as AgentEvent[][],
    history: [] as Array<[string, boolean]>,
    order: [] as string[],
  };
  const host: RecoveryHost = {
    fetchPage: vi.fn().mockResolvedValue(page()),
    applyPage: () => {
      calls.applied += 1;
      calls.order.push("applyPage");
    },
    applyPersistedEvents: (events) => {
      calls.persisted.push(events.map((item) => item.type));
      calls.order.push("persisted");
    },
    finishReplay: () => {
      calls.finished += 1;
      calls.order.push("finishReplay");
    },
    emitEvents: (events) => {
      calls.emitted.push(events);
      calls.order.push("emit");
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

describe("session recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reconciles over HTTP on a cold open and buffers frames until the page lands", async () => {
    const { host, calls } = createHost();
    const recovery = createSessionRecovery(host);

    recovery.onOpen(undefined);
    expect(calls.history[0]).toEqual(["syncing", false]);
    expect(recovery.onFrame(event("buffered"))).toBe(true);

    await vi.advanceTimersByTimeAsync(0);
    expect(calls.applied).toBe(1);
    expect(calls.emitted).toEqual([[{ type: "buffered" }]]);
    expect(calls.history.at(-1)).toEqual(["ready", false]);
    expect(recovery.onFrame(event("live"))).toBe(false);
  });

  it("replays from since on a warm open before delivering snapshot frames", () => {
    const { host, calls } = createHost();
    const recovery = createSessionRecovery(host);

    recovery.onOpen(5);
    expect(host.fetchPage).not.toHaveBeenCalled();
    expect(recovery.onFrame(sessionReady())).toBe(true);
    expect(recovery.onFrame({ kind: "event", event: { type: "message_start" } as unknown as AgentEvent })).toBe(true);
    expect(recovery.onFrame({
      kind: "replay-events",
      events: [{ type: "user/message" }],
    } as unknown as DecodedFrame)).toBe(true);
    expect(recovery.onFrame({
      kind: "replay-events",
      events: [{ type: "assistant/message" }],
    } as unknown as DecodedFrame)).toBe(true);
    expect(calls.emitted).toEqual([]);

    expect(recovery.onFrame({ kind: "replay-done" })).toBe(true);

    expect(calls.persisted).toEqual([["user/message"], ["assistant/message"]]);
    expect(calls.finished).toBe(1);
    expect(calls.emitted).toEqual([[{ type: "message_start" }]]);
    expect(calls.history.at(-1)).toEqual(["ready", false]);
    expect(calls.order).toEqual(["persisted", "persisted", "finishReplay", "emit"]);
    expect(recovery.onFrame(event("live"))).toBe(false);
  });

  it("falls back to HTTP reconciliation when the first frame is not session_ready", async () => {
    const { host, calls } = createHost();
    const recovery = createSessionRecovery(host);

    recovery.onOpen(5);
    expect(host.fetchPage).not.toHaveBeenCalled();
    expect(recovery.onFrame(event("legacy"))).toBe(true);

    await vi.advanceTimersByTimeAsync(0);
    expect(calls.applied).toBe(1);
    expect(calls.emitted).toEqual([[{ type: "legacy" }]]);
    expect(calls.history.at(-1)).toEqual(["ready", false]);
  });

  it("falls back to HTTP reconciliation when the server cannot replay", async () => {
    const { host, calls } = createHost();
    const recovery = createSessionRecovery(host);

    recovery.onOpen(5);
    expect(recovery.onFrame(sessionReady(false))).toBe(true);

    await vi.advanceTimersByTimeAsync(0);
    expect(calls.applied).toBe(1);
    expect(calls.history.at(-1)).toEqual(["ready", false]);
  });

  it("retries with backoff before failing and keeps the never-ready error semantics", async () => {
    const fetchPage = vi.fn()
      .mockRejectedValueOnce(new Error("nope"))
      .mockRejectedValueOnce(new Error("nope"))
      .mockRejectedValueOnce(new Error("nope"))
      .mockRejectedValueOnce(new Error("nope"));

    const pending = createHost({ fetchPage });
    const pendingRecovery = createSessionRecovery(pending.host);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    pendingRecovery.onOpen(undefined);
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
    const readyRecovery = createSessionRecovery(ready.host);
    const warn2 = vi.spyOn(console, "warn").mockImplementation(() => {});
    readyRecovery.onOpen(undefined);
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
    const recovery = createSessionRecovery(host);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    recovery.onOpen(undefined);
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
    const recovery = createSessionRecovery(host);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    recovery.onOpen(undefined);
    await vi.advanceTimersByTimeAsync(0);
    recovery.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("flushes buffered frames and restores history status when the socket closes mid-sync", () => {
    const { host, calls } = createHost({
      fetchPage: vi.fn().mockImplementation(() => new Promise(() => {})),
    });
    const recovery = createSessionRecovery(host);

    recovery.onOpen(undefined);
    recovery.onFrame(event("buffered"));
    recovery.onClose();

    expect(calls.emitted).toEqual([[{ type: "buffered" }]]);
    expect(calls.history.at(-1)).toEqual(["pending", false]);
  });

  it("flushes snapshot frames buffered during replay when the socket closes", () => {
    const { host, calls } = createHost();
    const recovery = createSessionRecovery(host);

    recovery.onOpen(5);
    recovery.onFrame(sessionReady());
    recovery.onFrame(event("snapshot"));
    recovery.onClose();

    expect(calls.emitted).toEqual([[{ type: "snapshot" }]]);
    expect(calls.history.at(-1)).toEqual(["pending", false]);
  });
});
