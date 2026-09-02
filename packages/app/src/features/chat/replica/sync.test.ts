import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../lib/api";
import { runSync, type SyncDeps } from "./sync";
import { initialReplica, reduceReplica, type ReplicaFrame } from "./session-replica";

const NOW = 1000;

function createHarness(opts?: { eventsPages?: Array<{ events: object[]; hasMore: boolean }>; snapshot?: object; eventsError?: unknown }) {
  const frames: ReplicaFrame[] = [];
  let replica = initialReplica();
  let active = true;

  const getState = vi.fn(() => (active ? replica : undefined));
  const emit = vi.fn((frame: ReplicaFrame) => {
    frames.push(frame);
    replica = reduceReplica(replica, frame, NOW);
  });

  const client = {
    getSessionMessagesPage: vi.fn().mockImplementation(() => {
      if (opts?.snapshot instanceof Error) return Promise.reject(opts.snapshot);
      return Promise.resolve(opts?.snapshot ?? { entries: [], hasMore: false, oldestId: null });
    }),
    getSessionEvents: vi.fn().mockImplementation(() => {
      if (opts?.eventsError) return Promise.reject(opts.eventsError);
      const page = opts?.eventsPages?.shift();
      return Promise.resolve(page ?? { events: [], hasMore: false });
    }),
  };

  const deps: SyncDeps = {
    client: client as never,
    agentId: "a1",
    sessionId: "s1",
    emit,
    getState,
    isRecordActive: () => active,
  };

  return {
    deps, frames, client, replica: () => replica,
    deactivate: () => { active = false; },
  };
}

function settled(seq: number, message: object) {
  return { type: "message_settled", seq, message };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sync orchestration", () => {
  it("cold start loads a full snapshot then catches up with events", async () => {
    const h = createHarness({
      snapshot: {
        entries: [
          { id: 0, message: { role: "user", content: "q", timestamp: 1 } },
          { id: 1, message: { role: "assistant", content: [{ type: "text", text: "a" }], timestamp: 2 } },
        ],
        hasMore: true,
        oldestId: 0,
      },
      eventsPages: [
        { events: [settled(2, { role: "user", content: "late", timestamp: 3 })], hasMore: false },
      ],
    });

    await runSync(h.deps, "initial");

    expect(h.client.getSessionMessagesPage).toHaveBeenCalledWith("a1", "s1", { limit: 20 });
    expect(h.client.getSessionEvents).toHaveBeenCalledWith("a1", "s1", { since: 1, limit: 200 });
    expect(h.replica().durable.entries.map((entry) => entry.seq)).toEqual([0, 1, 2]);
    expect(h.replica().historyStatus).toBe("ready");
    expect(h.replica().durable.mode).toBe("events");
  });

  it("catchup paginates through hasMore using the last frame cursor", async () => {
    const h = createHarness({
      eventsPages: [
        { events: [settled(3, { role: "user", content: "a", timestamp: 1 }), { type: "turn_withdrawn", seq: 3, upTo: 4 }], hasMore: true },
        { events: [settled(5, { role: "user", content: "b", timestamp: 2 })], hasMore: false },
      ],
    });

    await runSync(h.deps, "catchup");

    expect(h.client.getSessionEvents).toHaveBeenCalledTimes(2);
    expect(h.client.getSessionEvents).toHaveBeenNthCalledWith(1, "a1", "s1", { since: -1, limit: 200 });
    expect(h.client.getSessionEvents).toHaveBeenNthCalledWith(2, "a1", "s1", { since: 4, limit: 200 });
    expect(h.replica().durable.entries.map((entry) => entry.seq)).toEqual([5]);
    expect(h.replica().durable.highSeq).toBe(5);
  });

  it("switches to legacy snapshot mode on 410 without retrying the events call", async () => {
    const h = createHarness({
      eventsError: new ApiError("legacy-unmigrated", 410),
      snapshot: {
        entries: [{ id: 0, message: { role: "user", content: "legacy", timestamp: 1 } }],
        hasMore: false,
        oldestId: 0,
      },
    });

    await runSync(h.deps, "initial");

    expect(h.client.getSessionEvents).toHaveBeenCalledTimes(1);
    expect(h.replica().durable.mode).toBe("snapshot");
    expect(h.replica().historyStatus).toBe("ready");
  });

  it("marks syncFailed after exhausting backoff retries", async () => {
    const h = createHarness({ eventsError: new Error("network down") });
    const promise = runSync(h.deps, "catchup");
    await vi.advanceTimersByTimeAsync(9000);
    await promise;

    expect(h.client.getSessionEvents).toHaveBeenCalledTimes(4);
    expect(h.replica().historyStatus).toBe("pending");
    expect(h.replica().historyError).toBe(true);
  });

  it("stops retrying once the record is gone", async () => {
    const h = createHarness({ eventsError: new Error("network down") });
    const promise = runSync(h.deps, "catchup");
    h.deactivate();
    await vi.advanceTimersByTimeAsync(9000);
    await promise;

    expect(h.client.getSessionEvents).toHaveBeenCalledTimes(1);
    expect(h.replica().historyStatus).toBe("syncing");
  });

  it("full resync replaces entries with the snapshot truth", async () => {
    const h = createHarness({
      snapshot: {
        entries: [{ id: 0, message: { role: "user", content: "fresh", timestamp: 1 } }],
        hasMore: false,
        oldestId: 0,
      },
      eventsPages: [],
    });
    await runSync(h.deps, "full");
    expect(h.replica().durable.entries).toHaveLength(1);
    expect(h.replica().durable.resyncNeeded).toBe(false);
  });
});

describe("sync timers", () => {
  it("retries with backoff between attempts", async () => {
    const h = createHarness({
      eventsPages: undefined,
      eventsError: new Error("flaky"),
    });
    h.client.getSessionEvents
      .mockRejectedValueOnce(new Error("flaky"))
      .mockRejectedValueOnce(new Error("flaky"))
      .mockResolvedValueOnce({ events: [], hasMore: false });

    const promise = runSync(h.deps, "catchup");
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    expect(h.replica().historyStatus).toBe("ready");
  });
});
