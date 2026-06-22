import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import type { acquireFsWatch as AcquireFsWatch } from "../lib/fs-watcher.js";
import type { releaseFsWatch as ReleaseFsWatch } from "../lib/fs-watcher.js";

interface FakeWatcher {
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  trigger: (eventType: "rename" | "change", filename: string | null) => void;
  triggerError: (err: unknown) => void;
}

interface WatchCall {
  root: string;
  opts: unknown;
}

interface FsWatchMock {
  fake: FakeWatcher;
  calls: WatchCall[];
}

function installFsWatchMock(): FsWatchMock {
  const calls: WatchCall[] = [];
  let changeCb:
    | ((eventType: "rename" | "change", filename: string | null) => void)
    | null = null;
  let errorCb: ((err: unknown) => void) | null = null;
  const fake: FakeWatcher = {
    on: vi.fn((event: string, cb: (arg: unknown) => void) => {
      if (event === "error") errorCb = cb as (err: unknown) => void;
    }),
    close: vi.fn(),
    trigger: (eventType, filename) => {
      changeCb?.(eventType, filename);
    },
    triggerError: (err) => {
      errorCb?.(err);
    },
  };
  vi.spyOn(fs, "watch").mockImplementation(((
    root: unknown,
    opts: unknown,
    cb?: (eventType: "rename" | "change", filename: string | null) => void,
  ) => {
    calls.push({ root: String(root), opts });
    changeCb = cb ?? null;
    return fake as unknown as fs.FSWatcher;
  }) as unknown as typeof fs.watch);
  return { fake, calls };
}

describe("ProjectFsWatcher", () => {
  let acquireFsWatch: typeof AcquireFsWatch;
  let releaseFsWatch: typeof ReleaseFsWatch;
  let mock: FsWatchMock;

  beforeEach(async () => {
    vi.resetModules();
    mock = installFsWatchMock();
    const mod = await import("../lib/fs-watcher.js");
    acquireFsWatch = mod.acquireFsWatch;
    releaseFsWatch = mod.releaseFsWatch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a single fs.watch for multiple acquires on the same projectId", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    const r1 = acquireFsWatch("/proj", "p1", listenerA);
    const r2 = acquireFsWatch("/proj", "p1", listenerB);

    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    expect(fs.watch).toHaveBeenCalledTimes(1);
    expect(mock.calls[0].root).toBe("/proj");
    expect(mock.calls[0].opts).toEqual({ recursive: true });
  });

  it("closes the watcher and clears the map on equal releases", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    acquireFsWatch("/proj", "p1", listenerA);
    acquireFsWatch("/proj", "p1", listenerB);

    releaseFsWatch("p1", listenerA);
    expect(mock.fake.close).not.toHaveBeenCalled();

    releaseFsWatch("p1", listenerB);
    expect(mock.fake.close).toHaveBeenCalledTimes(1);

    acquireFsWatch("/proj", "p1", listenerA);
    expect(fs.watch).toHaveBeenCalledTimes(2);
  });

  it("returns error and does not add listener when fs.watch throws", () => {
    vi.restoreAllMocks();
    const boom = new Error("boom");
    vi.spyOn(fs, "watch").mockImplementation(() => {
      throw boom;
    });

    const listenerA = vi.fn();
    const result = acquireFsWatch("/proj", "p1", listenerA);
    expect(result).toEqual({ ok: false, error: boom });

    vi.restoreAllMocks();
    const fresh = installFsWatchMock();
    const listenerB = vi.fn();
    const ok = acquireFsWatch("/proj", "p1", listenerB);
    expect(ok).toEqual({ ok: true });

    fresh.fake.trigger("change", "src/x.ts");
    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it("invokes all listeners on change, filters .spherse/ except theme.css", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    acquireFsWatch("/proj", "p1", listenerA);
    acquireFsWatch("/proj", "p1", listenerB);

    mock.fake.trigger("change", "src/bar.ts");
    mock.fake.trigger("rename", ".spherse/theme.css");
    mock.fake.trigger("change", ".spherse/sessions/abc.json");
    mock.fake.trigger("change", null);

    expect(listenerA).toHaveBeenCalledTimes(2);
    expect(listenerB).toHaveBeenCalledTimes(2);
    expect(listenerA).toHaveBeenCalledWith("p1", {
      eventType: "change",
      path: "src/bar.ts",
    });
    expect(listenerA).toHaveBeenCalledWith("p1", {
      eventType: "rename",
      path: ".spherse/theme.css",
    });
  });

  it("cleans up on async watcher error event", () => {
    const listenerA = vi.fn();
    acquireFsWatch("/proj", "p1", listenerA);

    mock.fake.triggerError(new Error("os error"));

    expect(mock.fake.close).toHaveBeenCalledTimes(1);

    acquireFsWatch("/proj", "p1", listenerA);
    expect(fs.watch).toHaveBeenCalledTimes(2);
  });
});
