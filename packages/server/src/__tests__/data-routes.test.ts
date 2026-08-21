import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { createDataStore } from "@spherse/core";
import { FileWriteMutex } from "@spherse/core";
import { registerDataRoutes } from "../routes/data.js";
import type { ProjectRegistry } from "../registry.js";
import { createSilentLoggerForTests } from "./test-logger.js";

function makeRegistry(root: string): ProjectRegistry {
  const dataStore = createDataStore({
    projectRoot: root,
    fileWriteMutex: new FileWriteMutex(),
    logger: createSilentLoggerForTests(),
  });
  return { get: () => ({ runtime: { dataStore } }) } as unknown as ProjectRegistry;
}

describe("data routes", () => {
  let tmpDir: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-data-"));
    fs.writeFileSync(path.join(tmpDir, "board.data.json"), JSON.stringify({ score: 1, nested: { hp: 80 } }));
    fs.writeFileSync(path.join(tmpDir, "broken.data.json"), "{half");
    app = Fastify();
    registerDataRoutes(app, makeRegistry(tmpDir));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("read: key lookup returns value", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/read",
      payload: { file: "board.data.json", key: "score" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ value: 1 });
    expect(JSON.parse(res.body).version).toMatch(/^[0-9a-f]{64}$/);
  });

  it("read: dot-path and unchanged ifVersion", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/read",
      payload: { file: "board.data.json", path: "nested" },
    });
    const version = JSON.parse(first.body).version;
    const same = await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/read",
      payload: { file: "board.data.json", path: "nested", ifVersion: version },
    });
    expect(same.statusCode).toBe(200);
    expect(JSON.parse(same.body).unchanged).toBe(true);
  });

  it("read: 400 on schema violation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/read",
      payload: { file: 123 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("read: corrupted file maps to 422 file_corrupted", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/read",
      payload: { file: "broken.data.json", key: "a" },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe("file_corrupted");
  });

  it("mutate: runs manifest mutation with sdk origin", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "mut.data.json"),
      JSON.stringify({
        $manifest: { version: 1, mutations: { addItem: { op: "append", path: "items", fields: { title: { type: "string", required: true } }, auto: { id: "uuid" } } } },
        items: [],
      }),
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/mutate",
      payload: { file: "mut.data.json", name: "addItem", args: { title: "x" } },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.result.title).toBe("x");
    expect(body.result.id).toMatch(/^[0-9a-f-]{36}$/);
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "mut.data.json"), "utf8"));
    expect(onDisk.items).toHaveLength(1);
  });

  it("mutate: unknown entry maps to 404 with validNames; validation error to 400", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "mut2.data.json"),
      JSON.stringify({
        $manifest: { version: 1, mutations: { addItem: { op: "append", path: "items", fields: { title: { type: "string", required: true } } } } },
        items: [],
      }),
    );
    const unknown = await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/mutate",
      payload: { file: "mut2.data.json", name: "nope" },
    });
    expect(unknown.statusCode).toBe(404);
    expect(JSON.parse(unknown.body).validNames).toEqual(["addItem"]);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/mutate",
      payload: { file: "mut2.data.json", name: "addItem", args: {} },
    });
    expect(invalid.statusCode).toBe(400);
    expect(JSON.parse(invalid.body).code).toBe("validation_failed");
  });

  it("mutate: idempotencyKey dedupes retries at route level", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "idem.data.json"),
      JSON.stringify({
        $manifest: { version: 1, mutations: { addItem: { op: "append", path: "items", fields: { title: { type: "string", required: true } } } } },
        items: [],
      }),
    );
    const payload = { file: "idem.data.json", name: "addItem", args: { title: "once" }, idempotencyKey: "k1" };
    const first = await app.inject({ method: "POST", url: "/api/projects/p1/data/mutate", payload });
    const second = await app.inject({ method: "POST", url: "/api/projects/p1/data/mutate", payload });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const r1 = JSON.parse(first.body).result as { title: string };
    const r2 = JSON.parse(second.body).result as { title: string };
    expect(r1).toEqual(r2);
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "idem.data.json"), "utf8"));
    expect(onDisk.items).toHaveLength(1);
  });

  it("mutate: manifest_stale maps to 409 with validNames", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "stale.data.json"),
      JSON.stringify({
        $manifest: { version: 1, mutations: { addItem: { op: "append", path: "gone", fields: { title: { type: "string" } } } } },
        items: [],
      }),
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/mutate",
      payload: { file: "stale.data.json", name: "addItem", args: { title: "x" } },
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("manifest_stale");
    expect(body.validNames).toEqual(["addItem"]);
  });

  it("raw-set creates and updates; rejects $ keys with 400", async () => {
    const set = await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/raw-set",
      payload: { file: "game.data.json", key: "score", value: 42 },
    });
    expect(set.statusCode).toBe(200);
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "game.data.json"), "utf8"));
    expect(onDisk).toEqual({ score: 42 });

    const denied = await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/raw-set",
      payload: { file: "game.data.json", key: "$manifest", value: {} },
    });
    expect(denied.statusCode).toBe(400);
    expect(JSON.parse(denied.body).code).toBe("forbidden_key");
  });

  it("raw-set: version conflict maps to 409 with currentVersion", async () => {
    const v1 = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/projects/p1/data/read",
          payload: { file: "game.data.json", key: "score" },
        })
      ).body,
    ).version;
    await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/raw-set",
      payload: { file: "game.data.json", key: "score", value: 43 },
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/raw-set",
      payload: { file: "game.data.json", key: "score", value: 44, ifVersion: v1 },
    });
    expect(conflict.statusCode).toBe(409);
    const body = JSON.parse(conflict.body);
    expect(body.code).toBe("version_conflict");
    expect(body.currentVersion).toMatch(/^[0-9a-f]{64}$/);
  });

  it("raw-delete removes keys", async () => {
    await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/raw-set",
      payload: { file: "game.data.json", key: "temp", value: "x" },
    });
    const del = await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/raw-delete",
      payload: { file: "game.data.json", key: "temp" },
    });
    expect(del.statusCode).toBe(200);
    const doc = JSON.parse(fs.readFileSync(path.join(tmpDir, "game.data.json"), "utf8"));
    expect(doc.temp).toBeUndefined();
  });

  it("rejects .spherse paths and non-.data.json files with 400", async () => {
    const res1 = await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/raw-set",
      payload: { file: ".spherse/secret.data.json", key: "a", value: 1 },
    });
    expect(res1.statusCode).toBe(400);
    const res2 = await app.inject({
      method: "POST",
      url: "/api/projects/p1/data/read",
      payload: { file: "notes.txt", key: "a" },
    });
    expect(res2.statusCode).toBe(400);
  });
});
