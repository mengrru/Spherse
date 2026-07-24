import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/server/contracts";
import type { AgentMcpUpdateRequest } from "@spherse/server/contracts";
import type { ProjectRegistry } from "../registry.js";
import { notFound } from "../errors.js";

export function registerAgentMcpRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string; id: string } }>(
    "/api/projects/:projectId/agents/:id/mcp",
    {
      schema: { response: { 200: schemas.agentMcpResponse } },
      async handler(req) {
        const manager = req.projectCtx!.projectManager;
        try {
          return await manager.getAgentMcp(req.params.id);
        } catch {
          throw notFound("Agent not found");
        }
      },
    },
  );

  fastify.put<{ Params: { projectId: string; id: string }; Body: AgentMcpUpdateRequest }>(
    "/api/projects/:projectId/agents/:id/mcp",
    {
      schema: {
        body: schemas.agentMcpUpdateRequest,
        response: { 200: schemas.agentMcpResponse },
      },
    },
    async (req) => {
      try {
        return await req.projectCtx!.runtime.updateAgentMcp(req.params.id, req.body);
      } catch {
        throw notFound("Agent not found");
      }
    },
  );
}
