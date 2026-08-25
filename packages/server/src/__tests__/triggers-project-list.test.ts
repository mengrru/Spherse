import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { registerTriggerRoutes } from "../routes/trigger.js";
import type { FastifyRequest } from "fastify";
import type { ProjectRegistry } from "../registry.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { triggerManager: unknown };
  }
}

describe("GET /api/projects/:projectId/triggers route", () => {
  let app: Fastify.FastifyInstance;
  let listProject: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    listProject = vi.fn().mockReturnValue([
      {
        agentId: "a1",
        entry: {
          id: "t1",
          enabled: true,
          type: "time",
          cron: "0 9 * * *",
          mode: "new_session",
          message: "hello",
          notify: false,
          createdAt: 1,
          updatedAt: 1,
        },
        nextTriggerAt: new Date("2026-08-27T01:00:00.000Z"),
      },
      {
        agentId: "a2",
        entry: {
          id: "t2",
          enabled: true,
          type: "event",
          eventName: "evt",
          mode: "new_session",
          message: "hi",
          notify: false,
          createdAt: 1,
          updatedAt: 1,
        },
        nextTriggerAt: null,
      },
    ]);
    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { triggerManager: { listProject } };
    });
    registerTriggerRoutes(app, {} as ProjectRegistry);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns the merged project trigger list with agentId and nextTriggerAt", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/triggers" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.triggers).toEqual([
      {
        agentId: "a1",
        id: "t1",
        enabled: true,
        type: "time",
        cron: "0 9 * * *",
        mode: "new_session",
        message: "hello",
        notify: false,
        createdAt: 1,
        updatedAt: 1,
        nextTriggerAt: Date.parse("2026-08-27T01:00:00.000Z"),
      },
      {
        agentId: "a2",
        id: "t2",
        enabled: true,
        type: "event",
        eventName: "evt",
        mode: "new_session",
        message: "hi",
        notify: false,
        createdAt: 1,
        updatedAt: 1,
        nextTriggerAt: null,
      },
    ]);
    expect(listProject).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list for projects without triggers", async () => {
    listProject.mockReturnValue([]);
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/triggers" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, triggers: [] });
  });
});
