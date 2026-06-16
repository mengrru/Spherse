import type { FastifyInstance } from "fastify";
import type { ProjectRegistry } from "../registry.js";
import { notFound } from "../errors.js";

export function registerSkillRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/skills",
    async (req) => {
      return req.projectCtx!.projectManager.listSkills();
    },
  );

  fastify.get<{ Params: { projectId: string; name: string } }>(
    "/api/projects/:projectId/skills/:name",
    async (req) => {
      const skill = await req.projectCtx!.projectManager.getSkill(req.params.name);
      if (!skill) throw notFound("Skill not found");
      return skill;
    },
  );
}
