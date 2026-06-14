import type { FastifyInstance } from "fastify";
import type { ProjectRegistry } from "../registry.js";

export function registerDebugRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string; id: string } }>(
    "/api/projects/:projectId/debug/sessions/:id/turn-context",
    async (req, reply) => {
      try {
        return req.projectCtx!.engine.getTurnContext(req.params.id);
      } catch (err: any) {
        return reply.code(404).send({ error: err.message });
      }
    },
  );
}
