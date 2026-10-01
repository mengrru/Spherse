import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShutdown, createShutdownCoordinator, isQuitting } from "./lifecycle.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(cleanup = vi.fn(async () => {})) {
  const actions = { cleanup, quit: vi.fn(), relaunch: vi.fn(), exit: vi.fn() };
  return { actions, coordinator: createShutdownCoordinator(actions) };
}

describe("shutdown coordinator", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("shares ordinary cleanup and prevents every quit until it finishes", async () => {
    const pending = deferred();
    const { coordinator, actions } = setup(vi.fn(() => pending.promise));
    const first = coordinator.quit();
    expect(coordinator.quit()).toBe(first);
    expect(coordinator.isQuitting()).toBe(true);
    expect(coordinator.canExit()).toBe(false);
    await Promise.resolve();
    expect(actions.cleanup).toHaveBeenCalledTimes(1);
    expect(actions.quit).not.toHaveBeenCalled();
    pending.resolve();
    await first;
    expect(coordinator.canExit()).toBe(true);
    expect(actions.quit).toHaveBeenCalledTimes(1);
  });

  it("ordinary quit accepted first rejects installation", async () => {
    const { coordinator } = setup();
    const handoff = vi.fn();
    const quit = coordinator.quit();
    expect(await coordinator.install(handoff, vi.fn())).toBe(false);
    await quit;
    expect(handoff).not.toHaveBeenCalled();
  });

  it("installation owns the terminal action and waits for cleanup", async () => {
    const pending = deferred();
    const { coordinator, actions } = setup(vi.fn(() => pending.promise));
    const handoff = vi.fn(() => { expect(coordinator.canExit()).toBe(true); });
    const install = coordinator.install(handoff, vi.fn());
    const quit = coordinator.quit();
    expect(coordinator.canExit()).toBe(false);
    expect(await coordinator.install(handoff, vi.fn())).toBe(false);
    await Promise.resolve();
    expect(handoff).not.toHaveBeenCalled();
    pending.resolve();
    expect(await install).toBe(true);
    await quit;
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(actions.cleanup).toHaveBeenCalledTimes(1);
    expect(actions.quit).not.toHaveBeenCalled();
  });

  it.each(["cleanup", "handoff"])("restarts normally after %s failure", async (phase) => {
    const error = new Error(phase);
    const { coordinator, actions } = setup(vi.fn(async () => { if (phase === "cleanup") throw error; }));
    const handoff = vi.fn(() => { if (phase === "handoff") throw error; });
    const failure = vi.fn();
    await coordinator.install(handoff, failure);
    coordinator.failInstall(error);
    expect(failure).toHaveBeenCalledExactlyOnceWith(error);
    expect(actions.relaunch).toHaveBeenCalledTimes(1);
    expect(actions.quit).toHaveBeenCalledTimes(1);
    expect(coordinator.canExit()).toBe(true);
    if (phase === "cleanup") expect(handoff).not.toHaveBeenCalled();
  });

  it("recovers asynchronous handoff errors without a second terminal owner", async () => {
    const { coordinator, actions } = setup();
    const failure = vi.fn();
    await coordinator.install(vi.fn(), failure);
    await coordinator.quit();
    const error = new Error("spawn failed");
    coordinator.failInstall(error);
    expect(failure).toHaveBeenCalledExactlyOnceWith(error);
    expect(actions.relaunch).toHaveBeenCalledTimes(1);
    expect(actions.quit).toHaveBeenCalledTimes(1);
  });

  it("keeps the ordinary hard exit timeout", async () => {
    const { coordinator, actions } = setup(vi.fn(() => deferred().promise));
    void coordinator.quit();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(actions.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(actions.relaunch).not.toHaveBeenCalled();
  });

  it("times out installation cleanup without ever handing off afterward", async () => {
    const pending = deferred();
    const { coordinator, actions } = setup(vi.fn(() => pending.promise));
    const failure = vi.fn();
    const handoff = vi.fn();
    const install = coordinator.install(handoff, failure);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(actions.relaunch).toHaveBeenCalledTimes(1);
    pending.resolve();
    await install;
    expect(handoff).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(actions.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("recovers when installer never quits", async () => {
    const { coordinator, actions } = setup();
    const failure = vi.fn();
    await coordinator.install(vi.fn(), failure);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(actions.relaunch).toHaveBeenCalledTimes(1);
  });

  it("ordinary cleanup errors still exit without unhandled rejection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { coordinator, actions } = setup(vi.fn(async () => { throw new Error("cleanup"); }));
    await expect(coordinator.quit()).resolves.toBeUndefined();
    expect(actions.quit).toHaveBeenCalledTimes(1);
    expect(coordinator.canExit()).toBe(true);
  });

  it("exposes the shared lifecycle flag for close-to-tray", async () => {
    expect(isQuitting()).toBe(false);
    const { actions } = setup();
    const coordinator = configureShutdown(actions);
    const task = coordinator.quit();
    expect(isQuitting()).toBe(true);
    await task;
  });
});
