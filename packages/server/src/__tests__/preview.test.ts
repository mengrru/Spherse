import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { registerPreviewRoutes } from "../routes/preview.js";
import type { FastifyRequest } from "fastify";
import type { ProjectRegistry } from "../registry.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { projectManager: { getRootPath: () => string } };
  }
}

describe("preview route", () => {
  let tmpDir: string;
  let app: Fastify.FastifyInstance;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-preview-"));
    fs.writeFileSync(path.join(tmpDir, "icon.svg"), "<svg></svg>");
    fs.writeFileSync(path.join(tmpDir, "pic.png"), Buffer.from([0x89, 0x50]));
    fs.writeFileSync(path.join(tmpDir, "style.css"), "body{}");
    fs.writeFileSync(path.join(tmpDir, "font.woff2"), Buffer.from([0x00]));

    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { projectManager: { getRootPath: () => tmpDir } };
    });
    registerPreviewRoutes(app, {} as ProjectRegistry);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("serves an svg with correct content-type and no-store cache header", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/preview/icon.svg" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/svg+xml");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toBe("<svg></svg>");
  });

  it("serves a png with no-store cache header", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/preview/pic.png" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("applies no-store to css and font assets too", async () => {
    const css = await app.inject({ method: "GET", url: "/api/projects/p1/preview/style.css" });
    expect(css.statusCode).toBe(200);
    expect(css.headers["cache-control"]).toBe("no-store");

    const font = await app.inject({ method: "GET", url: "/api/projects/p1/preview/font.woff2" });
    expect(font.statusCode).toBe(200);
    expect(font.headers["cache-control"]).toBe("no-store");
  });

  it("ignores the cache-bust version query param", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/preview/icon.svg?v=3" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("<svg></svg>");
  });

  it("rejects disallowed extensions", async () => {
    fs.writeFileSync(path.join(tmpDir, "notes.txt"), "hi");
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/preview/notes.txt" });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 for a missing allowed file", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/preview/missing.svg" });
    expect(res.statusCode).toBe(404);
  });
});
