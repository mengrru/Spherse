import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { resolveProjectPath, isProjectMetaPath } from "@spherse/core";
import { schemas, parseContract } from "@spherse/server/contracts";
import type { ProjectRegistry } from "../registry.js";
import { forbidden, notFound, badRequest, conflict } from "../errors.js";

export function registerContentRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string; "*": string } }>(
    "/api/projects/:projectId/content/*",
    async (req) => {
      const relativePath = req.params["*"];
      const root = req.projectCtx!.projectManager.getRootPath();
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
      const content = await fs.readFile(absolutePath, "utf-8");
      return parseContract(schemas.contentResponse, { content, path: relativePath });
    },
  );

  fastify.post<{ Params: { projectId: string; "*": string }; Body: { action: "mkdir" | "touch" } }>(
    "/api/projects/:projectId/content/*",
    { schema: { body: schemas.contentCreateRequest, response: { 200: schemas.okResponse } } },
    async (req) => {
      const relativePath = req.params["*"];
      const root = req.projectCtx!.projectManager.getRootPath();
      const absolutePath = resolveProjectPath(root, relativePath);
      if (isProjectMetaPath(relativePath)) throw forbidden("Cannot modify .spherse directory");

      const action = req.body?.action;
      if (action !== "mkdir" && action !== "touch") {
        throw badRequest("Invalid or missing 'action' (expected 'mkdir' or 'touch')");
      }

      const stat = await fs.stat(absolutePath).catch(() => null);
      if (stat) throw conflict("Already exists");

      if (action === "mkdir") {
        await fs.mkdir(absolutePath, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, "", "utf-8");
      }
      return { ok: true };
    },
  );

  fastify.put<{ Params: { projectId: string; "*": string }; Body: { content: string } }>(
    "/api/projects/:projectId/content/*",
    { schema: { body: schemas.contentSaveRequest, response: { 200: schemas.okResponse } } },
    async (req) => {
      const relativePath = req.params["*"];
      const root = req.projectCtx!.projectManager.getRootPath();
      const absolutePath = resolveProjectPath(root, relativePath);

      if (typeof req.body?.content !== "string") {
        throw badRequest("Missing or invalid 'content'");
      }

      await req.projectCtx!.projectManager.getFileWriteMutex().run(absolutePath, async () => {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, req.body.content, "utf-8");
      });
      return { ok: true };
    },
  );

  fastify.delete<{ Params: { projectId: string; "*": string } }>(
    "/api/projects/:projectId/content/*",
    { schema: { response: { 200: schemas.okResponse } } },
    async (req) => {
      const relativePath = req.params["*"];
      const root = req.projectCtx!.projectManager.getRootPath();
      const absolutePath = resolveProjectPath(root, relativePath);
      if (isProjectMetaPath(relativePath)) throw forbidden("Cannot modify .spherse directory");

      try {
        const stat = await fs.stat(absolutePath);
        if (stat.isDirectory()) {
          await fs.rm(absolutePath, { recursive: true });
        } else {
          await fs.unlink(absolutePath);
        }
      } catch {
        throw notFound("Not found");
      }
      return { ok: true };
    },
  );
}
