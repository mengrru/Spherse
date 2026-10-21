import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { registerDownloadRoutes } from "../routes/download.js";
import type { FastifyRequest } from "fastify";
import type { ProjectRegistry } from "../registry.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { projectManager: { getRootPath: () => string } };
  }
}

describe("download route", () => {
  let tmpDir: string;
  let app: Fastify.FastifyInstance;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-download-"));
    fs.writeFileSync(path.join(tmpDir, "data.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff]));
    fs.writeFileSync(path.join(tmpDir, "report.pdf"), Buffer.from([0x25, 0x50, 0x44, 0x46]));
    fs.writeFileSync(path.join(tmpDir, "设计 文档 v1.zip"), Buffer.from([0x50, 0x4b]));
    fs.writeFileSync(path.join(tmpDir, "empty.bin"), Buffer.alloc(0));
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".git", "config"), "[core]");
    fs.mkdirSync(path.join(tmpDir, "packages", "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "packages", "node_modules", "pkg", "index.js"), "x");
    fs.mkdirSync(path.join(tmpDir, ".spherse"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".spherse", "sessions.db"), "db");
    fs.mkdirSync(path.join(tmpDir, "assets"), { recursive: true });

    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { projectManager: { getRootPath: () => tmpDir } };
    });
    registerDownloadRoutes(app, {} as ProjectRegistry);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("streams original bytes as an attachment with content-length", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/download/data.bin" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["content-length"]).toBe("4");
    expect(Buffer.from(res.rawPayload).equals(Buffer.from([0x00, 0x01, 0x02, 0xff]))).toBe(true);
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="data.bin"; filename*=UTF-8\'\'data.bin',
    );
  });

  it("serves files rejected by the preview extension whitelist", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/download/report.pdf" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
  });

  it("encodes non-ascii and spaced filenames in Content-Disposition", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/p1/download/${encodeURIComponent("设计 文档 v1.zip")}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="__ __ v1.zip"; filename*=UTF-8''${encodeURIComponent("设计 文档 v1.zip")}`,
    );
  });

  it("serves an empty file with content-length 0", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/download/empty.bin" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-length"]).toBe("0");
    expect(res.rawPayload.length).toBe(0);
  });

  it("returns 404 for a missing file", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/download/missing.bin" });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for a directory", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/download/assets" });
    expect(res.statusCode).toBe(404);
  });

  it("rejects path traversal outside the project", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/p1/download/${encodeURIComponent("../secrets.txt")}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects protected paths blocked by the server access policy", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/download/.spherse/sessions.db" });
    expect(res.statusCode).toBe(403);
  });

  it("rejects .git paths including nested segments", async () => {
    const top = await app.inject({ method: "GET", url: "/api/projects/p1/download/.git/config" });
    expect(top.statusCode).toBe(403);
  });

  it("rejects .git and node_modules with backslash separators", async () => {
    const git = await app.inject({
      method: "GET",
      url: `/api/projects/p1/download/${encodeURIComponent(".git\\config")}`,
    });
    expect(git.statusCode).toBe(403);

    const nm = await app.inject({
      method: "GET",
      url: `/api/projects/p1/download/${encodeURIComponent("packages\\node_modules\\pkg\\index.js")}`,
    });
    expect(nm.statusCode).toBe(403);
  });

  it("rejects blocked segments case-insensitively", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/download/.GIT/config" });
    expect(res.statusCode).toBe(403);
  });

  it("rejects node_modules paths including nested segments", async () => {
    const nested = await app.inject({
      method: "GET",
      url: "/api/projects/p1/download/packages/node_modules/pkg/index.js",
    });
    expect(nested.statusCode).toBe(403);
  });
});
