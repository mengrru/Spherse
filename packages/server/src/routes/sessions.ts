import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/server/contracts";
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
    {
      schema: {
        body: schemas.createSessionRequest,
        response: {
          200: schemas.createSessionResponse,
          400: schemas.errorResponse,
          404: schemas.errorResponse,
        },
      },
    },
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

  fastify.patch<{ Params: { id: string }; Body: { title?: unknown } }>(
    "/api/sessions/:id",
    {
      schema: {
        body: schemas.renameSessionRequest,
        response: {
          200: schemas.sessionInfo,
          400: schemas.errorResponse,
          404: schemas.errorResponse,
        },
      },
    },
    async (req, reply) => {
      const { title } = req.body ?? {};
      if (typeof title !== "string") {
        return reply.code(400).send({ error: "title is required" });
      }

      try {
        return ctx.engine.renameSession(req.params.id, title);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : "request failed";
        if (message.includes("not found")) {
          return reply.code(404).send({ error: message });
        }
        return reply.code(400).send({ error: message });
      }
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
