import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { registerSessionRoutes } from "../routes/sessions.js";
import type { FastifyRequest } from "fastify";
import type { ProjectRegistry } from "../registry.js";
import type { ChatSessionHub } from "../chat-session-hub.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { projectManager: unknown };
  }
}

function session(id: string, agentId: string, updatedAt: number) {
  return { id, agentId, createdAt: updatedAt - 1, updatedAt, status: "active" };
}

describe("GET /api/projects/:projectId/sessions route", () => {
  let app: Fastify.FastifyInstance;
  let listProjectSessions: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    listProjectSessions = vi.fn().mockReturnValue({
      sessions: [session("s2", "a2", 20), session("s1", "a1", 10)],
      byAgent: {
        a1: { hasMore: false, loaded: 1 },
        a2: { hasMore: true, loaded: 1 },
      },
    });
    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { projectManager: { listProjectSessions } };
    });
    registerSessionRoutes(app, {} as ProjectRegistry, {} as ChatSessionHub);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns the merged catalog with byAgent cursors", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/sessions" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      sessions: [session("s2", "a2", 20), session("s1", "a1", 10)],
      byAgent: {
        a1: { hasMore: false, loaded: 1 },
        a2: { hasMore: true, loaded: 1 },
      },
    });
    expect(listProjectSessions).toHaveBeenCalledWith(10);
  });

  it("passes perPage through and clamps it to [1, 100]", async () => {
    await app.inject({ method: "GET", url: "/api/projects/p1/sessions?perPage=25" });
    expect(listProjectSessions).toHaveBeenLastCalledWith(25);

    await app.inject({ method: "GET", url: "/api/projects/p1/sessions?perPage=0" });
    expect(listProjectSessions).toHaveBeenLastCalledWith(1);

    await app.inject({ method: "GET", url: "/api/projects/p1/sessions?perPage=500" });
    expect(listProjectSessions).toHaveBeenLastCalledWith(100);

    await app.inject({ method: "GET", url: "/api/projects/p1/sessions?perPage=garbage" });
    expect(listProjectSessions).toHaveBeenLastCalledWith(10);
  });
});
