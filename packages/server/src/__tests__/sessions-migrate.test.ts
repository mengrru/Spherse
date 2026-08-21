import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyRequest } from "fastify";
import { registerSessionRoutes } from "../routes/sessions.js";
import type { ProjectRegistry } from "../registry.js";
import type { ChatSessionHub } from "../chat-session-hub.js";

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
});
