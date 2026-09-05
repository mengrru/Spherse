import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { NotFoundError, ConflictError } from "@spherse/core";
import { registerSessionRoutes } from "../routes/sessions.js";
import { ChatSessionHub } from "../chat/chat-session-hub.js";
import type { FastifyRequest } from "fastify";
import type { ProjectRegistry } from "../registry.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { sessionRuntime: unknown };
  }
}

function createRuntime() {
  let emit: ((event: any) => void) | undefined;
  let finish: (() => void) | undefined;
  const runtime = {
    restoreSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(
      (_sessionId: string, _content: string, _attachments: unknown, onEvent: (event: any) => void) => {
        emit = onEvent;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    ),
    abortSession: vi.fn(),
    resolveControlRequest: vi.fn(),
    destroySession: vi.fn(),
    subscribeSessionEvents: vi.fn(() => () => {}),
    readSessionEventsAfter: vi.fn(() => []),
    getSessionLastSeq: vi.fn(() => -1),
  };
  return {
    runtime,
    emit: (event: any) => emit?.(event),
    finish: () => finish?.(),
  };
}

const hubLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("POST .../sessions/:id/messages route", () => {
  let app: Fastify.FastifyInstance;
  let mock: ReturnType<typeof createRuntime>;
  let hub: ChatSessionHub;

  beforeEach(async () => {
    mock = createRuntime();
    hub = new ChatSessionHub(hubLogger as never);
    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { sessionRuntime: mock.runtime };
    });
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
      if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
      reply.code(500).send({ error: err.message });
    });
    registerSessionRoutes(app, {} as ProjectRegistry, hub);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("starts a detached run and responds ok without waiting for the run", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/agents/a1/sessions/s1/messages",
      payload: { content: "hi" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith("s1", "hi", [], expect.any(Function));
    expect(mock.runtime.destroySession).not.toHaveBeenCalled();

    mock.emit({ type: "agent_end", messages: [] });
    mock.finish();
    await vi.waitFor(() => expect(mock.runtime.destroySession).toHaveBeenCalledWith("s1"));
  });

  it("responds 409 when the session is already running", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/projects/p1/agents/a1/sessions/s1/messages",
      payload: { content: "first" },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/projects/p1/agents/a1/sessions/s1/messages",
      payload: { content: "second" },
    });

    expect(second.statusCode).toBe(409);
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1);

    mock.finish();
  });

  it("responds 404 when restoreSession rejects NotFoundError", async () => {
    mock.runtime.restoreSession.mockRejectedValue(new NotFoundError("Session s1 not found"));

    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/agents/a1/sessions/s1/messages",
      payload: { content: "hi" },
    });

    expect(res.statusCode).toBe(404);
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("shares the channel with ws subscribers — events fan out to an attached listener", async () => {
    const events: any[] = [];
    const attachment = hub.attach("p1", mock.runtime as never, "a1", "s1", (event) =>
      events.push(event),
    );
    await attachment.ready;
    events.length = 0;

    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/agents/a1/sessions/s1/messages",
      payload: { content: "hi" },
    });
    expect(res.statusCode).toBe(200);

    await vi.waitFor(() => expect(events).toContainEqual({ type: "run_status", active: true }));
    mock.emit({ type: "agent_end", messages: [] });
    mock.finish();
    await vi.waitFor(() => expect(events).toContainEqual({ type: "run_status", active: false }));
    expect(mock.runtime.restoreSession).toHaveBeenCalledTimes(1);
    attachment.close();
  });
});
