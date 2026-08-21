import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dataCapability } from "../../../capabilities/data/capability.js";
import { createDataStore } from "../../../capabilities/data/data-store.js";
import { FileWriteMutex } from "../../../utils/file-write-mutex.js";
import { createSilentLogger } from "../../../logger.js";
import type { ToolHost } from "../../../kernel/ports.js";

let dir: string;
let mutex: FileWriteMutex;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "spdata-"));
  mutex = new FileWriteMutex();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const MANIFEST = {
  version: 1,
  queries: { listTodos: { path: "todos", identity: "id" } },
  mutations: { addTodo: { op: "append", path: "todos", fields: { title: { type: "string", required: true } }, auto: { id: "uuid" } } },
};

function makeHost(): ToolHost {
  return {
    agentId: "a1",
    sessionId: "s1",
    profile: {} as ToolHost["profile"],
    projectRoot: dir,
    projectStore: {
      getRootPath: () => dir,
      config: { getAiAccessSettings: () => ({ deniedPaths: [] }) },
    } as unknown as ToolHost["projectStore"],
    fileWriteMutex: mutex,
    logger: createSilentLogger(),
    stores: { register: () => {}, get: () => undefined, forAgent: () => ({}), clearAgent: () => {} },
    pathRules: [],
    toolCatalog: { names: [] },
  };
}

function getTool(host: ToolHost, name: string) {
  const tools = dataCapability().tools!(host);
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool as { name: string; execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; details?: unknown }> };
}

describe("dataCapability assembly", () => {
  it("registers 3 tools", () => {
    const tools = dataCapability().tools!(makeHost());
    expect(tools.map((t) => t.name).sort()).toEqual(["mutate_data", "query_data", "read_data"]);
  });

  it("uses the shared DataStore instance (same mutex semantics across calls)", async () => {
    const shared = createDataStore({ projectRoot: dir, fileWriteMutex: mutex, logger: createSilentLogger() });
    const host = makeHost();
    const tools = dataCapability(shared).tools!(host);
    const mutate = tools.find((t) => t.name === "mutate_data") as ReturnType<typeof getTool>;
    await fs.writeFile(path.join(dir, "board.data.json"), JSON.stringify({ $manifest: MANIFEST, todos: [] }));
    const r = await mutate.execute("t1", { file: "board.data.json", name: "addTodo", args: { title: "x" } });
    expect(r.content[0].text).toContain("title");
    const doc = JSON.parse(await fs.readFile(path.join(dir, "board.data.json"), "utf8"));
    expect(doc.todos).toHaveLength(1);
  });
});

describe("data tools behavior", () => {
  beforeEach(async () => {
    await fs.writeFile(
      path.join(dir, "board.data.json"),
      JSON.stringify({ $manifest: MANIFEST, todos: [{ id: "e1", title: "exist" }] }),
    );
  });

  it("read_data outline and local read", async () => {
    const host = makeHost();
    const o = await getTool(host, "read_data").execute("t1", { file: "board.data.json" });
    expect(o.content[0].text).toContain("$manifest: healthy");
    expect(o.content[0].text).toContain("mutation: addTodo(title!) → append todos");
    const local = await getTool(host, "read_data").execute("t2", { file: "board.data.json", path: "todos" });
    expect(local.content[0].text).toContain("exist");
  });

  it("query_data happy path and unknown entry error", async () => {
    const host = makeHost();
    const q = await getTool(host, "query_data").execute("t1", { file: "board.data.json", name: "listTodos" });
    expect(q.content[0].text).toContain("exist");
    const bad = await getTool(host, "query_data").execute("t2", { file: "board.data.json", name: "nope" });
    expect(bad.content[0].text).toContain("unknown query entry");
    expect(bad.content[0].text).toContain("listTodos");
  });

  it("mutate_data validation error surfaces field details", async () => {
    const host = makeHost();
    const r = await getTool(host, "mutate_data").execute("t1", { file: "board.data.json", name: "addTodo", args: {} });
    expect(r.content[0].text).toContain("title: required field missing");
  });

  it("path guard rejects non-.data.json and .spherse", async () => {
    const host = makeHost();
    const r1 = await getTool(host, "read_data").execute("t1", { file: "notes.txt" });
    expect(r1.content[0].text).toMatch(/must end with|Error/);
    const r2 = await getTool(host, "read_data").execute("t2", { file: ".spherse/secret.data.json" });
    expect(r2.content[0].text).toMatch(/\.spherse|Error/);
  });

  it("denylisted path is denied via policy", async () => {
    const host = makeHost();
    const hostDenied: ToolHost = {
      ...host,
      projectStore: {
        getRootPath: () => dir,
        config: { getAiAccessSettings: () => ({ deniedPaths: ["board.data.json"] }) },
      } as unknown as ToolHost["projectStore"],
    };
    const r = await getTool(hostDenied, "read_data").execute("t1", { file: "board.data.json" });
    expect(r.details).toMatchObject({ path: "board.data.json", denied: true });
    const w = await getTool(hostDenied, "mutate_data").execute("t2", { file: "board.data.json", name: "addTodo", args: { title: "x" } });
    expect(w.details).toMatchObject({ path: "board.data.json", denied: true });
    const doc = JSON.parse(await fs.readFile(path.join(dir, "board.data.json"), "utf8"));
    expect(doc.todos).toHaveLength(1);
  });
});
