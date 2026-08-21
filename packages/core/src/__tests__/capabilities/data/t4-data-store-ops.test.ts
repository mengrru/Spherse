import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDataStore } from "../../../capabilities/data/data-store.js";
import { FileWriteMutex } from "../../../utils/file-write-mutex.js";
import { createSilentLogger } from "../../../logger.js";
import {
  DataValidationError,
  ForbiddenKeyError,
  ManifestStaleError,
  UnknownEntryError,
  VersionConflictError,
  type DataChangeEvent,
} from "../../../capabilities/data/types.js";

let dir: string;
let store: ReturnType<typeof createDataStore>;
const events: DataChangeEvent[] = [];

const MANIFEST = {
  version: 1,
  queries: {
    listTodos: {
      path: "todos",
      identity: "id",
      defaultLimit: 2,
      params: {
        status: { type: "enum", values: ["pending", "done"] },
        sort: { type: "field" },
        dir: { type: "enum", values: ["asc", "desc"], default: "desc" },
      },
    },
    getStats: { path: "stats" },
  },
  mutations: {
    addTodo: {
      op: "append",
      path: "todos",
      fields: {
        title: { type: "string", required: true },
        status: { type: "enum", values: ["pending", "done"], default: "pending" },
        priority: { type: "enum", values: ["low", "high"], default: "low" },
      },
      auto: { id: "uuid", createdAt: "nowIso" },
    },
    setTodoStatus: {
      op: "update",
      path: "todos",
      match: "id",
      fields: { status: { type: "enum", values: ["pending", "done"], required: true } },
      auto: { updatedAt: "nowIso" },
    },
    removeTodo: { op: "remove", path: "todos", match: "id" },
    resetStats: { op: "set", path: "stats", fields: { hp: { type: "integer", required: true } } },
  },
};

const FILE = "board.data.json";
const abs = (f: string) => path.join(dir, f);

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "spdata-"));
  store = createDataStore({ projectRoot: dir, fileWriteMutex: new FileWriteMutex(), logger: createSilentLogger() });
  events.length = 0;
  store.onChange((e) => events.push(e));
  await fs.writeFile(abs(FILE), JSON.stringify({ $manifest: MANIFEST, todos: [], stats: { hp: 100 } }, null, 2));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("DataStore.outline / read", () => {
  it("outline includes structure + manifest signatures + healthy", async () => {
    const o = await store.outline(FILE);
    expect(o.health.status).toBe("healthy");
    expect(o.outline).toContain("todos: array[0]");
    expect(o.outline).toContain("$manifest: healthy");
    expect(o.outline).toContain("query: listTodos(id?, status?, sort?, dir?) → todos");
    expect(o.outline).toContain("mutation: addTodo(title!, status?, priority?) → append todos");
  });

  it("read without path/key returns outline text", async () => {
    const r = await store.read(FILE, {});
    expect(typeof r.value).toBe("string");
    expect(r.value).toContain("$manifest: healthy");
  });

  it("read by literal key (dots are not path separators)", async () => {
    await fs.writeFile(abs("dots.data.json"), JSON.stringify({ "user.name": "alice", real: { name: "bob" } }));
    const r = await store.read("dots.data.json", { key: "user.name" });
    expect(r.value).toBe("alice");
    await expect(store.read("dots.data.json", { key: "$manifest" })).rejects.toThrow(ForbiddenKeyError);
    const miss = await store.read("dots.data.json", { key: "nope" });
    expect(miss.value).toBeNull();
  });

  it('read path "." returns doc without $ keys; dot-path resolves', async () => {
    const root = await store.read(FILE, { path: "." });
    expect(Object.keys(root.value as object)).toEqual(["todos", "stats"]);
    const nested = await store.read(FILE, { path: "stats.hp" });
    expect(nested.value).toBe(100);
  });

  it("array reads are sliced by default with total and pagination note", async () => {
    for (const t of ["a", "b", "c"]) await store.mutate(FILE, "addTodo", { title: t });
    const all = await store.read(FILE, { path: "todos" });
    expect((all.value as unknown[]).length).toBe(3);
    expect(all.total).toBe(3);
    const r = await store.read(FILE, { path: "todos", limit: 2 });
    expect((r.value as unknown[]).length).toBe(2);
    expect(r.total).toBe(3);
    expect(r.note).toContain("offset=2");
    const r2 = await store.read(FILE, { path: "todos", offset: 2 });
    expect((r2.value as unknown[]).length).toBe(1);
  });

  it("ifVersion: unchanged short-circuit and conflict", async () => {
    const r1 = await store.read(FILE, { path: "stats" });
    const same = await store.read(FILE, { path: "stats", ifVersion: r1.version! });
    expect(same.unchanged).toBe(true);
    await store.rawSet(FILE, "extra", 1);
    await expect(store.read(FILE, { path: "stats", ifVersion: r1.version! })).rejects.toThrow(VersionConflictError);
  });

  it("corrupted file reported, not auto-repaired", async () => {
    await fs.writeFile(abs("bad.data.json"), "{half");
    await expect(store.outline("bad.data.json")).rejects.toThrow();
    await expect(store.read("bad.data.json", { path: "." })).rejects.toThrow();
  });
});

describe("DataStore.query", () => {
  it("runs manifest entry with filters/sort/cursor", async () => {
    for (const title of ["a", "b", "c"]) await store.mutate(FILE, "addTodo", { title });
    const all = await store.read(FILE, { path: "todos", limit: 10 });
    const rows = all.value as { id: string }[];
    await store.mutate(FILE, "setTodoStatus", { id: rows[1].id, status: "done" });

    const p1 = await store.query(FILE, "listTodos", { status: "pending", sort: "priority", dir: "asc" });
    expect(p1.total).toBe(2);
    expect((p1.value as { title: string }[]).map((r) => r.title)).toEqual(["a", "c"]);

    const single = await store.query(FILE, "listTodos", { id: rows[0].id });
    expect((single.value as { title: string }[]).map((r) => r.title)).toEqual(["a"]);
  });

  it("non-array path returns a note instead of a silent empty list", async () => {
    const r = await store.query(FILE, "getStats", {});
    expect(r.note).toContain("not an array");
  });

  it("unknown entry lists valid names; stale path detected on execution despite cached health", async () => {
    await expect(store.query(FILE, "nope", {})).rejects.toThrow(UnknownEntryError);
    await store.outline(FILE);
    const doc = JSON.parse(await fs.readFile(abs(FILE), "utf8"));
    delete doc.todos;
    doc.items = [];
    await fs.writeFile(abs(FILE), JSON.stringify(doc, null, 2));
    await expect(store.query(FILE, "listTodos", {})).rejects.toThrow(ManifestStaleError);
  });
});

describe("DataStore.mutate", () => {
  it("append: validates, applies defaults, generates auto fields, emits agent-origin event with summary", async () => {
    const r = await store.mutate(FILE, "addTodo", { title: "buy milk" });
    const row = r.result as Record<string, unknown>;
    expect(row.title).toBe("buy milk");
    expect(row.priority).toBe("low");
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(events).toEqual([
      { file: FILE, version: r.version, origin: "agent", summary: "addTodo" },
    ]);
  });

  it("mutate with origin 'sdk' emits sdk-origin events (same entry as page calls)", async () => {
    events.length = 0;
    const r = await store.mutate(FILE, "addTodo", { title: "from page" }, { origin: "sdk" });
    expect(events).toEqual([{ file: FILE, version: r.version, origin: "sdk", summary: "addTodo" }]);
    await store.mutate(FILE, "addTodo", { title: "from page again" });
    expect(events[events.length - 1].origin).toBe("agent");
  });

  it("append validation failures", async () => {
    await expect(store.mutate(FILE, "addTodo", {})).rejects.toThrow(DataValidationError);
    await expect(store.mutate(FILE, "addTodo", { title: "x", bogus: 1 })).rejects.toThrow(/unknown field/);
    await expect(store.mutate(FILE, "addTodo", { title: "x", id: "self" })).rejects.toThrow(/auto field/);
    await expect(store.mutate(FILE, "addTodo", { title: "x", priority: "mid" })).rejects.toThrow(/must be one of/);
  });

  it("update/remove: locate by match, report miss", async () => {
    const { result: row } = await store.mutate(FILE, "addTodo", { title: "t" });
    const id = (row as { id: string }).id;
    const up = await store.mutate(FILE, "setTodoStatus", { id, status: "done" });
    expect((up.result as { status: string }).status).toBe("done");
    await expect(store.mutate(FILE, "setTodoStatus", { id: "ghost", status: "done" })).rejects.toThrow(/no entry with/);
    const rm = await store.mutate(FILE, "removeTodo", { id });
    expect((rm.result as { id: string }).id).toBe(id);
    const after = await store.read(FILE, { path: "todos" });
    expect(after.total).toBe(0);
  });

  it("set: merges patch into target object", async () => {
    const r = await store.mutate(FILE, "resetStats", { hp: 55 });
    expect(r.result).toEqual({ hp: 55 });
    const stats = await store.read(FILE, { path: "stats" });
    expect(stats.value).toEqual({ hp: 55 });
  });

  it("set on a path holding an array replaces it with the patch object, not a spread array", async () => {
    await fs.writeFile(abs("arr.data.json"), JSON.stringify({ $manifest: { version: 1, mutations: { resetLog: { op: "set", path: "log", fields: { last: { type: "string", required: true } } } } }, log: ["a", "b"] }));
    const r = await store.mutate("arr.data.json", "resetLog", { last: "x" });
    expect(r.result).toEqual({ last: "x" });
    const log = await store.read("arr.data.json", { path: "log" });
    expect(log.value).toEqual({ last: "x" });
  });

  it("update applies auto fields", async () => {
    const { result: row } = await store.mutate(FILE, "addTodo", { title: "t" });
    const id = (row as { id: string }).id;
    const up = await store.mutate(FILE, "setTodoStatus", { id, status: "done" });
    expect((up.result as { updatedAt: unknown }).updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("idempotencyKey: concurrent retries with the same key apply only once", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.mutate(FILE, "addTodo", { title: "once" }, { idempotencyKey: "race-key" })),
    );
    const versions = new Set(results.map((r) => r.result as { id: string }).map((r) => r.id));
    expect(versions.size).toBe(1);
    const after = await store.read(FILE, { path: "todos" });
    expect(after.total).toBe(1);
  });

  it("idempotencyKey: retry returns same result without rewriting", async () => {
    const r1 = await store.mutate(FILE, "addTodo", { title: "milk" }, { idempotencyKey: "k1" });
    events.length = 0;
    const r2 = await store.mutate(FILE, "addTodo", { title: "milk" }, { idempotencyKey: "k1" });
    expect(r2).toEqual(r1);
    expect(events).toEqual([]);
    const after = await store.read(FILE, { path: "todos" });
    expect(after.total).toBe(1);
  });

  it("20 parallel appends all persist (no lost update)", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.mutate(FILE, "addTodo", { title: `t${i}` })));
    const after = await store.read(FILE, { path: "todos" });
    expect(after.total).toBe(20);
  });

  it("unknown mutation lists valid names", async () => {
    await expect(store.mutate(FILE, "nope", {})).rejects.toThrow(UnknownEntryError);
  });

  it("stale mutation path fails with ManifestStaleError", async () => {
    const doc = JSON.parse(await fs.readFile(abs(FILE), "utf8"));
    delete doc.todos;
    await fs.writeFile(abs(FILE), JSON.stringify(doc, null, 2));
    await expect(store.mutate(FILE, "addTodo", { title: "x" })).rejects.toThrow(ManifestStaleError);
  });
});
