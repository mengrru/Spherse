import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";

export function registerDebugRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.get<{ Params: { id: string } }>(
    "/api/debug/sessions/:id/turn-context",
    async (req, reply) => {
      try {
        return ctx.engine.getTurnContext(req.params.id);
      } catch (err: any) {
        return reply.code(404).send({ error: err.message });
      }
    },
  );
}
