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

  it("serves an svg with correct content-type and no-cache cache header", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/preview/icon.svg" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/svg+xml");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers.etag).toMatch(/^"\d+-\d+(\.\d+)?"$/);
  });

  it("serves a png with no-cache cache header", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/preview/pic.png" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers.etag).toMatch(/^"\d+-\d+(\.\d+)?"$/);
  });

  it("applies no-cache to css and font assets too", async () => {
    const css = await app.inject({ method: "GET", url: "/api/projects/p1/preview/style.css" });
    expect(css.statusCode).toBe(200);
    expect(css.headers["cache-control"]).toBe("no-cache");
    expect(css.headers.etag).toMatch(/^"\d+-\d+(\.\d+)?"$/);

    const font = await app.inject({ method: "GET", url: "/api/projects/p1/preview/font.woff2" });
    expect(font.statusCode).toBe(200);
    expect(font.headers["cache-control"]).toBe("no-cache");
    expect(font.headers.etag).toMatch(/^"\d+-\d+(\.\d+)?"$/);
  });

  it("returns 304 when If-None-Match matches the current etag and omits the body", async () => {
    const first = await app.inject({ method: "GET", url: "/api/projects/p1/preview/icon.svg" });
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();

    const revalidate = await app.inject({
      method: "GET",
      url: "/api/projects/p1/preview/icon.svg",
      headers: { "if-none-match": etag! },
    });
    expect(revalidate.statusCode).toBe(304);
    expect(revalidate.headers["cache-control"]).toBe("no-cache");
    expect(revalidate.headers.etag).toBe(etag);
    expect(revalidate.body).toBe("");
  });

  it("returns 200 with a new etag after the file is modified", async () => {
    const iconPath = path.join(tmpDir, "icon.svg");
    const original = fs.readFileSync(iconPath, "utf8");

    const first = await app.inject({ method: "GET", url: "/api/projects/p1/preview/icon.svg" });
    const oldEtag = first.headers.etag;

    fs.writeFileSync(iconPath, "<svg>updated</svg>");

    const second = await app.inject({
      method: "GET",
      url: "/api/projects/p1/preview/icon.svg",
      headers: { "if-none-match": oldEtag! },
    });
    expect(second.statusCode).toBe(200);
    expect(second.headers.etag).not.toBe(oldEtag);
    expect(second.body).toBe("<svg>updated</svg>");

    fs.writeFileSync(iconPath, original);
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

  it("serves a file via __auth/<token>/ path prefix and resolves the correct underlying file", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/p1/preview/__auth/some-token/icon.svg",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/svg+xml");
    expect(res.body).toBe("<svg></svg>");
  });

  it("supports nested directories through the __auth/ path prefix", async () => {
    fs.mkdirSync(path.join(tmpDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "assets", "nested.png"), Buffer.from([0x89, 0x50]));
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/p1/preview/__auth/some-token/assets/nested.png",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
  });

  it("serves the SDK bundle at the reserved filename with javascript content-type", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/preview/__spherse-sdk.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/javascript");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.body).toContain("window.spherse");
  });

  it("serves the SDK bundle at the reserved filename under __auth/ prefix and nested dirs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/p1/preview/__auth/some-token/sub/__spherse-sdk.js",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/javascript");
    expect(res.body).toContain("window.spherse");
  });

  it("injects the SDK script tag into served HTML", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "card.html"),
      "<html><head><title>x</title></head><body>hi</body></html>",
    );
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/preview/card.html" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html");
    expect(res.body).toContain('<script src="__spherse-sdk.js" data-spherse-sdk></script>');
    // script goes into <head>, before existing content
    expect(res.body.indexOf("data-spherse-sdk")).toBeLessThan(res.body.indexOf("<title>"));
  });

  it("does not double-inject HTML that already carries the SDK marker", async () => {
    const pre = '<html><head><script src="x.js" data-spherse-sdk></script></head><body>hi</body></html>';
    fs.writeFileSync(path.join(tmpDir, "marked.html"), pre);
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/preview/marked.html" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(pre);
  });

  it("leaves non-HTML assets untouched (no SDK injection)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/preview/icon.svg" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("data-spherse-sdk");
  });
});
