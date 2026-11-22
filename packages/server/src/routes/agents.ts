import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/contracts";
import type { ProjectRegistry } from "../registry.js";
import { notFound } from "../errors.js";

/**
 * @deprecated 业务面已迁移至 /ws/rpc（agents 方法组），本 REST 路由仅为过渡保留，将随 P2 下线；新代码禁止新增依赖。
 */
export function registerAgentRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get("/api/projects/:projectId/agents", {
    schema: { response: { 200: schemas.agentListResponse } },
    async handler(req) {
      const agents = await req.projectCtx!.projectManager.listAgents();
      // 列表只下发摘要；完整配置由单条端点 / raw 内容按需加载
      return agents.map(({ id, name, alias, slug, createdAt, memory }) => ({
        id,
        name,
        ...(alias !== undefined ? { alias } : {}),
        slug,
        ...(createdAt !== undefined ? { createdAt } : {}),
        memoryEnabled: memory?.enabled === true,
      }));
    },
  });

  fastify.get<{ Params: { projectId: string; id: string } }>(
    "/api/projects/:projectId/agents/:id",
    {
      schema: { response: { 200: schemas.agentProfile } },
      async handler(req) {
        const profile = await req.projectCtx!.projectManager.getAgentProfile(req.params.id);
        if (!profile) throw notFound("Agent not found");
        return profile;
      },
    },
  );

  fastify.get<{ Params: { projectId: string; id: string } }>(
    "/api/projects/:projectId/agents/:id/raw",
    {
      schema: { response: { 200: schemas.agentRawResponse } },
      async handler(req) {
        const raw = await req.projectCtx!.projectManager.getRawContent(req.params.id);
        if (raw === null) throw notFound("Agent not found");
        return { content: raw };
      },
    },
  );

  fastify.get<{ Params: { projectId: string; id: string } }>(
    "/api/projects/:projectId/agents/:id/theme",
    async (req, reply) => {
      const theme = await req.projectCtx!.projectManager.getAgentTheme(req.params.id);
      reply.type("text/css").send(theme);
    },
  );
}
