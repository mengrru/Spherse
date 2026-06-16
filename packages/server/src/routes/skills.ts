import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/server/contracts";
import type { ProjectRegistry } from "../registry.js";
import { notFound } from "../errors.js";

export function registerSkillRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/skills",
    {
      schema: { response: { 200: schemas.skillListResponse } },
      async handler(req) {
        return req.projectCtx!.projectManager.listSkills();
      },
    },
  );

  fastify.get<{ Params: { projectId: string; name: string } }>(
    "/api/projects/:projectId/skills/:name",
    {
      schema: { response: { 200: schemas.skillDefinition } },
      async handler(req) {
        const skill = await req.projectCtx!.projectManager.getSkill(req.params.name);
        if (!skill) throw notFound("Skill not found");
        return skill;
      },
    },
  );
}
