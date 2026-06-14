import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/server/contracts";
import type { ProjectRegistry } from "../registry.js";

export function registerSessionRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string; agentId: string } }>(
    "/api/projects/:projectId/agents/:agentId/sessions",
    async (req) => {
      return req.projectCtx!.projectManager.listSessions(req.params.agentId);
    },
  );

  fastify.post<{ Params: { projectId: string; agentId: string } }>(
    "/api/projects/:projectId/agents/:agentId/sessions",
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
        const sessionId = await req.projectCtx!.sessionRuntime.createSession(req.params.agentId);
        return { sessionId };
      } catch (err: any) {
        return reply.code(404).send({ error: err.message });
      }
    },
  );

  fastify.get<{ Params: { projectId: string; agentId: string; id: string } }>(
    "/api/projects/:projectId/agents/:agentId/sessions/:id",
    async (req, reply) => {
      const session = req.projectCtx!.projectManager.getSession(req.params.agentId, req.params.id);
      if (!session)
        return reply.code(404).send({ error: "Session not found" });
      return session;
    },
  );

  fastify.get<{ Params: { projectId: string; agentId: string; id: string } }>(
    "/api/projects/:projectId/agents/:agentId/sessions/:id/messages",
    async (req) => {
      return req.projectCtx!.projectManager.getSessionHistory(req.params.agentId, req.params.id);
    },
  );

  fastify.patch<{ Params: { projectId: string; agentId: string; id: string }; Body: { title?: unknown } }>(
    "/api/projects/:projectId/agents/:agentId/sessions/:id",
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
        return req.projectCtx!.projectManager.renameSession(req.params.agentId, req.params.id, title);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : "request failed";
        if (message.includes("not found")) {
          return reply.code(404).send({ error: message });
        }
        return reply.code(400).send({ error: message });
      }
    },
  );

  fastify.delete<{ Params: { projectId: string; agentId: string; id: string } }>(
    "/api/projects/:projectId/agents/:agentId/sessions/:id",
    async (req) => {
      req.projectCtx!.runtime.deleteSession(req.params.agentId, req.params.id);
      return { ok: true };
    },
  );
}
