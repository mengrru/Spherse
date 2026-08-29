import fs from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import {
  resolveProjectPath,
  serverAccessPolicy,
  AccessDeniedError,
  ConflictError,
  isBinaryBuffer,
  BINARY_SAMPLE_SIZE,
} from "@spherse/core";
import { schemas, parseContract } from "@spherse/contracts";
import type { ProjectRegistry } from "../registry.js";
import { forbidden, notFound, badRequest, conflict } from "../errors.js";

async function readFileContent(absolutePath: string): Promise<{ content: string; binary: boolean }> {
  const handle = await fs.open(absolutePath, "r");
  try {
    const head = Buffer.alloc(BINARY_SAMPLE_SIZE);
    const { bytesRead } = await handle.read(head, 0, BINARY_SAMPLE_SIZE, 0);
    if (isBinaryBuffer(head.subarray(0, bytesRead))) {
      return { content: "", binary: true };
    }
  } finally {
    await handle.close();
  }
  const content = await fs.readFile(absolutePath, "utf-8");
  return { content, binary: false };
}

export function registerContentRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string; "*": string } }>(
    "/api/projects/:projectId/stat/*",
    { schema: { response: { 200: schemas.statResponse } } },
    async (req) => {
      const relativePath = req.params["*"];
      const pm = req.projectCtx!.projectManager;
      const root = pm.getRootPath();
      const policy = serverAccessPolicy(root);
      try {
        policy.assertRead(relativePath);
      } catch (err) {
        if (err instanceof AccessDeniedError) throw forbidden("Access denied");
        throw err;
      }
      const absolutePath = resolveProjectPath(root, relativePath);

      let stat;
      try {
        stat = await fs.stat(absolutePath);
      } catch {
        throw notFound("Not found");
      }
      return {
        size: stat.size,
        mtime: stat.mtimeMs,
        isDirectory: stat.isDirectory(),
      };
    },
  );

  fastify.get<{ Params: { projectId: string; "*": string } }>(
    "/api/projects/:projectId/content/*",
    async (req) => {
      const relativePath = req.params["*"];
      const pm = req.projectCtx!.projectManager;
      const root = pm.getRootPath();
      const policy = serverAccessPolicy(root);
      try {
        policy.assertRead(relativePath);
      } catch (err) {
        if (err instanceof AccessDeniedError) throw forbidden("Access denied");
        throw err;
      }
      const absolutePath = resolveProjectPath(root, relativePath);

      let stat;
      try {
        stat = await fs.stat(absolutePath);
      } catch {
        throw notFound("Not found");
      }

      if (stat.isDirectory()) {
        const entries = await fs.readdir(absolutePath, { withFileTypes: true });
        const fileEntries = entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "directory" : "file",
        }));
        return parseContract(schemas.fileEntries, fileEntries);
      }
      const { content, binary } = await readFileContent(absolutePath);
      return parseContract(schemas.contentResponse, { content, path: relativePath, binary });
    },
  );

  fastify.post<{ Params: { projectId: string; "*": string }; Body: { action: "mkdir" | "touch" } }>(
    "/api/projects/:projectId/content/*",
    { schema: { body: schemas.contentCreateRequest, response: { 200: schemas.okResponse } } },
    async (req) => {
      const relativePath = req.params["*"];
      const pm = req.projectCtx!.projectManager;

      const action = req.body?.action;
      if (action !== "mkdir" && action !== "touch") {
        throw badRequest("Invalid or missing 'action' (expected 'mkdir' or 'touch')");
      }

      try {
        await pm.createEntry(relativePath, action);
      } catch (err) {
        if (err instanceof AccessDeniedError) throw forbidden("Access denied");
        if (err instanceof ConflictError) throw conflict("Already exists");
        throw err;
      }
      return { ok: true };
    },
  );

  fastify.put<{ Params: { projectId: string; "*": string }; Body: { content: string } }>(
    "/api/projects/:projectId/content/*",
    { schema: { body: schemas.contentSaveRequest, response: { 200: schemas.okResponse } } },
    async (req) => {
      const relativePath = req.params["*"];
      const pm = req.projectCtx!.projectManager;
      if (typeof req.body?.content !== "string") {
        throw badRequest("Missing or invalid 'content'");
      }

      try {
        await pm.writeFile(relativePath, req.body.content);
      } catch (err) {
        if (err instanceof AccessDeniedError) throw forbidden("Access denied");
        throw err;
      }
      return { ok: true };
    },
  );

  fastify.delete<{ Params: { projectId: string; "*": string } }>(
    "/api/projects/:projectId/content/*",
    { schema: { response: { 200: schemas.okResponse } } },
    async (req) => {
      const relativePath = req.params["*"];
      const pm = req.projectCtx!.projectManager;

      try {
        await pm.deletePath(relativePath);
      } catch (err) {
        if (err instanceof AccessDeniedError) throw forbidden("Access denied");
        throw err;
      }
      return { ok: true };
    },
  );
}
