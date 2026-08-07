import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ProjectRegistry } from "../registry.js";
import {
  resolveProjectPath,
  assertInsideProject,
  isPathInside,
  AccessDeniedError,
} from "@spherse/core";
import { badRequest, forbidden } from "../errors.js";

const ATTACHMENTS_DIR = ".spherse/attachments";
const MAX_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function registerAttachmentsRoutes(
  fastify: FastifyInstance,
  _registry: ProjectRegistry,
): void {
  fastify.post<{
    Params: { projectId: string };
  }>("/api/projects/:projectId/attachments", async (req) => {
    let fileBuffer: Buffer | undefined;
    let mimeType: string | undefined;
    let width: number | undefined;
    let height: number | undefined;

    try {
      for await (const part of req.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "file") continue;
          mimeType = part.mimetype;
          fileBuffer = await part.toBuffer();
        } else if (part.fieldname === "width") {
          const n = Number(part.value);
          if (Number.isFinite(n)) width = n;
        } else if (part.fieldname === "height") {
          const n = Number(part.value);
          if (Number.isFinite(n)) height = n;
        }
      }
    } catch (err) {
      if (
        err instanceof Error &&
        (err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE"
      ) {
        throw badRequest("File too large");
      }
      throw err;
    }

    if (!fileBuffer || !mimeType) {
      throw badRequest("Missing file");
    }
    if (!(mimeType in MIME_TO_EXT)) {
      throw badRequest("Unsupported media type");
    }
    if (fileBuffer.byteLength > MAX_BYTES) {
      throw badRequest("File too large");
    }

    const ext = MIME_TO_EXT[mimeType];
    const filename = `${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
    const destRel = `${ATTACHMENTS_DIR}/${filename}`;
    const pm = req.projectCtx!.projectManager;
    const root = pm.getRootPath();
    const destAbs = resolveProjectPath(root, destRel);
    assertInsideProject(root, destAbs, destRel);

    const attachmentsRoot = resolveProjectPath(root, ATTACHMENTS_DIR);
    if (!isPathInside(attachmentsRoot, destAbs)) {
      throw forbidden("Access denied");
    }

    await pm.getFileWriteMutex().run(destAbs, async () => {
      await fs.mkdir(path.dirname(destAbs), { recursive: true });
      await fs.writeFile(destAbs, fileBuffer!);
    });

    return {
      type: "image",
      path: destRel,
      width,
      height,
      bytes: fileBuffer.byteLength,
    };
  });

  fastify.delete<{
    Params: { projectId: string };
    Body: { path?: string };
  }>("/api/projects/:projectId/attachments", async (req) => {
    const targetPath = req.body?.path;
    if (typeof targetPath !== "string" || targetPath.length === 0) {
      throw badRequest("Missing 'path'");
    }
    const pm = req.projectCtx!.projectManager;
    const root = pm.getRootPath();
    let targetAbs: string;
    try {
      targetAbs = resolveProjectPath(root, targetPath);
      assertInsideProject(root, targetAbs, targetPath);
    } catch (err) {
      if (err instanceof AccessDeniedError) throw forbidden("Access denied");
      throw err;
    }

    const attachmentsRoot = resolveProjectPath(root, ATTACHMENTS_DIR);
    if (!isPathInside(attachmentsRoot, targetAbs)) {
      throw forbidden("Access denied");
    }

    try {
      await fs.unlink(targetAbs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return { ok: true };
  });
}
