import type { FastifyInstance } from "fastify";
import { schemas, parseContract } from "@spherse/contracts";
import type { ProjectRegistry } from "../registry.js";
import { badRequest } from "../errors.js";

/**
 * @deprecated 业务面已迁移至 /ws/rpc（debug 方法组），本 REST 路由仅为过渡保留，将随 P2 下线；新代码禁止新增依赖。
 */
export function registerDebugRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string; id: string } }>(
    "/api/projects/:projectId/debug/sessions/:id/turn-context",
    async (req) => {
      const snapshot = req.projectCtx!.sessionRuntime.getTurnContext(req.params.id);
      return parseContract(schemas.turnContextSnapshot, snapshot);
    },
  );

  fastify.get<{
    Params: { projectId: string; id: string };
    Querystring: { agentId?: string };
  }>("/api/projects/:projectId/debug/sessions/:id/events", async (req) => {
    const agentId = (req.query.agentId ?? "").trim();
    if (!agentId) throw badRequest("agentId is required");
    const events = req.projectCtx!.sessionRuntime.readSessionEventsAfter(
      agentId,
      req.params.id,
      -1,
      Number.MAX_SAFE_INTEGER,
    );
    return parseContract(schemas.sessionEventLog, {
      sessionId: req.params.id,
      events,
    });
  });
}
