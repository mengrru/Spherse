import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { resolveProjectPath, serverAccessPolicy, AccessDeniedError } from "@spherse/core";
import { parseContract, schemas } from "@spherse/contracts";
import type { ProjectRegistry } from "../registry.js";
import { badRequest, forbidden, notFound } from "../errors.js";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const INVALID_NAME_RE = /[/\\:]/;

export function dedupeFileName(existing: ReadonlySet<string>, filename: string): string {
  const taken = new Set<string>();
  for (const name of existing) taken.add(name.toLowerCase());
  if (!taken.has(filename.toLowerCase())) return filename;
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  for (let i = 1; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function registerUploadRoutes(
  fastify: FastifyInstance,
  _registry: ProjectRegistry,
): void {
  fastify.post<{ Params: { projectId: string; "*": string } }>(
    "/api/projects/:projectId/upload/*",
    async (req) => {
      const dirPath = req.params["*"];
      const pm = req.projectCtx!.projectManager;
      const root = pm.getRootPath();
      const policy = serverAccessPolicy(root);

      try {
        policy.assertRead(dirPath);
      } catch (err) {
        if (err instanceof AccessDeniedError) throw forbidden("Access denied");
        throw err;
      }

      const dirAbs = resolveProjectPath(root, dirPath);
      let stat;
      try {
        stat = await fs.stat(dirAbs);
      } catch {
        throw notFound("Target directory not found");
      }
      if (!stat.isDirectory()) {
        throw badRequest("Target is not a directory");
      }

      let filename: string | undefined;
      let fileBuffer: Buffer | undefined;
      try {
        for await (const part of req.parts({ limits: { fileSize: MAX_UPLOAD_BYTES } })) {
          if (part.type !== "file" || part.fieldname !== "file") continue;
          filename = part.filename;
          fileBuffer = await part.toBuffer();
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

      if (!fileBuffer || filename === undefined) {
        throw badRequest("Missing file");
      }
      const safeName = path.basename(filename.trim());
      if (!safeName || safeName === "." || safeName === ".." || INVALID_NAME_RE.test(safeName)) {
        throw badRequest("Invalid file name");
      }
      if (fileBuffer.byteLength > MAX_UPLOAD_BYTES) {
        throw badRequest("File too large");
      }

      let entries: string[];
      try {
        entries = await fs.readdir(dirAbs);
      } catch {
        throw notFound("Target directory not found");
      }
      const finalName = dedupeFileName(new Set(entries), safeName);
      const relPath = dirPath ? `${dirPath}/${finalName}` : finalName;

      try {
        await pm.writeBinaryFile(relPath, fileBuffer);
      } catch (err) {
        if (err instanceof AccessDeniedError) throw forbidden("Access denied");
        throw err;
      }

      return parseContract(schemas.uploadResponse, {
        path: relPath,
        bytes: fileBuffer.byteLength,
        renamed: finalName !== safeName,
      });
    },
  );
}
