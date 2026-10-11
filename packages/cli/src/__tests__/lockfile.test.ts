import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireLockfile,
  findRunningInstance,
  isProcessAlive,
  readLockfile,
  removeLockfile,
  writeLockfile,
} from "../lockfile.js";

const tmpRoots: string[] = [];
afterEach(() => {
  while (tmpRoots.length) rmSync(tmpRoots.pop()!, { recursive: true, force: true });
});

function tmpPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "spherse-cli-lock-"));
  tmpRoots.push(dir);
  return join(dir, name);
}

describe("writeLockfile / readLockfile", () => {
  it("round-trips the payload", () => {
    const path = tmpPath("server.lock");
    writeLockfile(path, { pid: 123, port: 53972, startedAt: "2026-10-12T00:00:00.000Z" });
    expect(readLockfile(path)).toEqual({ pid: 123, port: 53972, startedAt: "2026-10-12T00:00:00.000Z" });
  });

  it("returns null for missing, corrupted or incomplete payloads", () => {
    expect(readLockfile(tmpPath("missing.lock"))).toBeNull();
    const corrupt = tmpPath("corrupt.lock");
    writeFileSync(corrupt, "not json", "utf-8");
    expect(readLockfile(corrupt)).toBeNull();
    const partial = tmpPath("partial.lock");
    writeFileSync(partial, JSON.stringify({ pid: 1 }), "utf-8");
    expect(readLockfile(partial)).toBeNull();
  });
});

describe("removeLockfile", () => {
  it("does not throw for a missing file", () => {
    expect(() => removeLockfile(tmpPath("gone.lock"))).not.toThrow();
  });
});

describe("isProcessAlive", () => {
  it("returns true for the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("returns false for non-positive pids", () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
  });

  it("returns false when the process does not exist (ESRCH)", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("no such process") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
    try {
      expect(isProcessAlive(999999)).toBe(false);
    } finally {
      kill.mockRestore();
    }
  });

  it("returns true on EPERM (process exists, no permission)", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("not permitted") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    });
    try {
      expect(isProcessAlive(999999)).toBe(true);
    } finally {
      kill.mockRestore();
    }
  });
});

describe("findRunningInstance", () => {
  it("returns data when the pid is alive, null when stale", () => {
    const path = tmpPath("server.lock");
    const data = { pid: process.pid, port: 1234, startedAt: "now" };
    writeLockfile(path, data);
    expect(findRunningInstance(path)).toEqual(data);
    const stale = { ...data, pid: 999999 };
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("no such process") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
    try {
      writeLockfile(path, stale);
      expect(findRunningInstance(path)).toBeNull();
    } finally {
      kill.mockRestore();
    }
  });
});

describe("acquireLockfile", () => {
  it("creates an exclusive placeholder when no lock exists", () => {
    const path = tmpPath("acquire.lock");
    expect(acquireLockfile(path)).toEqual({ ok: true });
    const created = readLockfile(path);
    expect(created?.pid).toBe(process.pid);
    expect(created?.port).toBe(0);
  });

  it("is idempotent-safe for repeated close via removeLockfile", () => {
    const path = tmpPath("acquire-remove.lock");
    expect(acquireLockfile(path)).toEqual({ ok: true });
    removeLockfile(path);
    expect(existsSync(path)).toBe(false);
  });

  it("refuses when a live instance holds the lock", () => {
    const path = tmpPath("acquire-held.lock");
    writeLockfile(path, { pid: process.pid, port: 42, startedAt: "now" });
    const result = acquireLockfile(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.heldBy?.port).toBe(42);
    expect(readLockfile(path)?.port).toBe(42);
  });

  it("overwrites a stale lock left by a dead process", () => {
    const path = tmpPath("acquire-stale.lock");
    writeLockfile(path, { pid: 999999, port: 42, startedAt: "now" });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("no such process") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
    try {
      expect(acquireLockfile(path)).toEqual({ ok: true });
      expect(readLockfile(path)?.pid).toBe(process.pid);
    } finally {
      kill.mockRestore();
    }
  });

  it("overwrites a corrupted lockfile", () => {
    const path = tmpPath("acquire-corrupt.lock");
    writeFileSync(path, "not json", "utf-8");
    expect(acquireLockfile(path)).toEqual({ ok: true });
    expect(readLockfile(path)?.pid).toBe(process.pid);
  });
});
