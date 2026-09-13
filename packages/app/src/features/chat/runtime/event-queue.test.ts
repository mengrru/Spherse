import { describe, expect, it } from "vitest";
import {
  createEventQueue,
  type EventBatches,
  type ScheduleFlush,
} from "./event-queue";
import type { AgentEvent } from "../model/agent-event-parse";

function event(type: string): AgentEvent {
  return { type } as unknown as AgentEvent;
}

function manualScheduler() {
  const pending = new Map<number, () => void>();
  let nextId = 0;
  const schedule: ScheduleFlush = (callback) => {
    nextId += 1;
    const id = nextId;
    pending.set(id, callback);
    return () => pending.delete(id);
  };
  return {
    schedule,
    pendingCount: () => pending.size,
    run() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
  };
}

describe("event queue", () => {
  it("batches events per session and flushes once per scheduled frame", () => {
    const batches: EventBatches[] = [];
    const scheduler = manualScheduler();
    const queue = createEventQueue((inflight) => batches.push(inflight), scheduler.schedule);

    queue.push("s1", event("a"));
    queue.push("s1", event("b"));
    queue.push("s2", event("c"));
    expect(scheduler.pendingCount()).toBe(1);

    scheduler.run();
    expect(batches).toHaveLength(1);
    expect(batches[0].get("s1")?.map((item) => item.type)).toEqual(["a", "b"]);
    expect(batches[0].get("s2")?.map((item) => item.type)).toEqual(["c"]);

    queue.push("s1", event("d"));
    expect(scheduler.pendingCount()).toBe(1);
    scheduler.run();
    expect(batches).toHaveLength(2);
  });

  it("pushBatch appends a batch without losing ordering", () => {
    const batches: EventBatches[] = [];
    const scheduler = manualScheduler();
    const queue = createEventQueue((inflight) => batches.push(inflight), scheduler.schedule);

    queue.push("s1", event("a"));
    queue.pushBatch("s1", [event("b"), event("c")]);
    scheduler.run();
    expect(batches[0].get("s1")?.map((item) => item.type)).toEqual(["a", "b", "c"]);
  });

  it("cancels a single session or the whole queue", () => {
    const batches: EventBatches[] = [];
    const scheduler = manualScheduler();
    const queue = createEventQueue((inflight) => batches.push(inflight), scheduler.schedule);

    queue.push("s1", event("a"));
    queue.push("s2", event("b"));
    queue.cancel("s1");
    scheduler.run();
    expect(batches[0].has("s1")).toBe(false);
    expect(batches[0].has("s2")).toBe(true);

    queue.push("s2", event("c"));
    queue.cancel();
    expect(scheduler.pendingCount()).toBe(0);
    scheduler.run();
    expect(batches).toHaveLength(1);
  });

  it("flushNow drains immediately and cancels the scheduled frame", () => {
    const batches: EventBatches[] = [];
    const scheduler = manualScheduler();
    const queue = createEventQueue((inflight) => batches.push(inflight), scheduler.schedule);

    queue.push("s1", event("a"));
    queue.flushNow();
    expect(batches).toHaveLength(1);
    expect(scheduler.pendingCount()).toBe(0);

    scheduler.run();
    expect(batches).toHaveLength(1);
  });
});
