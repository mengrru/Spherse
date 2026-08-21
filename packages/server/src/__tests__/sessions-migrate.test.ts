import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyRequest } from "fastify";
import { registerSessionRoutes } from "../routes/sessions.js";
import type { ProjectRegistry } from "../registry.js";
import type { ChatSessionHub } from "../chat-session-hub.js";
import { NotFoundError } from "@spherse/core";

describe("POST .../sessions/:id/migrate route", () => {
  let app: Fastify.FastifyInstance;
  let migrateSession: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    migrateSession = vi.fn().mockReturnValue({
      sessionId: "s1",
      migrated: true,
      eventCount: 3,
    });
    app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
      return reply.code(500).send({ error: err.message });
    });
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = {
        projectManager: { migrateSession },
      } as never;
    });
    registerSessionRoutes(app, {} as ProjectRegistry, {} as ChatSessionHub);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("migrates the requested session and returns the result", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/agents/a1/sessions/s1/migrate",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sessionId: "s1", migrated: true, eventCount: 3 });
    expect(migrateSession).toHaveBeenCalledWith("a1", "s1");
  });

  it("returns the idempotent no-op result", async () => {
    migrateSession.mockReturnValue({ sessionId: "s1", migrated: false, eventCount: 3 });

    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/agents/a1/sessions/s1/migrate",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sessionId: "s1", migrated: false, eventCount: 3 });
  });

  it("returns 404 when the session does not exist", async () => {
    migrateSession.mockImplementation(() => {
      throw new NotFoundError("Session s1 not found");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/agents/a1/sessions/s1/migrate",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Session s1 not found" });
  });
});
