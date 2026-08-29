import type { FastifyInstance } from "fastify";
import { schemas, parseContract } from "@spherse/contracts";
import type { SkillCreateRequest, SkillInstallRequest } from "@spherse/contracts";
import type { ProjectRegistry } from "../registry.js";
import { notFound } from "../errors.js";

export function registerSkillRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/skills",
    {
      schema: { response: { 200: schemas.skillListResponse } },
      async handler(req) {
        const skills = await req.projectCtx!.projectManager.listSkills();
        // 列表只下发摘要；instructions 全文仅 load_skill 工具与单条端点需要
        return skills.map(({ instructions: _instructions, ...summary }) => summary);
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

  fastify.post<{ Params: { projectId: string }; Body: SkillCreateRequest }>(
    "/api/projects/:projectId/skills",
    {
      schema: {
        body: schemas.skillCreateRequest,
        response: { 200: schemas.skillDefinition },
      },
      async handler(req) {
        const { name, description, instructions } = req.body;
        const skill = await req.projectCtx!.projectManager.createSkill(name, description, instructions);
        return parseContract(schemas.skillDefinition, skill);
      },
    },
  );

  fastify.post<{ Params: { projectId: string }; Body: SkillInstallRequest }>(
    "/api/projects/:projectId/skills/install",
    {
      schema: {
        body: schemas.skillInstallRequest,
        response: { 200: schemas.skillDefinition },
      },
      async handler(req) {
        const { zipPath } = req.body;
        const skill = await req.projectCtx!.projectManager.installSkill(zipPath);
        return parseContract(schemas.skillDefinition, skill);
      },
    },
  );
}
