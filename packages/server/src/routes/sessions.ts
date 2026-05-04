import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";

export function registerSessionRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.post<{ Body: { agentName?: string } }>(
    "/api/sessions",
    async (req, reply) => {
      const { agentName } = req.body ?? {};
      if (!agentName)
        return reply.code(400).send({ error: "agentName is required" });
      try {
        const sessionId = await ctx.agentEngine.createSession(agentName);
        return { sessionId };
      } catch (err: any) {
        return reply.code(404).send({ error: err.message });
      }
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/sessions/:id",
    async (req, reply) => {
      const session = ctx.sessionStore.getSession(req.params.id);
      if (!session)
        return reply.code(404).send({ error: "Session not found" });
      return session;
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/sessions/:id/messages",
    async (req) => {
      return ctx.agentEngine.getSessionHistory(req.params.id);
    },
  );
}
