import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { createProject, type ProjectRuntime, type Logger } from "@spherse/core";
import multipart from "@fastify/multipart";
import { registerUploadRoutes, dedupeFileName } from "../routes/upload.js";
import type { ProjectRegistry } from "../registry.js";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { projectManager: import("@spherse/core").ProjectManager };
  }
}

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

describe("dedupeFileName", () => {
  it("returns the original name when there is no conflict", () => {
    expect(dedupeFileName(new Set(["b.txt"]), "a.txt")).toBe("a.txt");
  });

  it("appends a counter on conflict, keeping the extension", () => {
    expect(dedupeFileName(new Set(["a.txt"]), "a.txt")).toBe("a (1).txt");
    expect(dedupeFileName(new Set(["a.txt", "a (1).txt"]), "a.txt")).toBe("a (2).txt");
  });

  it("handles files without extension and dotfiles", () => {
    expect(dedupeFileName(new Set(["README"]), "README")).toBe("README (1)");
    expect(dedupeFileName(new Set([".env"]), ".env")).toBe(".env (1)");
  });

  it("compares case-insensitively to avoid silent overwrite on case-insensitive fs", () => {
    expect(dedupeFileName(new Set(["A.TXT"]), "a.txt")).toBe("a (1).txt");
  });
});

describe("upload routes (real ProjectManager)", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime;
  let app: FastifyInstance;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-upload-"));
    runtime = await createProject(tmpDir, { projectName: "Upload", logger: silentLogger });

    app = Fastify();
    await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { projectManager: runtime.projectManager };
    });
    registerUploadRoutes(app, {} as ProjectRegistry);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    runtime.timerService.stop();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function injectUpload(dirPath: string, filename: string, content: Buffer) {
    const { body, contentType } = buildMultipart([
      { name: "file", value: content, filename, contentType: "application/octet-stream" },
    ]);
    return app.inject({
      method: "POST",
      url: `/api/projects/p1/upload/${dirPath.split("/").map(encodeURIComponent).join("/")}`,
      headers: { "content-type": contentType },
      payload: body,
    });
  }

  it("uploads a file to the project root", async () => {
    const content = Buffer.from("hello upload");
    const res = await injectUpload("", "hello.txt", content);
    expect(res.statusCode).toBe(200);
    const json = res.json() as { path: string; bytes: number; renamed: boolean };
    expect(json).toEqual({ path: "hello.txt", bytes: content.byteLength, renamed: false });
    expect(fs.readFileSync(path.join(tmpDir, "hello.txt"))).toEqual(content);
  });

  it("uploads a file into a subdirectory", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"));
    const res = await injectUpload("docs", "guide.md", Buffer.from("# Guide"));
    expect(res.statusCode).toBe(200);
    const json = res.json() as { path: string; renamed: boolean };
    expect(json.path).toBe("docs/guide.md");
    expect(json.renamed).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, "docs/guide.md"), "utf-8")).toBe("# Guide");
  });

  it("auto-renames on name conflict and reports renamed", async () => {
    const first = await injectUpload("", "note.txt", Buffer.from("one"));
    expect((first.json() as { renamed: boolean }).renamed).toBe(false);

    const second = await injectUpload("", "note.txt", Buffer.from("two"));
    expect(second.statusCode).toBe(200);
    const json = second.json() as { path: string; renamed: boolean };
    expect(json.path).toBe("note (1).txt");
    expect(json.renamed).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "note.txt"), "utf-8")).toBe("one");
    expect(fs.readFileSync(path.join(tmpDir, "note (1).txt"), "utf-8")).toBe("two");

    const third = await injectUpload("", "note.txt", Buffer.from("three"));
    expect((third.json() as { path: string }).path).toBe("note (2).txt");
  });

  it("auto-renames files without extension", async () => {
    await injectUpload("", "LICENSE", Buffer.from("x"));
    const res = await injectUpload("", "LICENSE", Buffer.from("y"));
    expect((res.json() as { path: string }).path).toBe("LICENSE (1)");
  });

  it("treats case-insensitive collisions as conflicts", async () => {
    await injectUpload("", "Report.PDF", Buffer.from("original"));
    const res = await injectUpload("", "report.pdf", Buffer.from("copy"));
    expect((res.json() as { path: string }).path).toBe("report (1).pdf");
    expect(fs.readFileSync(path.join(tmpDir, "Report.PDF"), "utf-8")).toBe("original");
  });

  it("normalizes filename with path separators to its basename", async () => {
    const res = await injectUpload("", "../../evil.txt", Buffer.from("safe"));
    expect(res.statusCode).toBe(200);
    expect((res.json() as { path: string }).path).toBe("evil.txt");
    expect(fs.readFileSync(path.join(tmpDir, "evil.txt"), "utf-8")).toBe("safe");
  });

  it("rejects an empty or invalid filename", async () => {
    const empty = await injectUpload("", "", Buffer.from("x"));
    expect(empty.statusCode).toBe(400);

    const colon = await injectUpload("", "a:b.txt", Buffer.from("x"));
    expect(colon.statusCode).toBe(400);
  });

  it("returns 404 when the target directory does not exist", async () => {
    const res = await injectUpload("no-such-dir", "a.txt", Buffer.from("x"));
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 when the target is not a directory", async () => {
    const res = await injectUpload("hello.txt", "a.txt", Buffer.from("x"));
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when the file field is missing", async () => {
    const { body, contentType } = buildMultipart([
      { name: "notfile", value: "text" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/upload/",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it("denies engine-internal target directories with 403", async () => {
    const res = await injectUpload(".spherse", "x.txt", Buffer.from("x"));
    expect(res.statusCode).toBe(403);
    expect(fs.existsSync(path.join(tmpDir, ".spherse/x.txt"))).toBe(false);
  });

  it("accepts files larger than the global 5MB multipart limit via per-route limits", async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 7);
    const res = await injectUpload("", "big.bin", big);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { bytes: number }).bytes).toBe(big.byteLength);
    expect(fs.statSync(path.join(tmpDir, "big.bin")).size).toBe(big.byteLength);
  });

  it("rejects files above the 100MB upload limit", async () => {
    const tooBig = Buffer.alloc(100 * 1024 * 1024 + 1, 1);
    const res = await injectUpload("", "too-big.bin", tooBig);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ message: "File too large" });
    expect(fs.existsSync(path.join(tmpDir, "too-big.bin"))).toBe(false);
  });
});
