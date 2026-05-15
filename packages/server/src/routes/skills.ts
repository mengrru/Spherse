import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";

export function registerSkillRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.get("/api/skills", async () => {
    return ctx.engine.listSkills();
  });

  fastify.get<{ Params: { name: string } }>(
    "/api/skills/:name",
    async (req, reply) => {
      const skill = await ctx.engine.getSkill(req.params.name);
      if (!skill) return reply.code(404).send({ error: "Skill not found" });
      return skill;
    },
  );
}
