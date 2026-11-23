import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { createProject, NotFoundError, type ProjectRuntime, type Logger } from "@spherse/core";
import { registerSessionRoutes } from "../routes/sessions.js";
import type { ProjectRegistry } from "../registry.js";
import type { ProjectContextCompat } from "../registry.js";
import type { ChatSessionHub } from "../chat/index.js";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

const AGENT_PROFILE = `---
name: Status Agent
tools:
  - read_file
---

Status contract agent.`;

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: ProjectContextCompat;
  }
}

describe("session status contract: real SessionManager through the status route", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime;
  let app: FastifyInstance;
  let agentId: string;
  let sessionId: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-status-contract-"));
    runtime = await createProject(tmpDir, { projectName: "Contract", logger: silentLogger });
    const projectStore = runtime.projectManager.projectStore;
    const agent = await projectStore.createAgent("status-agent", AGENT_PROFILE);
    agentId = agent.getProfile().id;
    sessionId = await runtime.sessionRuntime.createSession(agentId);

    const agentStore = projectStore.agents.get(agentId) as unknown as {
      sessions: {
        appendEvents: (
          id: string,
          events: Array<{ type: string; seq: number; time: number; data: unknown }>,
          schemaVersion: number,
        ) => void;
      };
    };
    const now = Date.now();
    agentStore.sessions.appendEvents(
      sessionId,
      [
        {
          type: "user/message",
          seq: 0,
          time: now,
          data: { message: { role: "user", content: "hi", timestamp: now } },
        },
        {
          type: "assistant/message",
          seq: 1,
          time: now,
          data: {
            message: {
              role: "assistant",
              content: [{ type: "text", text: "hello" }],
              usage: { input: 100, output: 40, cacheRead: 300, cacheWrite: 50, totalTokens: 490 },
              timestamp: now,
            },
          },
        },
      ],
      1,
    );
    runtime.sessionRuntime.destroySession(sessionId);

    app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      return reply.code(500).send({ error: err.message });
    });
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = {
        runtime,
        projectId: "p1",
        get projectManager() {
          return runtime.projectManager;
        },
        get sessionRuntime() {
          return runtime.sessionRuntime;
        },
        get triggerManager() {
          return runtime.triggerManager;
        },
      } as ProjectContextCompat;
    });
    registerSessionRoutes(app, {} as ProjectRegistry, {} as ChatSessionHub);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    runtime.timerService.stop();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns turn stats derived by the real facade over persisted events", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/p1/agents/${agentId}/sessions/${sessionId}/status`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      currentTokens: 490,
      contextWindowLimit: null,
      cacheHitRate: 0.75,
      turnInputTokens: 100,
      turnCacheReadTokens: 300,
      turnCacheWriteTokens: 50,
      turnOutputTokens: 40,
      userMessageCount: 1,
      messageCount: 2,
    });
  });

  it("returns 404 for an unknown session without crashing", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/p1/agents/${agentId}/sessions/missing/status`,
    });
    expect(res.statusCode).toBe(404);
  });
});
