import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { registerSessionRoutes } from "../routes/sessions.js";
import type { FastifyRequest } from "fastify";
import type { ProjectRegistry } from "../registry.js";
import type { ChatSessionHub } from "../chat/chat-session-hub.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { sessionRuntime: unknown };
  }
}

describe("POST .../agents/:agentId/sessions route", () => {
  let app: Fastify.FastifyInstance;
  let createSession: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    createSession = vi.fn().mockResolvedValue("session-new");
    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { sessionRuntime: { createSession } };
    });
    registerSessionRoutes(app, {} as ProjectRegistry, {} as ChatSessionHub);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("creates a session without a body and responds with sessionId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/agents/a1/sessions",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sessionId: "session-new" });
    expect(createSession).toHaveBeenCalledWith("a1", undefined, undefined);
  });

  it("creates a session with an empty object body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/agents/a1/sessions",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(createSession).toHaveBeenCalledWith("a1", undefined, undefined);
  });

  it("passes the request title through to sessionRuntime.createSession", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/agents/a1/sessions",
      payload: { title: "Trip Plan" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sessionId: "session-new" });
    expect(createSession).toHaveBeenCalledWith("a1", undefined, "Trip Plan");
  });

  it("rejects an empty title with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/agents/a1/sessions",
      payload: { title: "" },
    });

    expect(res.statusCode).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects a non-string title with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/agents/a1/sessions",
      payload: { title: { nope: true } },
    });

    expect(res.statusCode).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });
});
