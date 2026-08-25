import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { registerSkillRoutes } from "../routes/skills.js";
import type { FastifyRequest } from "fastify";
import type { ProjectRegistry } from "../registry.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { projectManager: unknown };
  }
}

const FULL_SKILL = {
  name: "demo",
  description: "Demo skill",
  instructions: "# long instruction body\n".repeat(500),
  filePath: "/tmp/p/.spherse/skills/demo/SKILL.md",
  source: "project",
  files: ["helper.ts"],
  version: "1.0.0",
};

describe("GET /api/projects/:projectId/skills route", () => {
  let app: Fastify.FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = {
        projectManager: {
          listSkills: vi.fn().mockResolvedValue([FULL_SKILL]),
          getSkill: vi.fn().mockResolvedValue(FULL_SKILL),
        },
      };
    });
    registerSkillRoutes(app, {} as ProjectRegistry);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("strips instructions from the list response", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual([
      {
        name: "demo",
        description: "Demo skill",
        filePath: "/tmp/p/.spherse/skills/demo/SKILL.md",
        source: "project",
        files: ["helper.ts"],
        version: "1.0.0",
      },
    ]);
  });

  it("keeps instructions on the single-skill endpoint", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/skills/demo" });

    expect(res.statusCode).toBe(200);
    expect(res.json().instructions).toBe(FULL_SKILL.instructions);
  });
});
