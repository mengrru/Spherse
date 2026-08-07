import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import type { FastifyRequest } from "fastify";
import { registerAttachmentsRoutes } from "../routes/attachments.js";
import type { ProjectRegistry } from "../registry.js";

interface FakeProjectManager {
  getRootPath: () => string;
  getFileWriteMutex: () => { run: (absPath: string, fn: () => Promise<void>) => Promise<void> };
}

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { projectManager: FakeProjectManager };
  }
}

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

function buildMultipart(
  fields: Array<{ name: string; value: string | Buffer; filename?: string; contentType?: string }>,
  boundary = "----spherse-test-boundary",
): { body: Buffer; contentType: string } {
  const parts: Buffer[] = [];
  for (const f of fields) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"`;
    if (f.filename) header += `; filename="${f.filename}"`;
    header += "\r\n";
    if (f.contentType) header += `Content-Type: ${f.contentType}\r\n`;
    header += "\r\n";
    parts.push(Buffer.from(header));
    parts.push(Buffer.isBuffer(f.value) ? f.value : Buffer.from(f.value));
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("attachments routes", () => {
  let tmpDir: string;
  let app: Fastify.FastifyInstance;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-attachments-"));
    app = Fastify();
    await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = {
        projectManager: {
          getRootPath: () => tmpDir,
          getFileWriteMutex: () => ({ run: (_abs, fn) => fn() }),
        },
      };
    });
    registerAttachmentsRoutes(app, {} as ProjectRegistry);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uploads a valid image and writes it under .spherse/attachments", async () => {
    const { body, contentType } = buildMultipart([
      { name: "width", value: "1" },
      { name: "height", value: "1" },
      { name: "file", value: PNG_BYTES, filename: "test.png", contentType: "image/png" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/attachments",
      headers: { "content-type": contentType, "content-length": String(body.length) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.type).toBe("image");
    expect(json.path).toMatch(/^\.spherse\/attachments\/\d+-[0-9a-f]{8}\.png$/);
    expect(json.bytes).toBe(PNG_BYTES.length);
    expect(json.width).toBe(1);
    expect(json.height).toBe(1);
    const written = fs.readFileSync(path.join(tmpDir, json.path));
    expect(written.equals(PNG_BYTES)).toBe(true);
  });

  it("rejects a non-image mimeType", async () => {
    const { body, contentType } = buildMultipart([
      { name: "file", value: Buffer.from("plain"), filename: "t.txt", contentType: "text/plain" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/attachments",
      headers: { "content-type": contentType, "content-length": String(body.length) },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an upload exceeding the size limit", async () => {
    const tooLarge = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
    const { body, contentType } = buildMultipart([
      { name: "file", value: tooLarge, filename: "big.png", contentType: "image/png" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/attachments",
      headers: { "content-type": contentType, "content-length": String(body.length) },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an upload with no file part", async () => {
    const { body, contentType } = buildMultipart([{ name: "width", value: "10" }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/attachments",
      headers: { "content-type": contentType, "content-length": String(body.length) },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it("deletes an uploaded file", async () => {
    const { body, contentType } = buildMultipart([
      { name: "file", value: PNG_BYTES, filename: "del.png", contentType: "image/png" },
    ]);
    const up = await app.inject({
      method: "POST",
      url: "/api/projects/p1/attachments",
      headers: { "content-type": contentType, "content-length": String(body.length) },
      payload: body,
    });
    expect(up.statusCode).toBe(200);
    const { path: rel } = up.json();
    expect(fs.existsSync(path.join(tmpDir, rel))).toBe(true);

    const del = await app.inject({
      method: "DELETE",
      url: "/api/projects/p1/attachments",
      payload: { path: rel },
    });
    expect(del.statusCode).toBe(200);
    expect(fs.existsSync(path.join(tmpDir, rel))).toBe(false);
  });

  it("returns ok when deleting a missing file", async () => {
    const del = await app.inject({
      method: "DELETE",
      url: "/api/projects/p1/attachments",
      payload: { path: ".spherse/attachments/never-existed.png" },
    });
    expect(del.statusCode).toBe(200);
  });

  it("rejects deleting a path outside the attachments directory", async () => {
    const del = await app.inject({
      method: "DELETE",
      url: "/api/projects/p1/attachments",
      payload: { path: ".spherse/generated-images/x.png" },
    });
    expect(del.statusCode).toBe(403);
  });

  it("rejects deleting a path outside the project root", async () => {
    const outside = path.join(os.tmpdir(), "outside-spherse.png");
    fs.writeFileSync(outside, Buffer.from("x"));
    try {
      const del = await app.inject({
        method: "DELETE",
        url: "/api/projects/p1/attachments",
        payload: { path: outside },
      });
      expect(del.statusCode).toBe(403);
    } finally {
      fs.unlinkSync(outside);
    }
  });

  it("rejects deleting with a missing path field", async () => {
    const del = await app.inject({
      method: "DELETE",
      url: "/api/projects/p1/attachments",
      payload: {},
    });
    expect(del.statusCode).toBe(400);
  });
});
