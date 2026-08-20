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
  const readAll = vi.fn((): TriggerRef[] => entries.map(ref));
  const scheduler = new TriggerScheduler({ readAll, onDue, isRunning });
  return { scheduler, onDue, isRunning, readAll };
}

describe("TriggerScheduler", () => {
  it("does not fire when next occurrence is in the future", () => {
    const { scheduler, onDue } = makeScheduler([makeTimeEntry()]);
    scheduler.onTimeTick(T0);
    expect(onDue).not.toHaveBeenCalled();
  });

  it("fires when next occurrence has passed", () => {
    const { scheduler, onDue } = makeScheduler([makeTimeEntry()]);
    scheduler.onTimeTick(T0);
    scheduler.onTimeTick(T0 + 61_000);
    expect(onDue).toHaveBeenCalledTimes(1);
    expect(onDue).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "a1", entry: expect.objectContaining({ id: "tr-1" }) }),
    );
  });

  it("does not refire within the same occurrence after markFired", () => {
    const { scheduler, onDue } = makeScheduler([makeTimeEntry()]);
    scheduler.onTimeTick(T0);
    scheduler.onTimeTick(T0 + 61_000);
    scheduler.onTimeTick(T0 + 61_500);
    expect(onDue).toHaveBeenCalledTimes(1);
  });

  it("fires again at the next occurrence", () => {
    const { scheduler, onDue } = makeScheduler([makeTimeEntry()]);
    scheduler.onTimeTick(T0);
    scheduler.onTimeTick(T0 + 61_000);
    scheduler.onTimeTick(T0 + 121_000);
    expect(onDue).toHaveBeenCalledTimes(2);
  });

  it("skips disabled triggers", () => {
    const { scheduler, onDue } = makeScheduler([makeTimeEntry({ enabled: false })]);
    scheduler.onTimeTick(T0);
    scheduler.onTimeTick(T0 + 121_000);
    expect(onDue).not.toHaveBeenCalled();
  });

  it("skips event-type triggers", () => {
    const entry = makeTimeEntry({ type: "event", eventName: "e", cron: undefined });
    const { scheduler, onDue } = makeScheduler([entry]);
    scheduler.onTimeTick(T0);
    scheduler.onTimeTick(T0 + 121_000);
    expect(onDue).not.toHaveBeenCalled();
  });

  it("skips triggers whose execution is still in progress and fires the overdue occurrence once free", () => {
    const { scheduler, onDue, isRunning } = makeScheduler([makeTimeEntry()]);
    scheduler.onTimeTick(T0);
    isRunning.mockReturnValue(true);
    scheduler.onTimeTick(T0 + 61_000);
    expect(onDue).not.toHaveBeenCalled();
    isRunning.mockReturnValue(false);
    scheduler.onTimeTick(T0 + 62_000);
    expect(onDue).toHaveBeenCalledTimes(1);
  });

  it("never fires a trigger with an invalid cron", () => {
    const { scheduler, onDue } = makeScheduler([makeTimeEntry({ cron: "not-a-cron" })]);
    scheduler.onTimeTick(T0);
    scheduler.onTimeTick(T0 + 10 * 60_000);
    expect(onDue).not.toHaveBeenCalled();
  });

  it("markFired advances next fire so a subsequent tick does not double-fire", () => {
    const { scheduler, onDue } = makeScheduler([makeTimeEntry()]);
    scheduler.onTimeTick(T0);
    scheduler.markFired("tr-1", "0 10 * * *", T0);
    scheduler.onTimeTick(T0 + 90_000);
    expect(onDue).not.toHaveBeenCalled();
  });

  it("drops state for triggers no longer on disk so a re-added entry does not inherit stale nextFire", () => {
    let entries = [makeTimeEntry()];
    const onDue = vi.fn();
    const scheduler = new TriggerScheduler({
      readAll: () => entries.map(ref),
      onDue,
      isRunning: () => false,
    });
    scheduler.onTimeTick(T0);
    entries = [];
    scheduler.onTimeTick(T0 + 61_000);
    entries = [makeTimeEntry()];
    scheduler.onTimeTick(T0 + 62_000);
    expect(onDue).not.toHaveBeenCalled();
  });
});
