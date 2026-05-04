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
}
