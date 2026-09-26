import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  MemoryStore,
  MAX_CORE_CHARS,
  MAX_ENTRY_CONTENT_CHARS,
  DB_FILE,
  CORE_FILE,
  MEMORY_DIR,
} from "../../store/memory.js";

describe("MemoryStore", () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-memory-"));
    store = new MemoryStore(dir);
  });
  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("core memory", () => {
    it("returns empty core when file missing", async () => {
      expect(await store.getCore()).toBe("");
    });

    it("saves and reads core content", async () => {
      await store.saveCore("user prefers concise answers");
      expect(await store.getCore()).toBe("user prefers concise answers");
      expect(fs.existsSync(path.join(dir, MEMORY_DIR, CORE_FILE))).toBe(true);
    });

    it("rejects core content over the limit", async () => {
      await expect(store.saveCore("x".repeat(MAX_CORE_CHARS + 1))).rejects.toThrow(/core memory exceeds/);
      expect(await store.getCore()).toBe("");
    });

    it("appends with newline separation and enforces the limit", async () => {
      await store.appendCore("first fact");
      const next = await store.appendCore("second fact");
      expect(next).toBe("first fact\nsecond fact");
      expect(await store.getCore()).toBe("first fact\nsecond fact");

      await expect(store.appendCore("x".repeat(MAX_CORE_CHARS))).rejects.toThrow(/core memory exceeds/);
      await expect(store.appendCore("   ")).rejects.toThrow(/must not be empty/);
    });
  });

  describe("entries", () => {
    it("starts empty", () => {
      expect(store.list()).toEqual([]);
      expect(store.count()).toBe(0);
    });

    it("saves, updates and deletes entries", () => {
      const entry = store.save("user lives in Hangzhou", ["location"]);
      expect(entry.content).toBe("user lives in Hangzhou");
      expect(store.count()).toBe(1);

      const updated = store.update(entry.id, { content: "user moved to Shanghai", tags: [] });
      expect(updated.content).toBe("user moved to Shanghai");
      expect(updated.tags).toBeUndefined();
      expect(updated.updatedAt).toBeGreaterThanOrEqual(entry.createdAt);

      store.deleteEntry(entry.id);
      expect(store.count()).toBe(0);
      expect(() => store.deleteEntry(entry.id)).toThrow(/not found/);
      expect(() => store.update(entry.id, { content: "x" })).toThrow(/not found/);
    });

    it("validates content and tags", () => {
      expect(() => store.save("   ")).toThrow(/must not be empty/);
      expect(() => store.save("x".repeat(MAX_ENTRY_CONTENT_CHARS + 1))).toThrow(/exceeds/);
      expect(() => store.save("ok", ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"])).toThrow(/at most 8/);
      expect(() => store.save("ok", ["x".repeat(25)])).toThrow(/tag exceeds/);
      expect(store.save("ok", [" a ", "a", ""])).toMatchObject({ tags: ["a"] });
    });

    it("lists by recency and persists across reopen", () => {
      const a = store.save("first");
      const b = store.save("second");
      expect(store.list().map((e) => e.id)).toEqual([b.id, a.id]);

      store.close();
      const reopened = new MemoryStore(dir);
      expect(reopened.count()).toBe(2);
      expect(reopened.list().map((e) => e.content)).toContain("first");
      reopened.close();
    });
  });

  describe("search", () => {
    beforeEach(() => {
      store.save("The kingdom lies east of the river", ["geography"]);
      store.save("Hero fears heights", ["character"]);
      store.save("用户偏好暗色主题", ["偏好", "界面"]);
      store.save("项目的名字是星辰", ["项目"]);
    });

    it("matches english phrases via fts", () => {
      expect(store.search("kingdom").map((e) => e.content)).toEqual(["The kingdom lies east of the river"]);
      expect(store.search("lies east").map((e) => e.content)).toEqual(["The kingdom lies east of the river"]);
      expect(store.search("nothing")).toEqual([]);
    });

    it("matches chinese substrings via fts", () => {
      expect(store.search("暗色主题").map((e) => e.content)).toEqual(["用户偏好暗色主题"]);
      expect(store.search("星辰").map((e) => e.content)).toEqual(["项目的名字是星辰"]);
    });

    it("matches by tags", () => {
      expect(store.search("geography").map((e) => e.content)).toEqual(["The kingdom lies east of the river"]);
      expect(store.search("偏好").map((e) => e.content)).toEqual(["用户偏好暗色主题"]);
    });

    it("falls back to LIKE for short queries and escapes wildcards", () => {
      expect(store.search("项").map((e) => e.content)).toEqual(["项目的名字是星辰"]);
      store.save("100% done");
      expect(store.search("00").map((e) => e.content)).toEqual(["100% done"]);
      expect(store.search("0_")).toEqual([]);
    });

    it("empty query lists by recency", () => {
      expect(store.search("  ")).toHaveLength(4);
    });
  });

  describe("corruption recovery", () => {
    it("isolates an unreadable db and recreates empty", () => {
      store.close();
      const dbPath = path.join(dir, MEMORY_DIR, DB_FILE);
      fs.writeFileSync(dbPath, "this is not a sqlite database at all........");
      const recovered = new MemoryStore(dir);
      expect(recovered.count()).toBe(0);
      recovered.save("fresh entry");
      expect(recovered.count()).toBe(1);
      const backups = fs.readdirSync(path.join(dir, MEMORY_DIR)).filter((f) => f.startsWith(`${DB_FILE}.corrupt-`));
      expect(backups).toHaveLength(1);
      recovered.close();
    });
  });

  describe("core write serialization", () => {
    it("serializes concurrent append and replace", async () => {
      await Promise.all([
        store.appendCore("line one"),
        store.saveCore("replaced everything"),
        store.appendCore("line two"),
      ]);
      const core = await store.getCore();
      expect(["replaced everything\nline two", "line two"]).toContain(core);
    });
  });
});
