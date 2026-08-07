import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { registerContentRoutes } from "../routes/content.js";
import type { ProjectRegistry } from "../registry.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { projectManager: { getRootPath: () => string } };
  }
}

describe("content route", () => {
  let tmpDir: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-content-"));
    fs.writeFileSync(path.join(tmpDir, "notes.txt"), "hello world");
    // %PDF-1.5 header containing a null byte → detected as binary
    fs.writeFileSync(
      path.join(tmpDir, "doc.pdf"),
      Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35, 0x00, 0x0a]),
    );
    fs.writeFileSync(path.join(tmpDir, "empty.txt"), "");
    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { projectManager: { getRootPath: () => tmpDir } };
    });
    registerContentRoutes(app, {} as ProjectRegistry);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns text content with binary:false for a text file", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/content/notes.txt" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.content).toBe("hello world");
    expect(body.binary).toBe(false);
  });

  it("returns empty content with binary:true for a binary file", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/content/doc.pdf" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.content).toBe("");
    expect(body.binary).toBe(true);
  });

  it("returns binary:false (not undefined) for an empty text file", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/content/empty.txt" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.content).toBe("");
    expect(body.binary).toBe(false);
  });

  it("lists directory entries (binary sniff only applies to files)", async () => {
    fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/content/sub" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
  });
});
