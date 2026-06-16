import type { FastifyInstance } from "fastify";
import { schemas, parseContract } from "@spherse/server/contracts";
import type { ProjectRegistry } from "../registry.js";
import { notFound } from "../errors.js";

export function registerSessionRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string; agentId: string } }>(
    "/api/projects/:projectId/agents/:agentId/sessions",
    {
      schema: { response: { 200: schemas.sessionListResponse } },
      async handler(req) {
        return req.projectCtx!.projectManager.listSessions(req.params.agentId);
      },
    },
  );

  fastify.post<{ Params: { projectId: string; agentId: string } }>(
    "/api/projects/:projectId/agents/:agentId/sessions",
    {
      schema: {
        response: {
          200: schemas.sessionCreateResponse,
        },
      },
    },
    async (req) => {
      const sessionId = await req.projectCtx!.sessionRuntime.createSession(req.params.agentId);
      return { sessionId };
    },
  );

  fastify.get<{ Params: { projectId: string; agentId: string; id: string } }>(
    "/api/projects/:projectId/agents/:agentId/sessions/:id",
    {
      schema: { response: { 200: schemas.sessionInfo } },
      async handler(req) {
        const session = req.projectCtx!.projectManager.getSession(req.params.agentId, req.params.id);
        if (!session) throw notFound("Session not found");
        return session;
      },
    },
  );

  fastify.get<{ Params: { projectId: string; agentId: string; id: string } }>(
    "/api/projects/:projectId/agents/:agentId/sessions/:id/messages",
    async (req) => {
      const messages = req.projectCtx!.projectManager.getSessionHistory(req.params.agentId, req.params.id);
      return parseContract(schemas.sessionMessagesResponse, messages);
    },
  );

  fastify.patch<{ Params: { projectId: string; agentId: string; id: string }; Body: { title: string } }>(
    "/api/projects/:projectId/agents/:agentId/sessions/:id",
    {
      schema: {
        body: schemas.sessionRenameRequest,
        response: {
          200: schemas.sessionInfo,
        },
      },
    },
    async (req) => {
      return req.projectCtx!.projectManager.renameSession(
        req.params.agentId,
        req.params.id,
        req.body.title,
      );
    },
  );

  fastify.delete<{ Params: { projectId: string; agentId: string; id: string } }>(
    "/api/projects/:projectId/agents/:agentId/sessions/:id",
    { schema: { response: { 200: schemas.okResponse } } },
    async (req) => {
      req.projectCtx!.runtime.deleteSession(req.params.agentId, req.params.id);
      return { ok: true };
    },
  );
}
