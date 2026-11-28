import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDataStore, FileWriteMutex, NodeFsPort, type ProjectRuntime } from "@spherse/core";
import { callMethod, createFakeProjectCtx, createRpcHarness, type RpcHarness } from "@spherse/rpc/testing";
import { contentMethods } from "@spherse/rpc/methods";
import { createSilentLoggerForTests } from "./test-logger.js";

interface ResultFrame {
  type: string;
  id: number;
  ok: boolean;
  data?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

let tmpDir: string;
let harness: RpcHarness;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "spherse-rpc-data-"));
  await fs.writeFile(path.join(tmpDir, "board.data.json"), JSON.stringify({ score: 1, nested: { hp: 80 } }));
  await fs.writeFile(path.join(tmpDir, "broken.data.json"), "{half");
  const dataStore = createDataStore({
    projectRoot: tmpDir,
    fsPort: new NodeFsPort(tmpDir),
    fileWriteMutex: new FileWriteMutex(),
    logger: createSilentLoggerForTests(),
  });
  harness = createRpcHarness({
    methods: contentMethods,
    projectCtx: createFakeProjectCtx({
      runtime: { dataStore } as unknown as ProjectRuntime,
    }),
  });
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function readOnDisk(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(tmpDir, file), "utf8"));
}

describe("data.read", () => {
  it("returns the value for a key lookup", async () => {
    const frame = (await callMethod(harness, "data.read", {
      projectId: "p1",
      file: "board.data.json",
      key: "score",
    })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toMatchObject({ value: 1 });
    expect((frame.data as { version: string }).version).toMatch(/^[0-9a-f]{64}$/);
  });

  it("supports dot-paths and reports unchanged for matching ifVersion", async () => {
    const first = (await callMethod(harness, "data.read", {
      projectId: "p1",
      file: "board.data.json",
      path: "nested",
    })) as ResultFrame;
    const version = (first.data as { version: string }).version;
    const same = (await callMethod(harness, "data.read", {
      projectId: "p1",
      file: "board.data.json",
      path: "nested",
      ifVersion: version,
    })) as ResultFrame;
    expect(same).toMatchObject({ type: "result", ok: true });
    expect((same.data as { unchanged?: boolean }).unchanged).toBe(true);
  });

  it("rejects schema violations with invalid params", async () => {
    const frame = (await callMethod(harness, "data.read", {
      projectId: "p1",
      file: 123,
      key: "a",
    })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
  });

  it("maps corrupted files to 422 file_corrupted", async () => {
    const frame = (await callMethod(harness, "data.read", {
      projectId: "p1",
      file: "broken.data.json",
      key: "a",
    })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: 422 } });
    expect(frame.error?.data).toMatchObject({ code: "file_corrupted" });
  });
});

describe("data.mutate", () => {
  it("runs manifest mutations with sdk origin", async () => {
    await fs.writeFile(
      path.join(tmpDir, "mut.data.json"),
      JSON.stringify({
        $manifest: {
          version: 1,
          mutations: {
            addItem: {
              op: "append",
              path: "items",
              fields: { title: { type: "string", required: true } },
              auto: { id: "uuid" },
            },
          },
        },
        items: [],
      }),
    );
    const frame = (await callMethod(harness, "data.mutate", {
      projectId: "p1",
      file: "mut.data.json",
      name: "addItem",
      args: { title: "x" },
    })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    const result = (frame.data as { result: { title: string; id: string } }).result;
    expect(result.title).toBe("x");
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readOnDisk("mut.data.json")).toMatchObject({ items: [{ title: "x" }] });
  });

  it("maps unknown entries to 404 with validNames and validation failures to 400", async () => {
    await fs.writeFile(
      path.join(tmpDir, "mut2.data.json"),
      JSON.stringify({
        $manifest: {
          version: 1,
          mutations: {
            addItem: { op: "append", path: "items", fields: { title: { type: "string", required: true } } },
          },
        },
        items: [],
      }),
    );
    const unknown = (await callMethod(harness, "data.mutate", {
      projectId: "p1",
      file: "mut2.data.json",
      name: "nope",
    })) as ResultFrame;
    expect(unknown).toMatchObject({ type: "result", ok: false, error: { code: 404 } });
    expect(unknown.error?.data).toMatchObject({ code: "unknown_entry", validNames: ["addItem"] });

    const invalid = (await callMethod(harness, "data.mutate", {
      projectId: "p1",
      file: "mut2.data.json",
      name: "addItem",
      args: {},
    })) as ResultFrame;
    expect(invalid).toMatchObject({ type: "result", ok: false, error: { code: 400 } });
    expect(invalid.error?.data).toMatchObject({ code: "validation_failed" });
  });

  it("dedupes retries that reuse an idempotencyKey", async () => {
    await fs.writeFile(
      path.join(tmpDir, "idem.data.json"),
      JSON.stringify({
        $manifest: {
          version: 1,
          mutations: {
            addItem: { op: "append", path: "items", fields: { title: { type: "string", required: true } } },
          },
        },
        items: [],
      }),
    );
    const params = {
      projectId: "p1",
      file: "idem.data.json",
      name: "addItem",
      args: { title: "once" },
      idempotencyKey: "k1",
    };
    const first = (await callMethod(harness, "data.mutate", params)) as ResultFrame;
    const second = (await callMethod(harness, "data.mutate", params)) as ResultFrame;
    expect(first).toMatchObject({ type: "result", ok: true });
    expect(second).toMatchObject({ type: "result", ok: true });
    expect((second.data as { result: unknown }).result).toEqual((first.data as { result: unknown }).result);
    expect(await readOnDisk("idem.data.json")).toMatchObject({ items: [{ title: "once" }] });
  });

  it("maps manifest staleness to 409 with validNames", async () => {
    await fs.writeFile(
      path.join(tmpDir, "stale.data.json"),
      JSON.stringify({
        $manifest: {
          version: 1,
          mutations: {
            addItem: { op: "append", path: "gone", fields: { title: { type: "string" } } },
          },
        },
        items: [],
      }),
    );
    const frame = (await callMethod(harness, "data.mutate", {
      projectId: "p1",
      file: "stale.data.json",
      name: "addItem",
      args: { title: "x" },
    })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: 409 } });
    expect(frame.error?.data).toMatchObject({ code: "manifest_stale", validNames: ["addItem"] });
  });
});

describe("data.rawSet", () => {
  it("creates files and rejects $ keys with 400 forbidden_key", async () => {
    const set = (await callMethod(harness, "data.rawSet", {
      projectId: "p1",
      file: "game.data.json",
      key: "score",
      value: 42,
    })) as ResultFrame;
    expect(set).toMatchObject({ type: "result", ok: true });
    expect(await readOnDisk("game.data.json")).toEqual({ score: 42 });

    const denied = (await callMethod(harness, "data.rawSet", {
      projectId: "p1",
      file: "game.data.json",
      key: "$manifest",
      value: {},
    })) as ResultFrame;
    expect(denied).toMatchObject({ type: "result", ok: false, error: { code: 400 } });
    expect(denied.error?.data).toMatchObject({ code: "forbidden_key" });
  });

  it("maps stale ifVersion to 409 version_conflict with currentVersion", async () => {
    const first = (await callMethod(harness, "data.read", {
      projectId: "p1",
      file: "game.data.json",
      key: "score",
    })) as ResultFrame;
    const staleVersion = (first.data as { version: string }).version;
    await callMethod(harness, "data.rawSet", {
      projectId: "p1",
      file: "game.data.json",
      key: "score",
      value: 43,
    });
    const conflict = (await callMethod(harness, "data.rawSet", {
      projectId: "p1",
      file: "game.data.json",
      key: "score",
      value: 44,
      ifVersion: staleVersion,
    })) as ResultFrame;
    expect(conflict).toMatchObject({ type: "result", ok: false, error: { code: 409 } });
    expect(conflict.error?.data).toMatchObject({ code: "version_conflict" });
    expect((conflict.error?.data as { currentVersion: string }).currentVersion).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("data.rawDelete", () => {
  it("removes keys from the document", async () => {
    await callMethod(harness, "data.rawSet", {
      projectId: "p1",
      file: "game.data.json",
      key: "temp",
      value: "x",
    });
    const del = (await callMethod(harness, "data.rawDelete", {
      projectId: "p1",
      file: "game.data.json",
      key: "temp",
    })) as ResultFrame;
    expect(del).toMatchObject({ type: "result", ok: true });
    expect(await readOnDisk("game.data.json")).not.toHaveProperty("temp");
  });
});

describe("data file name rules", () => {
  it("rejects .spherse paths and non-.data.json files with 400", async () => {
    const deniedPath = (await callMethod(harness, "data.rawSet", {
      projectId: "p1",
      file: ".spherse/secret.data.json",
      key: "a",
      value: 1,
    })) as ResultFrame;
    expect(deniedPath).toMatchObject({ type: "result", ok: false, error: { code: 400 } });

    const notDataFile = (await callMethod(harness, "data.read", {
      projectId: "p1",
      file: "notes.txt",
      key: "a",
    })) as ResultFrame;
    expect(notDataFile).toMatchObject({ type: "result", ok: false, error: { code: 400 } });
  });
});
