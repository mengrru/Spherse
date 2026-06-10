import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/server/contracts";
import type { AppContext } from "../index.js";

export function registerSessionRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.get<{ Params: { agentId: string } }>(
    "/api/agents/:agentId/sessions",
    async (req) => {
      return ctx.engine.listSessions(req.params.agentId);
    },
  );

  fastify.post<{ Params: { agentId: string } }>(
    "/api/agents/:agentId/sessions",
    {
      schema: {
        response: {
          200: schemas.createSessionResponse,
          404: schemas.errorResponse,
        },
      },
    },
    async (req, reply) => {
      try {
        const sessionId = await ctx.engine.createSession(req.params.agentId);
        return { sessionId };
      } catch (err: any) {
        return reply.code(404).send({ error: err.message });
      }
    },
  );

  fastify.get<{ Params: { agentId: string; id: string } }>(
    "/api/agents/:agentId/sessions/:id",
    async (req, reply) => {
      const session = ctx.engine.getSession(req.params.agentId, req.params.id);
      if (!session)
        return reply.code(404).send({ error: "Session not found" });
      return session;
    },
  );

  fastify.get<{ Params: { agentId: string; id: string } }>(
    "/api/agents/:agentId/sessions/:id/messages",
    async (req) => {
      return ctx.engine.getSessionHistory(req.params.agentId, req.params.id);
    },
  );

  fastify.patch<{ Params: { agentId: string; id: string }; Body: { title?: unknown } }>(
    "/api/agents/:agentId/sessions/:id",
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
        return ctx.engine.renameSession(req.params.agentId, req.params.id, title);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : "request failed";
        if (message.includes("not found")) {
          return reply.code(404).send({ error: message });
        }
        return reply.code(400).send({ error: message });
      }
    },
  );

  fastify.delete<{ Params: { agentId: string; id: string } }>(
    "/api/agents/:agentId/sessions/:id",
    async (req) => {
      ctx.engine.deleteSession(req.params.agentId, req.params.id);
      return { ok: true };
    },
  );
}
