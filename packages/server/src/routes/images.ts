import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { ProjectRegistry } from "../registry.js";
import { resolveProjectPath, serverAccessPolicy, AccessDeniedError } from "@spherse/core";
import { schemas } from "@spherse/server/contracts";
import { forbidden } from "../errors.js";

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
      const pm = req.projectCtx!.projectManager;
      const root = pm.getRootPath();
      const policy = serverAccessPolicy(root);
      const srcAbs = resolveProjectPath(root, src);
      const destAbs = path.resolve(dest);
      const destRel = path.relative(root, destAbs);
      try {
        policy.assertWrite(destRel);
      } catch (err) {
        if (err instanceof AccessDeniedError) throw forbidden("Access denied");
        throw err;
      }
      await fs.mkdir(path.dirname(destAbs), { recursive: true });
      await fs.copyFile(srcAbs, destAbs);
      return { ok: true };
    },
  });
}
