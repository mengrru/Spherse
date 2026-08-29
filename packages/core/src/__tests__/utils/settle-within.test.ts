import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settleWithin } from "../../utils/settle-within.js";

describe("settleWithin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when the promise resolves without calling onSettle", async () => {
    const onSettle = vi.fn();
    await settleWithin(Promise.resolve("ok"), 1_000, onSettle);
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("resolves immediately for an empty promise", async () => {
    const onSettle = vi.fn();
    await settleWithin(undefined, 1_000, onSettle);
    await settleWithin(null, 1_000, onSettle);
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("calls onSettle with timeout and resolves when the promise never settles", async () => {
    const onSettle = vi.fn();
    const pending = new Promise<void>(() => {});
    let resolved = false;
    void settleWithin(pending, 5_000, onSettle).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith("timeout");
  });

  it("does not call onSettle from a late timer after normal resolution", async () => {
    const onSettle = vi.fn();
    let resolvePromise!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const result = settleWithin(promise, 5_000, onSettle);
    resolvePromise();
    await result;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("calls onSettle with error and resolves when the promise rejects", async () => {
    const onSettle = vi.fn();
    const err = new Error("boom");
    await settleWithin(Promise.reject(err), 1_000, onSettle);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith("error", err);
  });

  it("does not call onSettle again when the promise rejects after timeout", async () => {
    const onSettle = vi.fn();
    let rejectPromise!: (err: Error) => void;
    const promise = new Promise<void>((_, reject) => {
      rejectPromise = reject;
    });
    const result = settleWithin(promise, 5_000, onSettle);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onSettle).toHaveBeenCalledTimes(1);
    rejectPromise(new Error("late"));
    await result;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it("survives an onSettle callback that throws", async () => {
    const onSettle = vi.fn(() => {
      throw new Error("callback blew up");
    });
    await expect(
      settleWithin(Promise.reject(new Error("boom")), 1_000, onSettle),
    ).resolves.toBeUndefined();
    const hanging = settleWithin(new Promise<void>(() => {}), 1_000, onSettle);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(hanging).resolves.toBeUndefined();
  });
});
