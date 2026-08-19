import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { createProject, type ProjectRuntime, type Logger } from "@spherse/core";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
};
import { registerContentRoutes } from "../routes/content.js";
import { registerImagesRoutes } from "../routes/images.js";
import { registerAttachmentsRoutes } from "../routes/attachments.js";
import multipart from "@fastify/multipart";
import type { ProjectRegistry } from "../registry.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { projectManager: import("@spherse/core").ProjectManager };
  }
}

describe("write facade contract: real ProjectManager through real routes", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime;
  let pm: import("@spherse/core").ProjectManager;
  let app: FastifyInstance;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-facade-contract-"));
    runtime = await createProject(tmpDir, { projectName: "Contract", logger: silentLogger });
    pm = runtime.projectManager;

    app = Fastify();
    await app.register(multipart, { limits: { fileSize: 1024 * 1024 } });
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { projectManager: pm };
    });
    registerContentRoutes(app, {} as ProjectRegistry);
    registerImagesRoutes(app, {} as ProjectRegistry);
    registerAttachmentsRoutes(app, {} as ProjectRegistry);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    runtime.timerService.stop();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("content PUT writeFile: user files are writable through the real facade", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/projects/p1/content/chapters/one.md",
      payload: { content: "# One" },
    });
    expect(res.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(tmpDir, "chapters/one.md"), "utf-8")).toBe("# One");
  });

  it("content POST createEntry: mkdir and touch work through the real facade", async () => {
    const mkdir = await app.inject({
      method: "POST",
      url: "/api/projects/p1/content/newdir",
      payload: { action: "mkdir" },
    });
    expect(mkdir.statusCode).toBe(200);
    expect(fs.statSync(path.join(tmpDir, "newdir")).isDirectory()).toBe(true);

    const touch = await app.inject({
      method: "POST",
      url: "/api/projects/p1/content/newdir/f.md",
      payload: { action: "touch" },
    });
    expect(touch.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(tmpDir, "newdir/f.md"), "utf-8")).toBe("");
  });

  it("content POST createEntry conflict maps to 409", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/content/newdir/f.md",
      payload: { action: "touch" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("content DELETE deletePath: removes entries through the real facade; missing is ok", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/projects/p1/content/newdir/f.md",
    });
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(path.join(tmpDir, "newdir/f.md"))).toBe(false);

    const missing = await app.inject({
      method: "DELETE",
      url: "/api/projects/p1/content/never-there.md",
    });
    expect(missing.statusCode).toBe(200);
  });

  it("content PUT still denies engine-internal paths via real policy (403)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/projects/p1/content/.spherse/project.yaml",
      payload: { content: "id: hacked" },
    });
    expect(res.statusCode).toBe(403);
    expect(fs.readFileSync(path.join(tmpDir, ".spherse/project.yaml"), "utf-8")).not.toContain("hacked");
  });

  it("attachments upload writeBinaryFile: attachments dir passes real SRV_WRITE (C1 seam)", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const boundary = "----contract";
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/attachments",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { path: string };
    expect(fs.existsSync(path.join(tmpDir, json.path))).toBe(true);
  });

  it("attachments delete deletePath: uploaded file removable through real facade", async () => {
    const target = ".spherse/attachments/c.png";
    const res = await app.inject({
      method: "DELETE",
      url: "/api/projects/p1/attachments",
      payload: { path: target },
    });
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(path.join(tmpDir, target))).toBe(false);
  });

  it("images export copyFileWithin: copies via real facade with policy", async () => {
    fs.mkdirSync(path.join(tmpDir, ".spherse/generated-images"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".spherse/generated-images/x.png"), Buffer.from([1, 2, 3]));
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/images/export",
      payload: { src: ".spherse/generated-images/x.png", dest: path.join(tmpDir, "export/x.png") },
    });
    expect(res.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(tmpDir, "export/x.png"))).toEqual(Buffer.from([1, 2, 3]));
  });

  it("images export copyFileWithin denies escaping the project root (403)", async () => {
    const escape = path.join(os.tmpdir(), "spherse-facade-escape.png");
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/images/export",
      payload: { src: ".spherse/generated-images/x.png", dest: escape },
    });
    expect(res.statusCode).toBe(403);
    expect(fs.existsSync(escape)).toBe(false);
  });
});
