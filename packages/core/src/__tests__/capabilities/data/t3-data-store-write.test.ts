import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDataStore } from "../../../capabilities/data/data-store.js";
import { FileWriteMutex } from "../../../utils/file-write-mutex.js";
import { createSilentLogger } from "../../../logger.js";
import {
  DataFileCorruptedError,
  ForbiddenKeyError,
  VersionConflictError,
  type DataChangeEvent,
} from "../../../capabilities/data/types.js";

let dir: string;
let store: ReturnType<typeof createDataStore>;
let mutex: FileWriteMutex;
const events: DataChangeEvent[] = [];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "spdata-"));
  mutex = new FileWriteMutex();
  store = createDataStore({ projectRoot: dir, fileWriteMutex: mutex, logger: createSilentLogger() });
  events.length = 0;
  store.onChange((e) => events.push(e));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const FILE = "game.data.json";
const abs = (f: string) => path.join(dir, f);

describe("DataStore rawSet/rawDelete", () => {
  it("creates file atomically and emits sdk-origin event", async () => {
    const r = await store.rawSet(FILE, "score", 42);
    expect(r.version).toMatch(/^[0-9a-f]{64}$/);
    const onDisk = JSON.parse(await fs.readFile(abs(FILE), "utf8"));
    expect(onDisk).toEqual({ score: 42 });
    expect(events).toEqual([{ file: FILE, version: r.version, origin: "sdk" }]);
    expect(await fs.readdir(dir)).not.toContain(".game.data.json.spdata.tmp");
  });

  it("no-op write returns same version and emits no event", async () => {
    const r1 = await store.rawSet(FILE, "score", 1);
    events.length = 0;
    const r2 = await store.rawSet(FILE, "score", 1);
    expect(r2.version).toBe(r1.version);
    expect(events).toEqual([]);
  });

  it("rejects $-prefixed keys", async () => {
    await expect(store.rawSet(FILE, "$manifest", {})).rejects.toThrow(ForbiddenKeyError);
  });

  it("ifVersion optimistic lock: match and conflict", async () => {
    const r1 = await store.rawSet(FILE, "a", 1);
    const ok = await store.rawSet(FILE, "b", 2, { ifVersion: r1.version });
    expect(ok.version).not.toBe(r1.version);
    await expect(store.rawSet(FILE, "c", 3, { ifVersion: r1.version })).rejects.toThrow(VersionConflictError);
  });

  it("delete is idempotent for missing keys", async () => {
    await store.rawSet(FILE, "a", 1);
    const r = await store.rawDelete(FILE, "nope");
    expect(r.version).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(await fs.readFile(abs(FILE), "utf8"))).toEqual({ a: 1 });
    await store.rawDelete(FILE, "a");
    expect(JSON.parse(await fs.readFile(abs(FILE), "utf8"))).toEqual({});
  });

  it("rejects non-.data.json files and .spherse paths", async () => {
    await expect(store.rawSet("game.json", "a", 1)).rejects.toThrow(/must end with/);
    await expect(store.rawSet(".spherse/x.data.json", "a", 1)).rejects.toThrow(/\.spherse/);
    await expect(store.rawSet("../outside.data.json", "a", 1)).rejects.toThrow();
  });

  it("reports corrupted files instead of resetting", async () => {
    await fs.writeFile(abs(FILE), "{broken json");
    await expect(store.rawSet(FILE, "a", 1)).rejects.toThrow(DataFileCorruptedError);
  });

  it("rethrows non-ENOENT read errors instead of treating as new file", async () => {
    await store.rawSet(FILE, "a", 1);
    await fs.chmod(abs(FILE), 0o000);
    try {
      await expect(store.rawSet(FILE, "b", 2)).rejects.toThrow(/EACCES/);
    } finally {
      await fs.chmod(abs(FILE), 0o644);
    }
    const doc = JSON.parse(await fs.readFile(abs(FILE), "utf8"));
    expect(doc).toEqual({ a: 1 });
  });

  it("ifVersion conflict also applies when the file is missing", async () => {
    const stale = "0".repeat(64);
    await expect(store.rawSet("brand-new.data.json", "a", 1, { ifVersion: stale })).rejects.toThrow(VersionConflictError);
  });

  it("change handlers may write the same file without deadlock (events emitted after lock release)", async () => {
    await store.rawSet(FILE, "a", 1);
    let reentrations = 0;
    const off = store.onChange(async (e) => {
      if (e.origin === "sdk" && reentrations === 0) {
        reentrations++;
        await store.rawSet(FILE, "notified", true);
      }
    });
    try {
      await store.rawSet(FILE, "b", 2);
      expect(reentrations).toBe(1);
      let doc: Record<string, unknown> = {};
      for (let i = 0; i < 50; i++) {
        doc = JSON.parse(await fs.readFile(abs(FILE), "utf8"));
        if (doc.notified === true) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(doc).toEqual({ a: 1, b: 2, notified: true });
    } finally {
      off();
    }
  });

  it("tmp file leftover is cleaned up by next write", async () => {
    await fs.writeFile(abs(".game.data.json.spdata.tmp"), "garbage");
    await store.rawSet(FILE, "a", 1);
    expect(await fs.readdir(dir)).not.toContain(".game.data.json.spdata.tmp");
  });
});

describe("DataStore concurrency", () => {
  it("50 parallel writes on distinct keys lose nothing", async () => {
    await store.rawSet(FILE, "count", 0);
    events.length = 0;
    const parallelSets = Array.from({ length: 50 }, (_, i) => store.rawSet(FILE, `k${i}`, i));
    await Promise.all(parallelSets);
    const doc = JSON.parse(await fs.readFile(abs(FILE), "utf8"));
    for (let i = 0; i < 50; i++) expect(doc[`k${i}`]).toBe(i);
    expect(events.length).toBe(50);
  });

  it("shares the mutex with write-style file operations on the same path", async () => {
    await store.rawSet(FILE, "a", 1);
    const order: string[] = [];
    await Promise.all([
      mutex.run(abs(FILE), async () => {
        order.push("op-start");
        await new Promise((r) => setTimeout(r, 20));
        order.push("op-end");
      }),
      (async () => {
        await new Promise((r) => setTimeout(r, 5));
        await store.rawSet(FILE, "b", 2);
        order.push("store-write");
      })(),
    ]);
    expect(order.indexOf("store-write")).toBeGreaterThan(order.indexOf("op-end"));
  });
});
