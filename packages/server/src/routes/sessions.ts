import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";

export function registerSessionRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.get<{ Querystring: { agentId?: string } }>(
    "/api/sessions",
    async (req) => {
      return ctx.engine.listSessions(req.query.agentId);
    },
  );

  fastify.post<{ Body: { agentId?: string } }>(
    "/api/sessions",
    async (req, reply) => {
      const { agentId } = req.body ?? {};
      if (!agentId)
        return reply.code(400).send({ error: "agentId is required" });
      try {
        const sessionId = await ctx.engine.createSession(agentId);
        return { sessionId };
      } catch (err: any) {
        return reply.code(404).send({ error: err.message });
      }
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/sessions/:id",
    async (req, reply) => {
      const session = ctx.engine.getSession(req.params.id);
      if (!session)
        return reply.code(404).send({ error: "Session not found" });
      return session;
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/sessions/:id/messages",
    async (req) => {
      return ctx.engine.getSessionHistory(req.params.id);
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    "/api/sessions/:id",
    async (req) => {
      ctx.engine.deleteSession(req.params.id);
      return { ok: true };
    },
  );
}
