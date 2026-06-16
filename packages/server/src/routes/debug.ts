import type { FastifyInstance } from "fastify";
import { schemas, parseContract } from "@spherse/server/contracts";
import type { ProjectRegistry } from "../registry.js";

export function registerDebugRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string; id: string } }>(
    "/api/projects/:projectId/debug/sessions/:id/turn-context",
    async (req) => {
      const snapshot = req.projectCtx!.sessionRuntime.getTurnContext(req.params.id);
      return parseContract(schemas.turnContextSnapshot, snapshot);
    },
  );
}
