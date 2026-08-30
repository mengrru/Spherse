import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/contracts";
import type { ContextFilesInspectRequest } from "@spherse/contracts";
import { inspectContextFiles } from "@spherse/core";
import type { ProjectRegistry } from "../registry.js";

export function registerContextFileRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.post<{ Params: { projectId: string }; Body: ContextFilesInspectRequest }>(
    "/api/projects/:projectId/context-files/inspect",
    {
      schema: {
        body: schemas.contextFilesInspectRequest,
        response: { 200: schemas.contextFilesInspectResponse },
      },
    },
    async (req) => {
      const root = req.projectCtx!.projectManager.getRootPath();
      return { files: await inspectContextFiles(root, req.body.paths) };
    },
  );
}
