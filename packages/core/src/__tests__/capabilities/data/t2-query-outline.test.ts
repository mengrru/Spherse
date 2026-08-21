import { describe, expect, it } from "vitest";
import { decodeCursor, runQuery } from "../../../capabilities/data/query-engine.js";
import { buildOutline, formatEntrySignature } from "../../../capabilities/data/outline.js";
import { OutlineCache } from "../../../capabilities/data/outline-cache.js";
import { parseManifest } from "../../../capabilities/data/manifest.js";
import { DataValidationError } from "../../../capabilities/data/types.js";

const manifest = parseManifest({
  version: 1,
  queries: {
    listTodos: {
      path: "todos",
      identity: "id",
      defaultLimit: 3,
      params: {
        status: { type: "enum", values: ["pending", "done"] },
        sort: { type: "field" },
        dir: { type: "enum", values: ["asc", "desc"], default: "desc" },
      },
    },
    listNoIdentity: { path: "logs" },
  },
})!;

function todo(id: string, status: string, priority: number) {
  return { id, status, priority, title: `t-${id}` };
}

const doc = {
  todos: [todo("a", "pending", 2), todo("b", "done", 1), todo("c", "pending", 3), todo("d", "done", 2), todo("e", "pending", 1)],
  logs: ["l1", "l2"],
};

describe("runQuery", () => {
  it("filters by enum and paginates by cursor without overlap", () => {
    const p1 = runQuery(doc, manifest.queries.listTodos, { status: "pending" }, { limit: 2 });
    expect(p1.value.map((r: { id: string }) => r.id)).toEqual(["a", "c"]);
    expect(p1.total).toBe(3);
    expect(p1.nextAfter).toBeDefined();

    const disturbed = {
      todos: [todo("z", "pending", 9), ...doc.todos, todo("w", "pending", 9)],
    };
    const p2 = runQuery(disturbed, manifest.queries.listTodos, { status: "pending" }, { limit: 2, after: p1.nextAfter! });
    expect(p2.value.map((r: { id: string }) => r.id)).toEqual(["e", "w"]);
  });

  it("sorts by field with dir", () => {
    const r = runQuery(doc, manifest.queries.listTodos, { sort: "priority", dir: "asc" }, { limit: 10 });
    expect(r.value.map((r: { priority: number }) => r.priority)).toEqual([1, 1, 2, 2, 3]);
  });

  it("identity implicit single lookup", () => {
    const r = runQuery(doc, manifest.queries.listTodos, { id: "b" });
    expect(r.value).toEqual([todo("b", "done", 1)]);
    const miss = runQuery(doc, manifest.queries.listTodos, { id: "nope" });
    expect(miss.value).toEqual([]);
  });

  it("degrades to offset pagination without identity", () => {
    const r = runQuery(doc, manifest.queries.listNoIdentity, {}, { limit: 1, offset: 1 });
    expect(r.pagination).toBe("offset-drift");
    expect(r.value).toEqual(["l2"]);
  });

  it("applies defaultLimit from manifest", () => {
    const r = runQuery(doc, manifest.queries.listTodos, {});
    expect(r.count).toBe(3);
  });

  it("clamps limit to 100", () => {
    const r = runQuery({ logs: Array.from({ length: 200 }, (_, i) => `l${i}`) }, manifest.queries.listNoIdentity, {}, { limit: 999 });
    expect(r.count).toBe(100);
  });

  it("truncates oversized items with annotation", () => {
    const big = { logs: [{ blob: "x".repeat(5 * 1024), id: "big1" }] };
    const r = runQuery(big, manifest.queries.listNoIdentity, {});
    expect(r.truncatedItems).toEqual([0]);
    expect((r.value[0] as { _truncated: boolean })._truncated).toBe(true);
  });

  it("rejects invalid params", () => {
    expect(() => runQuery(doc, manifest.queries.listTodos, { status: "bogus" })).toThrow(DataValidationError);
    expect(() => runQuery(doc, manifest.queries.listTodos, { bogus: 1 })).toThrow(DataValidationError);
  });

  it("returns empty for missing or non-array path", () => {
    const q = { ...manifest.queries.listTodos, path: "nope" };
    expect(runQuery(doc, q, {}).value).toEqual([]);
    const q2 = { ...manifest.queries.listTodos, path: "stats" };
    expect(runQuery({ stats: { hp: 1 } }, q2, {}).value).toEqual([]);
  });

  it("cursor decode roundtrip and invalid cursor yields empty", () => {
    expect(decodeCursor(Buffer.from("a", "utf8").toString("base64"))).toBe("a");
    expect(decodeCursor("!!!not-base64!!!")).toBeNull();
    const r = runQuery(doc, manifest.queries.listTodos, {}, { after: "!!!not-base64!!!" });
    expect(r.value).toEqual([]);
  });
});

describe("outline", () => {
  it("builds structure with enums, excludes $ keys, includes manifest signatures", () => {
    const m = parseManifest({
      version: 1,
      queries: { listTodos: { path: "todos", identity: "id", params: { status: { type: "enum", values: ["pending", "done"] } } } },
      mutations: {
        addTodo: { op: "append", path: "todos", fields: { title: { type: "string", required: true }, priority: { type: "enum", values: ["low"], default: "low" } }, auto: { id: "uuid" } },
        removeTodo: { op: "remove", path: "todos", match: "id" },
      },
    })!;
    const outline = buildOutline(
      { $manifest: { version: 1 }, todos: doc.todos, stats: { hp: 80, mp: 50, history: [1, 2, 3] } },
      { file: "todos.data.json", version: "abcdef1234567890", sizeBytes: 312000, manifest: m, health: { status: "healthy", staleQueries: [], staleMutations: [] } },
    );
    expect(outline).toContain("$outline of todos.data.json");
    expect(outline).toContain("- todos: array[5] of object");
    expect(outline).toContain("enums: status: pending|done");
    expect(outline).not.toContain("enums: id");
    expect(outline).toContain("- stats: object { hp: integer, mp: integer, history: array[3] of integer }");
    expect(outline).toContain("$manifest: healthy");
    expect(outline).toContain("query: listTodos(id?, status?) → todos");
    expect(outline).toContain("mutation: addTodo(title!, priority?) → append todos");
    expect(outline).toContain("mutation: removeTodo(id!) → remove todos");
    expect(outline).not.toContain("$manifest: object");
  });

  it("marks stale entries and absent manifest", () => {
    const o1 = buildOutline({ todos: [] }, { file: "f.data.json", version: "v", sizeBytes: 1, manifest: null, health: { status: "absent", staleQueries: [], staleMutations: [] } });
    expect(o1).toContain("$manifest: absent");
    const m = parseManifest({ version: 1, queries: { gone: { path: "nope" } }, mutations: {} })!;
    const o2 = buildOutline({}, { file: "f.data.json", version: "v", sizeBytes: 1, manifest: m, health: { status: "stale", staleQueries: ["gone"], staleMutations: [] } });
    expect(o2).toContain("[STALE: path missing]");
  });

  it("truncates oversized outline", () => {
    const big = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`key${i}`, { a: 1 }]));
    const o = buildOutline(big, { file: "f.data.json", version: "v", sizeBytes: 1, manifest: null, health: { status: "absent", staleQueries: [], staleMutations: [] } });
    expect(o.length).toBeLessThanOrEqual(4100);
    expect(o).toContain("outline truncated");
  });

  it("formatEntrySignature renders required marker", () => {
    const m = parseManifest({ version: 1, mutations: { up: { op: "update", path: "t", match: "id", fields: { s: { type: "string", required: true } } } } })!;
    expect(formatEntrySignature("mutation", "up", m.mutations.up)).toBe("  mutation: up(id!, s!) → update t");
  });
});

describe("OutlineCache", () => {
  it("hits by version, invalidates file, evicts LRU", () => {
    const c = new OutlineCache(2);
    c.set("/a", "v1", "o1");
    expect(c.get("/a", "v1")).toBe("o1");
    expect(c.get("/a", "v2")).toBeUndefined();
    c.set("/a", "v2", "o2");
    c.set("/b", "v1", "o3");
    c.set("/c", "v1", "o4");
    expect(c.get("/a", "v1")).toBeUndefined();
    c.invalidateFile("/c");
    expect(c.get("/c", "v1")).toBeUndefined();
  });
});
