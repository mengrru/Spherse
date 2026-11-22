import { describe, it, expect, vi } from "vitest";
import { TriggerScheduler, type TriggerRef } from "../scheduler.js";
import type { TriggerEntry } from "../../types.js";

const T0 = new Date("2026-08-20T09:00:00Z").getTime();

function makeTimeEntry(overrides?: Partial<TriggerEntry>): TriggerEntry {
  return {
    id: "tr-1",
    enabled: true,
    type: "time",
    cron: "* * * * *",
    mode: "new_session",
    message: "hi",
    notify: false,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function ref(entry: TriggerEntry): TriggerRef {
  return { agentId: "a1", agentName: "Agent", entry };
}

function makeScheduler(entries: TriggerEntry[]) {
  const onDue = vi.fn();
  const isRunning = vi.fn(() => false);
  const readAll = vi.fn(async (): Promise<TriggerRef[]> => entries.map(ref));
  const scheduler = new TriggerScheduler({ readAll, onDue, isRunning });
  return { scheduler, onDue, isRunning, readAll };
}

describe("TriggerScheduler", () => {
  it("does not fire when next occurrence is in the future", async () => {
    const { scheduler, onDue } = makeScheduler([makeTimeEntry()]);
    await scheduler.onTimeTick(T0);
    expect(onDue).not.toHaveBeenCalled();
  });

  it("fires when next occurrence has passed", async () => {
    const { scheduler, onDue } = makeScheduler([makeTimeEntry()]);
    await scheduler.onTimeTick(T0);
    await scheduler.onTimeTick(T0 + 61_000);
    expect(onDue).toHaveBeenCalledTimes(1);
    expect(onDue).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "a1", entry: expect.objectContaining({ id: "tr-1" }) }),
    );
  });

  it("does not refire within the same occurrence after markFired", async () => {
    const { scheduler, onDue } = makeScheduler([makeTimeEntry()]);
    await scheduler.onTimeTick(T0);
    await scheduler.onTimeTick(T0 + 61_000);
    await scheduler.onTimeTick(T0 + 61_500);
    expect(onDue).toHaveBeenCalledTimes(1);
  });

  it("fires again at the next occurrence", async () => {
    const { scheduler, onDue } = makeScheduler([makeTimeEntry()]);
    await scheduler.onTimeTick(T0);
    await scheduler.onTimeTick(T0 + 61_000);
    await scheduler.onTimeTick(T0 + 121_000);
    expect(onDue).toHaveBeenCalledTimes(2);
  });

  it("skips disabled triggers", async () => {
    const { scheduler, onDue } = makeScheduler([makeTimeEntry({ enabled: false })]);
    await scheduler.onTimeTick(T0);
    await scheduler.onTimeTick(T0 + 121_000);
    expect(onDue).not.toHaveBeenCalled();
  });

  it("skips event-type triggers", async () => {
    const entry = makeTimeEntry({ type: "event", eventName: "e", cron: undefined });
    const { scheduler, onDue } = makeScheduler([entry]);
    await scheduler.onTimeTick(T0);
    await scheduler.onTimeTick(T0 + 121_000);
    expect(onDue).not.toHaveBeenCalled();
  });

  it("skips triggers whose execution is still in progress and fires the overdue occurrence once free", async () => {
    const { scheduler, onDue, isRunning } = makeScheduler([makeTimeEntry()]);
    await scheduler.onTimeTick(T0);
    isRunning.mockReturnValue(true);
    await scheduler.onTimeTick(T0 + 61_000);
    expect(onDue).not.toHaveBeenCalled();
    isRunning.mockReturnValue(false);
    await scheduler.onTimeTick(T0 + 62_000);
    expect(onDue).toHaveBeenCalledTimes(1);
  });

  it("never fires a trigger with an invalid cron", async () => {
    const { scheduler, onDue } = makeScheduler([makeTimeEntry({ cron: "not-a-cron" })]);
    await scheduler.onTimeTick(T0);
    await scheduler.onTimeTick(T0 + 10 * 60_000);
    expect(onDue).not.toHaveBeenCalled();
  });

  it("markFired advances next fire so a subsequent tick does not double-fire", async () => {
    const { scheduler, onDue } = makeScheduler([makeTimeEntry()]);
    await scheduler.onTimeTick(T0);
    scheduler.markFired("tr-1", "0 10 * * *", T0);
    await scheduler.onTimeTick(T0 + 90_000);
    expect(onDue).not.toHaveBeenCalled();
  });

  it("drops state for triggers no longer on disk so a re-added entry does not inherit stale nextFire", async () => {
    let entries = [makeTimeEntry()];
    const onDue = vi.fn();
    const scheduler = new TriggerScheduler({
      readAll: async () => entries.map(ref),
      onDue,
      isRunning: () => false,
    });
    await scheduler.onTimeTick(T0);
    entries = [];
    await scheduler.onTimeTick(T0 + 61_000);
    entries = [makeTimeEntry()];
    await scheduler.onTimeTick(T0 + 62_000);
    expect(onDue).not.toHaveBeenCalled();
  });
});
