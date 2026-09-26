import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { registerSessionRoutes } from "../routes/sessions.js";
import type { FastifyRequest } from "fastify";
import type { ProjectRegistry } from "../registry.js";
import type { ChatSessionHub } from "../chat/chat-session-hub.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { projectManager: unknown };
  }
}

function hit(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    agentId: "a1",
    sessionId: "s1",
    sessionTitle: "session",
    seq: 3,
    role: "user",
    snippet: "…needle…",
    time: 100,
    ...overrides,
  };
}

describe("GET /api/projects/:projectId/sessions/search route", () => {
  let app: Fastify.FastifyInstance;
  let searchProjectMessages: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    searchProjectMessages = vi.fn().mockReturnValue([hit()]);
    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { projectManager: { searchProjectMessages } };
    });
    registerSessionRoutes(app, {} as ProjectRegistry, {} as ChatSessionHub);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("passes q and default limit to the manager", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/p1/sessions/search?q=needle",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ results: [hit()] });
    expect(searchProjectMessages).toHaveBeenCalledWith("needle", 50);
  });

  it("returns empty results without calling the manager for blank q", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/p1/sessions/search?q=%20%20",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ results: [] });
    expect(searchProjectMessages).not.toHaveBeenCalled();
  });

  it("clamps limit to [1, 100]", async () => {
    await app.inject({ method: "GET", url: "/api/projects/p1/sessions/search?q=a&limit=500" });
    expect(searchProjectMessages).toHaveBeenLastCalledWith("a", 100);

    await app.inject({ method: "GET", url: "/api/projects/p1/sessions/search?q=a&limit=0" });
    expect(searchProjectMessages).toHaveBeenLastCalledWith("a", 1);

    await app.inject({ method: "GET", url: "/api/projects/p1/sessions/search?q=a&limit=garbage" });
    expect(searchProjectMessages).toHaveBeenLastCalledWith("a", 50);
  });

  it("maps null session titles to undefined so the contract parses", async () => {
    searchProjectMessages.mockReturnValue([
      hit({ sessionTitle: undefined, snippet: "needle" }),
    ]);
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/p1/sessions/search?q=needle",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      results: [{ agentId: "a1", sessionId: "s1", seq: 3, role: "user", snippet: "needle", time: 100 }],
    });
  });
});
