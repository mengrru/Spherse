import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { createProject, MemoryStore, type ProjectRuntime, type Logger } from "@spherse/core";
import { registerAgentMemoryRoutes } from "../routes/agent-memory.js";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { projectManager: import("@spherse/core").ProjectManager; runtime: ProjectRuntime };
  }
}

describe("agent memory contract: real runtime through real routes", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime;
  let app: FastifyInstance;
  let agentId: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-memory-contract-"));
    runtime = await createProject(tmpDir, { projectName: "MemoryContract", logger: silentLogger });

    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { projectManager: runtime.projectManager, runtime };
    });
    registerAgentMemoryRoutes(app);
    await app.ready();

    const profile = await runtime.projectManager.createAgent(
      "mem-agent",
      "---\nname: Mem Agent\n---\n\nBody.",
    );
    agentId = profile.id;
  });

  afterAll(async () => {
    await app.close();
    runtime.timerService.stop();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET memory returns disabled with empty core by default", async () => {
    const res = await app.inject({ method: "GET", url: `/api/projects/p1/agents/${agentId}/memory` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false, core: "", coreLimit: 4000 });
  });

  it("PUT memory enables memory and saves core, persisting to profile and memory dir", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/p1/agents/${agentId}/memory`,
      payload: { enabled: true, core: "user prefers concise answers" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true, core: "user prefers concise answers", coreLimit: 4000 });

    const profile = runtime.projectManager.getAgentProfile(agentId);
    expect(profile?.memory).toEqual({ enabled: true });
    const agentDir = path.dirname(profile!.filePath);
    expect(fs.readFileSync(path.join(agentDir, "memory", "core.md"), "utf-8")).toBe(
      "user prefers concise answers",
    );
  });

  it("PUT memory over-limit core returns 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/p1/agents/${agentId}/memory`,
      payload: { core: "x".repeat(4001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("entries CRUD through the routes", async () => {
    const profile = runtime.projectManager.getAgentProfile(agentId)!;
    const seeding = new MemoryStore(path.dirname(profile.filePath));
    const created = seeding.save("用户喜欢绿茶", ["偏好"]);
    seeding.close();

    const list = await app.inject({
      method: "GET",
      url: `/api/projects/p1/agents/${agentId}/memory/entries`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().entries).toHaveLength(1);
    expect(list.json().entries[0]).toMatchObject({ content: "用户喜欢绿茶", tags: ["偏好"] });

    const search = await app.inject({
      method: "GET",
      url: `/api/projects/p1/agents/${agentId}/memory/entries?q=${encodeURIComponent("绿茶")}`,
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().entries).toHaveLength(1);

    const updated = await app.inject({
      method: "PUT",
      url: `/api/projects/p1/agents/${agentId}/memory/entries/${created.id}`,
      payload: { content: "用户改喝红茶了", tags: ["偏好"] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: created.id, content: "用户改喝红茶了" });

    const missing = await app.inject({
      method: "PUT",
      url: `/api/projects/p1/agents/${agentId}/memory/entries/no-such-id`,
      payload: { content: "x" },
    });
    expect(missing.statusCode).toBe(404);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/projects/p1/agents/${agentId}/memory/entries/${created.id}`,
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ ok: true });

    const afterDelete = await app.inject({
      method: "GET",
      url: `/api/projects/p1/agents/${agentId}/memory/entries`,
    });
    expect(afterDelete.json().entries).toHaveLength(0);
  });

  it("GET memory for unknown agent returns 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/agents/nope/memory" });
    expect(res.statusCode).toBe(404);
  });
});
