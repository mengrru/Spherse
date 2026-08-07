import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/server/contracts";
import type { AgentCreateRequest, AgentUpdateRequest } from "@spherse/server/contracts";
import type { ProjectRegistry } from "../registry.js";
import { badRequest } from "../errors.js";

export function registerAgentWriteRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.post<{ Params: { projectId: string }; Body: AgentCreateRequest }>(
    "/api/projects/:projectId/agents/create",
    {
      schema: {
        body: schemas.agentCreateRequest,
        response: { 200: schemas.agentCreateResponse },
      },
    },
    async (req) => {
      const { slugBase, content, themeContent } = req.body;
      if (!slugBase || !content) throw badRequest("slugBase and content are required");

      const profile = await req.projectCtx!.projectManager.createAgent(slugBase, content, themeContent);
      return { ok: true, id: profile.id };
    },
  );

  fastify.put<{ Params: { projectId: string; id: string }; Body: AgentUpdateRequest }>(
    "/api/projects/:projectId/agents/:id",
    {
      schema: {
        body: schemas.agentUpdateRequest,
        response: { 200: schemas.agentUpdateResponse },
      },
    },
    async (req) => {
      const { content, themeContent } = req.body;
      if (!content) throw badRequest("content is required");

      const updated = await req.projectCtx!.runtime.updateAgent(req.params.id, content, themeContent);
      return { ok: true, id: updated.id };
    },
  );

  fastify.delete<{ Params: { projectId: string; id: string } }>(
    "/api/projects/:projectId/agents/:id",
    { schema: { response: { 200: schemas.okResponse } } },
    async (req) => {
      await req.projectCtx!.runtime.deleteAgent(req.params.id);
      return { ok: true };
    },
  );
}
