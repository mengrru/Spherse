import type { FastifyInstance } from "fastify";
import type { ProjectRegistry } from "../registry.js";

export function registerAgentRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get("/api/projects/:projectId/agents", async (req) => {
    return req.projectCtx!.projectManager.listAgents();
  });

  fastify.get<{ Params: { projectId: string; id: string } }>(
    "/api/projects/:projectId/agents/:id",
    async (req, reply) => {
      const profile = await req.projectCtx!.projectManager.getAgentProfile(req.params.id);
      if (!profile) return reply.code(404).send({ error: "Agent not found" });
      return profile;
    },
  );

  fastify.get<{ Params: { projectId: string; id: string } }>(
    "/api/projects/:projectId/agents/:id/raw",
    async (req, reply) => {
      const raw = await req.projectCtx!.projectManager.getRawContent(req.params.id);
      if (raw === null) return reply.code(404).send({ error: "Agent not found" });
      return { content: raw };
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
