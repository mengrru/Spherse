import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { VersionConflictError, NodeFsPort, type ProjectManager, type ProjectRuntime } from "@spherse/core";
import { contentMethods } from "@spherse/rpc/methods";
import {
  createFakeProjectCtx,
  createRpcHarness,
  flush,
  UNKNOWN_PROJECT_ID,
  type RpcHarness,
} from "@spherse/rpc/testing";

interface ResultFrame {
  type: string;
  id: number;
  ok: boolean;
  data?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const dataStore = {
  read: vi.fn(),
  mutate: vi.fn(),
  rawSet: vi.fn(),
  rawDelete: vi.fn(),
};

let projectRoot: string;
let harness: RpcHarness;
let nextId = 1;

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await flush();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function call(method: string, params: unknown): Promise<ResultFrame> {
  const id = nextId++;
  harness.receive({ type: "call", id, method, params });
  const deadline = Date.now() + 2000;
  let frame = (harness.sent() as ResultFrame[]).find((f) => f.id === id);
  while (!frame && Date.now() < deadline) {
    await settle();
    frame = (harness.sent() as ResultFrame[]).find((f) => f.id === id);
  }
  if (!frame) throw new Error(`rpc frame not received for ${method}`);
  return frame;
}

beforeAll(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rpc-content-"));
  await fs.writeFile(path.join(projectRoot, "notes.md"), "hello world", "utf-8");
  await fs.writeFile(
    path.join(projectRoot, "doc.pdf"),
    Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35, 0x00, 0x0a]),
  );
  await fs.writeFile(path.join(projectRoot, "empty.txt"), "", "utf-8");
  await fs.mkdir(path.join(projectRoot, "dir", "nested"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "dir", "a.md"), "a", "utf-8");
  await fs.writeFile(path.join(projectRoot, "dir", "nested", "b.md"), "b", "utf-8");
  await fs.mkdir(path.join(projectRoot, ".git"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".git", "skip.js"), "x", "utf-8");
  await fs.mkdir(path.join(projectRoot, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "node_modules", "pkg", "i.js"), "x", "utf-8");

  dataStore.read.mockResolvedValue({ version: "v1", value: { hp: 100 } });
  dataStore.mutate.mockResolvedValue({ version: "v2", result: { done: true } });
  dataStore.rawSet.mockResolvedValue({ version: "v3" });
  dataStore.rawDelete.mockResolvedValue({ version: "v4" });

  const projectManager = {
    getRootPath: () => projectRoot,
    getFsPort: () => new NodeFsPort(projectRoot),
    writeFile: vi.fn(),
    createEntry: vi.fn(),
    deletePath: vi.fn(),
  } as unknown as ProjectManager;

  harness = createRpcHarness({
    methods: contentMethods,
    projectCtx: createFakeProjectCtx({
      projectManager,
      runtime: { dataStore } as unknown as ProjectRuntime,
    }),
  });
});

afterAll(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

describe("rpc content methods", () => {
  it("content.stat returns file stats", async () => {
    const frame = await call("content.stat", { projectId: "p1", path: "notes.md" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toMatchObject({ size: 11, isDirectory: false });
    expect(typeof (frame.data as { mtime: number }).mtime).toBe("number");
  });

  it("content.read returns file content", async () => {
    const frame = await call("content.read", { projectId: "p1", path: "notes.md" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ content: "hello world", path: "notes.md", binary: false });
  });

  it("content.read returns empty content with binary true for a binary file", async () => {
    const frame = await call("content.read", { projectId: "p1", path: "doc.pdf" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ content: "", path: "doc.pdf", binary: true });
  });

  it("content.read returns binary false for an empty text file", async () => {
    const frame = await call("content.read", { projectId: "p1", path: "empty.txt" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ content: "", path: "empty.txt", binary: false });
  });

  it("content.list returns directory entries", async () => {
    const frame = await call("content.list", { projectId: "p1", path: "dir" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    const entries = frame.data as Array<{ name: string; type: string }>;
    expect([...entries].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "a.md", type: "file" },
      { name: "nested", type: "directory" },
    ]);
  });

  it("content.save writes through projectManager", async () => {
    const frame = await call("content.save", {
      projectId: "p1",
      path: "notes.md",
      content: "hi",
    });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ ok: true });
    expect(harness.known.projectManager.writeFile).toHaveBeenCalledWith("notes.md", "hi");
  });

  it("content.delete removes through projectManager", async () => {
    const frame = await call("content.delete", { projectId: "p1", path: "dir" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ ok: true });
    expect(harness.known.projectManager.deletePath).toHaveBeenCalledWith("dir");
  });

  it("content.mkdir creates an entry with mkdir action", async () => {
    const frame = await call("content.mkdir", { projectId: "p1", path: "a/b" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ ok: true });
    expect(harness.known.projectManager.createEntry).toHaveBeenCalledWith("a/b", "mkdir");
  });

  it("content.touch creates an entry with touch action", async () => {
    const frame = await call("content.touch", { projectId: "p1", path: "x.md" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ ok: true });
    expect(harness.known.projectManager.createEntry).toHaveBeenCalledWith("x.md", "touch");
  });

  it("content.stat returns directory stats", async () => {
    const frame = await call("content.stat", { projectId: "p1", path: "dir" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    const data = frame.data as { size: number; mtime: number; isDirectory: boolean };
    expect(data.isDirectory).toBe(true);
    expect(typeof data.size).toBe("number");
    expect(typeof data.mtime).toBe("number");
  });

  it("content.fileTree walks files and skips ignored dirs", async () => {
    const frame = await call("content.fileTree", { projectId: "p1" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    const files = frame.data as string[];
    expect([...files].sort()).toEqual(["dir/a.md", "dir/nested/b.md", "doc.pdf", "empty.txt", "notes.md"]);
  });

  it("data.read forwards filters to the data store", async () => {
    const frame = await call("data.read", {
      projectId: "p1",
      file: "todos",
      key: "a1",
      limit: 5,
    });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ version: "v1", value: { hp: 100 } });
    expect(dataStore.read).toHaveBeenCalledWith("todos", { key: "a1", limit: 5 });
  });

  it("data.mutate invokes mutation with sdk origin", async () => {
    const frame = await call("data.mutate", {
      projectId: "p1",
      file: "todos",
      name: "add",
      args: { x: 1 },
      idempotencyKey: "k1",
    });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ version: "v2", result: { done: true } });
    expect(dataStore.mutate).toHaveBeenCalledWith(
      "todos",
      "add",
      { x: 1 },
      { origin: "sdk", idempotencyKey: "k1" },
    );
  });

  it("data.rawSet writes raw values with optimistic version", async () => {
    const frame = await call("data.rawSet", {
      projectId: "p1",
      file: "todos",
      key: "a1",
      value: 42,
      ifVersion: "12345678",
    });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ version: "v3" });
    expect(dataStore.rawSet).toHaveBeenCalledWith("todos", "a1", 42, { ifVersion: "12345678" });
  });

  it("data.rawDelete removes raw keys", async () => {
    const frame = await call("data.rawDelete", {
      projectId: "p1",
      file: "todos",
      key: "a1",
    });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ version: "v4" });
    expect(dataStore.rawDelete).toHaveBeenCalledWith("todos", "a1", {});
  });
});

describe("rpc content method error mapping", () => {
  it("maps unknown project to app error 100", async () => {
    const frame = await call("content.stat", {
      projectId: UNKNOWN_PROJECT_ID,
      path: "notes.md",
    });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: 100, message: "Unknown project" },
    });
  });

  it("rejects invalid params with -32602", async () => {
    const missing = await call("content.stat", { projectId: "p1" });
    expect(missing).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
    const outOfRange = await call("data.read", {
      projectId: "p1",
      file: "todos",
      limit: 0,
    });
    expect(outOfRange).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
  });

  it("maps missing paths in stat to app error 100", async () => {
    const frame = await call("content.stat", { projectId: "p1", path: "does-not-exist.txt" });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: 100 } });
  });

  it("maps AccessDeniedError to app error 101", async () => {
    const frame = await call("content.read", {
      projectId: "p1",
      path: ".spherse/agents/a/profile.md",
    });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: 101 } });
  });

  it("maps denied paths in stat to app error 101", async () => {
    const frame = await call("content.stat", { projectId: "p1", path: ".spherse" });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: 101 } });
  });

  it("maps missing file to 100 with file_not_found code", async () => {
    const frame = await call("content.read", { projectId: "p1", path: "nope.md" });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: 100 } });
    expect((frame.error?.data as { code: string }).code).toBe("file_not_found");
  });

  it("maps data version conflicts to 409 with structured payload", async () => {
    dataStore.mutate.mockRejectedValueOnce(new VersionConflictError("v99"));
    const frame = await call("data.mutate", {
      projectId: "p1",
      file: "todos",
      name: "add",
    });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: 409 } });
    expect(frame.error?.data).toEqual({ code: "version_conflict", currentVersion: "v99" });
  });
});
