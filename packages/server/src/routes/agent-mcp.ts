import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/contracts";
import type { AgentMcpUpdateRequest } from "@spherse/contracts";
import type { ProjectRegistry } from "../registry.js";
import { notFound } from "../errors.js";

/**
 * @deprecated 业务面已迁移至 /ws/rpc（agents 方法组），本 REST 路由仅为过渡保留，将随 P2 下线；新代码禁止新增依赖。
 */
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
