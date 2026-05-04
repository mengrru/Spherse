import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";

export function registerAgentRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.get("/api/agents", async () => {
    return ctx.agentEngine.listAgents();
  });

  fastify.get<{ Params: { name: string } }>(
    "/api/agents/:name",
    async (req, reply) => {
      const agents = await ctx.agentEngine.listAgents();
      const agent = agents.find((a) => a.name === req.params.name);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });
      return agent;
    },
  );
}
