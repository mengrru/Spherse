import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { registerAgentRoutes } from "../routes/agents.js";
import type { FastifyRequest } from "fastify";
import type { ProjectRegistry } from "../registry.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { projectManager: unknown };
  }
}

const FULL_PROFILE = {
  id: "agent-1",
  name: "Demo",
  alias: "D",
  slug: "demo",
  createdAt: 1234567890,
  model: "gpt-x",
  schedule: true,
  tools: ["read_file"],
  context: ["docs/"],
  output: { path: "out", naming: "flat", frontmatter: { tag: "x" } },
  timePerception: { enabled: false, epochMs: 0, startMs: 0, flowRate: 1 },
  yolo: true,
  systemPrompt: "# long system prompt\n".repeat(500),
  filePath: "/tmp/p/.spherse/agents/demo/agent.md",
};

describe("GET /api/projects/:projectId/agents route", () => {
  let app: Fastify.FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = {
        projectManager: {
          listAgents: vi.fn().mockResolvedValue([FULL_PROFILE]),
          getAgentProfile: vi.fn().mockResolvedValue(FULL_PROFILE),
        },
      };
    });
    registerAgentRoutes(app, {} as ProjectRegistry);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns summaries without config fields on the list endpoint", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/agents" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: "agent-1",
        name: "Demo",
        alias: "D",
        slug: "demo",
        createdAt: 1234567890,
      },
    ]);
  });

  it("keeps full profile on the single-agent endpoint", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/agents/agent-1" });

    expect(res.statusCode).toBe(200);
    expect(res.json().systemPrompt).toBe(FULL_PROFILE.systemPrompt);
    expect(res.json().tools).toEqual(["read_file"]);
  });
});
