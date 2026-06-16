import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/server/contracts";
import type { ProjectRegistry } from "../registry.js";
import { notFound } from "../errors.js";

export function registerAgentRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get("/api/projects/:projectId/agents", {
    schema: { response: { 200: schemas.agentListResponse } },
    async handler(req) {
      return req.projectCtx!.projectManager.listAgents();
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
