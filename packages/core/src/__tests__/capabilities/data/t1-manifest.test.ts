import { describe, expect, it } from "vitest";
import { checkManifestHealth, parseManifest, readManifestFromDoc } from "../../../capabilities/data/manifest.js";
import { getByDotPath, splitDotPath, stripReservedKeys } from "../../../capabilities/data/dot-path.js";
import { validateMutationArgs, validateQueryParams } from "../../../capabilities/data/validate.js";
import { DataValidationError } from "../../../capabilities/data/types.js";

describe("parseManifest", () => {
  it("parses a full manifest", () => {
    const m = parseManifest({
      version: 1,
      desc: "todo board",
      queries: {
        listTodos: { path: "todos", identity: "id", defaultLimit: 20, params: { status: { type: "enum", values: ["pending", "done"] } } },
      },
      mutations: {
        addTodo: { op: "append", path: "todos", fields: { title: { type: "string", required: true } }, auto: { id: "uuid", createdAt: "nowIso" } },
        removeTodo: { op: "remove", path: "todos", match: "id" },
      },
    });
    expect(m).not.toBeNull();
    expect(m!.queries.listTodos.identity).toBe("id");
    expect(m!.mutations.addTodo.op).toBe("append");
  });

  it("returns null for non-object or wrong version", () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest([])).toBeNull();
    expect(parseManifest("x")).toBeNull();
    expect(parseManifest({ version: 2, queries: {} })).toBeNull();
    expect(parseManifest({ queries: {} })).toBeNull();
  });

  it("tolerates missing queries/mutations", () => {
    const m = parseManifest({ version: 1 });
    expect(m).not.toBeNull();
    expect(m!.queries).toEqual({});
    expect(m!.mutations).toEqual({});
  });

  it("drops invalid entries instead of failing whole manifest", () => {
    const m = parseManifest({
      version: 1,
      queries: { good: { path: "todos" }, bad: { desc: "no path" } },
      mutations: { badop: { op: "delete", path: "todos" }, good: { op: "set", path: "stats" } },
    });
    expect(Object.keys(m!.queries)).toEqual(["good"]);
    expect(Object.keys(m!.mutations)).toEqual(["good"]);
  });

  it("reads manifest from doc", () => {
    expect(readManifestFromDoc({ todos: [] })).toBeNull();
    const doc = { $manifest: { version: 1 }, todos: [] };
    expect(readManifestFromDoc(doc)!.version).toBe(1);
  });
});

describe("checkManifestHealth", () => {
  const manifest = parseManifest({
    version: 1,
    queries: { listTodos: { path: "todos" }, listGone: { path: "gone" } },
    mutations: { addTodo: { op: "append", path: "todos" }, resetGone: { op: "set", path: "gone" } },
  })!;

  it("healthy when all paths resolve", () => {
    const h = checkManifestHealth({ todos: [], gone: 1 }, manifest);
    expect(h.status).toBe("healthy");
  });

  it("stale lists entries whose path is missing", () => {
    const h = checkManifestHealth({ todos: [] }, manifest);
    expect(h.status).toBe("stale");
    expect(h.staleQueries).toEqual(["listGone"]);
    expect(h.staleMutations).toEqual(["resetGone"]);
  });

  it("absent when no $manifest key, invalid when unparsable", () => {
    expect(checkManifestHealth({ todos: [] }, null).status).toBe("absent");
    expect(checkManifestHealth({ $manifest: "garbage" }, null).status).toBe("invalid");
  });
});

describe("dot-path", () => {
  const doc = { todos: [{ id: "a" }], stats: { hp: 80, mp: 50 }, $manifest: { version: 1 } };

  it("resolves nested paths", () => {
    expect(getByDotPath(doc, "stats.hp")).toEqual({ value: 80, missing: false });
    expect(getByDotPath(doc, "todos").missing).toBe(false);
  });

  it("missing for unknown / type-crossing paths", () => {
    expect(getByDotPath(doc, "nope").missing).toBe(true);
    expect(getByDotPath(doc, "stats.hp.deep").missing).toBe(true);
    expect(getByDotPath(doc, "todos.0").missing).toBe(true);
  });

  it("rejects $-prefixed segments", () => {
    expect(getByDotPath(doc, "$manifest").missing).toBe(true);
    expect(splitDotPath("a.$b")).toBeNull();
  });

  it("root path strips $ keys", () => {
    const r = getByDotPath(doc, ".");
    expect(r.missing).toBe(false);
    expect(Object.keys(r.value as object)).toEqual(["todos", "stats"]);
  });

  it("stripReservedKeys removes $ keys", () => {
    expect(stripReservedKeys({ $a: 1, b: 2, $$c: 3 })).toEqual({ b: 2 });
  });

  it("empty path returns null segments", () => {
    expect(splitDotPath(".")).toBeNull();
    expect(splitDotPath("a..b")).toEqual(["a", "b"]);
  });
});

describe("validateMutationArgs", () => {
  const base = {
    op: "append" as const,
    path: "todos",
    fields: {
      title: { type: "string" as const, required: true },
      priority: { type: "enum" as const, values: ["low", "high"], default: "low" },
      count: { type: "integer" as const },
    },
    auto: { id: "uuid" as const },
  };

  it("validates, applies defaults, rejects auto fields", () => {
    const { value } = validateMutationArgs(base, { title: "x", count: 2 });
    expect(value).toEqual({ title: "x", priority: "low", count: 2 });
    expect(() => validateMutationArgs(base, { title: "x", id: "self-made" })).toThrow(DataValidationError);
  });

  it("reports required missing / type errors / unknown fields", () => {
    expect(() => validateMutationArgs(base, {})).toThrow(/required field missing/);
    expect(() => validateMutationArgs(base, { title: 1 })).toThrow(/expected string/);
    expect(() => validateMutationArgs(base, { title: "x", count: 1.5 })).toThrow(/expected integer/);
    expect(() => validateMutationArgs(base, { title: "x", bogus: 1 })).toThrow(/unknown field/);
    expect(() => validateMutationArgs(base, { title: "x", priority: "mid" })).toThrow(/must be one of/);
  });

  it("validates match identity implicitly required", () => {
    const m = { ...base, op: "update" as const, match: "id", fields: { status: { type: "enum" as const, values: ["done"] } } };
    expect(() => validateMutationArgs(m, { status: "done" })).toThrow(/identity field "id" is required/);
    expect(() => validateMutationArgs(m, { id: true, status: "done" })).toThrow(/string or number/);
    expect(validateMutationArgs(m, { id: "a1", status: "done" }).value).toEqual({ status: "done", id: "a1" });
    const redeclared = { ...m, fields: { id: { type: "string" as const }, status: { type: "enum" as const, values: ["done"] } } };
    expect(() => validateMutationArgs(redeclared, { id: "a1", status: "done" })).toThrow(/must not be redeclared/);
  });
});

describe("validateQueryParams", () => {
  const query = {
    path: "todos",
    identity: "id",
    params: {
      status: { type: "enum" as const, values: ["pending", "done"] },
      sort: { type: "field" as const },
      n: { type: "integer" as const },
    },
  };

  it("accepts declared params and identity value", () => {
    const r = validateQueryParams(query, { status: "done", id: "a1", n: 3 });
    expect(r.values).toEqual({ status: "done", n: 3 });
    expect(r.identityValue).toBe("a1");
  });

  it("rejects unknown params and bad enum", () => {
    expect(() => validateQueryParams(query, { bogus: 1 })).toThrow(/unknown param/);
    expect(() => validateQueryParams(query, { status: "nope" })).toThrow(/must be one of/);
    expect(() => validateQueryParams(query, { id: true })).toThrow(/identity filter/);
  });
});
