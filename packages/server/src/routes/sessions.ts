import type { FastifyInstance } from "fastify";
import { schemas, parseContract } from "@spherse/contracts";
import type { ProjectRegistry } from "../registry.js";
import type { ChatSessionHub } from "../chat/index.js";
import { notFound } from "../errors.js";

export function registerSessionRoutes(
  fastify: FastifyInstance,
  _registry: ProjectRegistry,
  hub: ChatSessionHub,
): void {
  fastify.get<{ Params: { projectId: string }; Querystring: { perPage?: string } }>(
    "/api/projects/:projectId/sessions",
    {
      schema: { response: { 200: schemas.projectSessionListResponse } },
    },
    async (req) => {
      const requested = parseInt(req.query.perPage ?? "", 10);
      const perPage = Number.isNaN(requested)
        ? 10
        : Math.min(100, Math.max(1, requested));
      const result = req.projectCtx!.projectManager.listProjectSessions(perPage);
      return parseContract(schemas.projectSessionListResponse, { ok: true, ...result });
    },
  );

  fastify.get<{
    Params: { projectId: string; agentId: string };
    Querystring: { limit?: string; offset?: string };
  }>("/api/projects/:projectId/agents/:agentId/sessions", async (req) => {
    const { limit, offset } = req.query;
    if (limit !== undefined) {
      const limitNum = parseInt(limit, 10) || 10;
      const offsetNum = offset !== undefined ? parseInt(offset, 10) || 0 : 0;
      const result = req.projectCtx!.projectManager.listSessionsPage(
        req.params.agentId,
        limitNum,
        offsetNum,
      );
      return parseContract(schemas.sessionListPageResponse, result);
    }
    return req.projectCtx!.projectManager.listSessions(req.params.agentId);
  });

  fastify.post<{ Params: { projectId: string; agentId: string }; Body: { title?: string } }>(
    "/api/projects/:projectId/agents/:agentId/sessions",
    {
      preValidation: async (req) => {
        if (req.body === undefined) req.body = {};
      },
      schema: {
        body: schemas.sessionCreateRequest,
        response: {
          200: schemas.sessionCreateResponse,
        },
      },
    },
    async (req) => {
      const sessionId = await req.projectCtx!.sessionRuntime.createSession(
        req.params.agentId,
        undefined,
        req.body?.title,
      );
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

  fastify.get<{
    Params: { projectId: string; agentId: string; id: string };
    Querystring: { limit?: string; before?: string };
  }>(
    "/api/projects/:projectId/agents/:agentId/sessions/:id/messages",
    async (req) => {
      const { limit, before } = req.query;
      if (limit !== undefined) {
        const parsed = parseInt(limit, 10) || 20;
        const limitNum = Math.min(Math.max(parsed, 1), 200);
        const parsedBefore = before !== undefined ? parseInt(before, 10) : undefined;
        const beforeNum = parsedBefore !== undefined && !Number.isNaN(parsedBefore) ? parsedBefore : undefined;
        const result = req.projectCtx!.projectManager.getRecentSessionHistory(
          req.params.agentId,
          req.params.id,
          limitNum,
          beforeNum,
        );
        return parseContract(schemas.sessionMessagesPageResponse, result);
      }
      const messages = req.projectCtx!.projectManager.getSessionHistory(req.params.agentId, req.params.id);
      return parseContract(schemas.sessionMessagesResponse, messages);
    },
  );

  fastify.post<{
    Params: { projectId: string; agentId: string; id: string };
    Body: { content: string };
  }>(
    "/api/projects/:projectId/agents/:agentId/sessions/:id/messages",
    {
      schema: {
        body: schemas.sendMessageRequest,
        response: { 200: schemas.sendMessageOkResponse },
      },
    },
    async (req) => {
      await hub.startDetachedRun(
        req.params.projectId,
        req.projectCtx!.sessionRuntime,
        req.params.agentId,
        req.params.id,
        req.body.content,
      );
      return parseContract(schemas.sendMessageOkResponse, { ok: true });
    },
  );

  fastify.get<{ Params: { projectId: string; agentId: string; id: string } }>(
    "/api/projects/:projectId/agents/:agentId/sessions/:id/status",
    {
      schema: { response: { 200: schemas.sessionStatus } },
      async handler(req) {
        const status = req.projectCtx!.sessionRuntime.getSessionStatus(
          req.params.agentId,
          req.params.id,
        );
        return parseContract(schemas.sessionStatus, status);
      },
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
