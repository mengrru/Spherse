import type { FastifyInstance } from "fastify";
import type { ProjectRegistry } from "../registry.js";

export function registerSkillRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/skills",
    async (req) => {
      return req.projectCtx!.engine.listSkills();
    },
  );

  fastify.get<{ Params: { projectId: string; name: string } }>(
    "/api/projects/:projectId/skills/:name",
    async (req, reply) => {
      const skill = await req.projectCtx!.engine.getSkill(req.params.name);
      if (!skill) return reply.code(404).send({ error: "Skill not found" });
      return skill;
    },
  );
}
