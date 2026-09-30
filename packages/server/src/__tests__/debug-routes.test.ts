import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { registerDebugRoutes } from "../routes/debug.js";
import { HttpError } from "../errors.js";
import type { ProjectRegistry } from "../registry.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { sessionRuntime: unknown };
  }
}

function createRuntime() {
  const sessionRuntime = {
    getTurnContext: vi.fn(() => ({
      sessionId: "s1",
      capturedAt: "2024-01-01T00:00:00.000Z",
      systemPrompt: "p",
      messages: [],
      tools: [],
    })),
    readSessionEventsAfter: vi.fn(() => [
      { seq: 0, type: "user/message", time: 1, data: { message: { role: "user" } } },
      { seq: 1, type: "turn/start", time: 1, data: {} },
    ]),
  };
  return { sessionRuntime };
}

describe("debug routes", () => {
  let app: FastifyInstance;
  let runtime: ReturnType<typeof createRuntime>;

  beforeEach(async () => {
    runtime = createRuntime();
    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { sessionRuntime: runtime.sessionRuntime };
    });
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
      reply.code(500).send({ error: err.message });
    });
    registerDebugRoutes(app, {} as ProjectRegistry);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns the full event log for the session", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/p1/debug/sessions/s1/events?agentId=a1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      sessionId: "s1",
      events: [
        { seq: 0, type: "user/message", time: 1, data: { message: { role: "user" } } },
        { seq: 1, type: "turn/start", time: 1, data: {} },
      ],
    });
    expect(runtime.sessionRuntime.readSessionEventsAfter).toHaveBeenCalledWith(
      "a1",
      "s1",
      -1,
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("responds 400 when agentId is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/p1/debug/sessions/s1/events",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "agentId is required" });
  });
});
