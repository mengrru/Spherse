import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { ProjectRegistry } from "../registry.js";
import { resolveProjectPath, assertInsideProject } from "@spherse/core";
import { schemas } from "@spherse/server/contracts";

export function registerImagesRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.post<{
    Params: { projectId: string };
    Body: { src: string; dest: string };
  }>("/api/projects/:projectId/images/export", {
    schema: {
      body: {
        type: "object",
        required: ["src", "dest"],
        properties: {
          src: { type: "string" },
          dest: { type: "string" },
        },
      },
      response: { 200: schemas.okResponse },
    },
    async handler(req) {
      const { src, dest } = req.body;
      const root = req.projectCtx!.projectManager.getRootPath();
      const srcAbs = resolveProjectPath(root, src);
      assertInsideProject(root, path.resolve(dest), dest);
      const destAbs = path.resolve(dest);
      await fs.mkdir(path.dirname(destAbs), { recursive: true });
      await fs.copyFile(srcAbs, destAbs);
      return { ok: true };
    },
  });
}
