import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { createProject, type ProjectRuntime, type Logger, type SessionChangePayload } from "@spherse/core";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
};
import { registerSessionRoutes } from "../routes/sessions.js";
import type { ProjectRegistry } from "../registry.js";
import type { ChatSessionHub } from "../chat/chat-session-hub.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { runtime: ProjectRuntime; projectManager: ProjectRuntime["projectManager"]; sessionRuntime: ProjectRuntime["sessionRuntime"] };
  }
}

describe("session change event contract: real runtime through real routes", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime;
  let app: FastifyInstance;
  let agentId: string;
  let sessionId: string;
  const events: SessionChangePayload[] = [];

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-session-events-"));
    runtime = await createProject(tmpDir, { projectName: "Contract", logger: silentLogger });
    agentId = (await runtime.projectManager.createAgent(undefined, "---\nname: Contract Agent\n---\nbody")).id;
    runtime.projectManager.onSessionChange((payload) => events.push(payload));

    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = {
        runtime,
        projectManager: runtime.projectManager,
        sessionRuntime: runtime.sessionRuntime,
      };
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

  it("POST create broadcasts session_updated created", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/p1/agents/${agentId}/sessions`,
      payload: { title: "Trip Plan" },
    });
    expect(res.statusCode).toBe(200);
    sessionId = (res.json() as { sessionId: string }).sessionId;

    expect(events).toContainEqual({ agentId, sessionId, action: "created" });
  });

  it("PATCH rename broadcasts session_updated updated", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/p1/agents/${agentId}/sessions/${sessionId}`,
      payload: { title: "Renamed" },
    });
    expect(res.statusCode).toBe(200);

    expect(events).toContainEqual({ agentId, sessionId, action: "updated" });
  });

  it("DELETE broadcasts session_updated deleted", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/p1/agents/${agentId}/sessions/${sessionId}`,
    });
    expect(res.statusCode).toBe(200);

    expect(events).toContainEqual({ agentId, sessionId, action: "deleted" });
  });
});
