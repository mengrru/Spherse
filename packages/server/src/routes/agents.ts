import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";

export function registerAgentRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.get("/api/agents", async () => {
    return ctx.engine.listProfiles();
  });

  fastify.get<{ Params: { id: string } }>(
    "/api/agents/:id",
    async (req, reply) => {
      const profile = await ctx.engine.getProfile(req.params.id);
      if (!profile) return reply.code(404).send({ error: "Agent not found" });
      return profile;
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/agents/:id/raw",
    async (req, reply) => {
      const raw = await ctx.engine.getRawContent(req.params.id);
      if (raw === null) return reply.code(404).send({ error: "Agent not found" });
      return { content: raw };
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/agents/:id/theme",
    async (req, reply) => {
      const theme = await ctx.engine.getAgentTheme(req.params.id);
      reply.type("text/css").send(theme);
    },
  );
}
