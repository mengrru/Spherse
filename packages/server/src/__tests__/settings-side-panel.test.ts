import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { createProject } from "@spherse/core";
import { registerSettingsRoutes } from "../routes/settings.js";
import type { ProjectRegistry } from "../registry.js";
import { createSilentLoggerForTests } from "./test-logger.js";

describe("side-panel settings routes", () => {
  let tmpDir: string;
  let app: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-side-panel-"));
    const runtime = await createProject(tmpDir, { logger: createSilentLoggerForTests() });
    projectId = runtime.projectId;
    const registry = {
      get: (id: string) => (id === projectId ? { runtime, projectId, projectManager: runtime.projectManager } : undefined),
    } as unknown as ProjectRegistry;
    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      const id = (req.params as Record<string, string> | undefined)?.projectId;
      if (id === undefined) return;
      const ctx = registry.get(id);
      if (!ctx) throw new Error("Unknown project");
      req.projectCtx = ctx;
    });
    registerSettingsRoutes(app, registry);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET returns null path by default", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/settings/side-panel`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, path: null });
  });

  it("PUT persists a valid path to project.yaml", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/settings/side-panel`,
      payload: { path: "panel/index.html" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, path: "panel/index.html" });

    const yaml = fs.readFileSync(path.join(tmpDir, ".spherse", "project.yaml"), "utf-8");
    expect(yaml).toContain("sidePanel");
    expect(yaml).toContain("panel/index.html");

    const get = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/settings/side-panel`,
    });
    expect(get.json()).toEqual({ ok: true, path: "panel/index.html" });
  });

  it("PUT rejects an invalid path", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/settings/side-panel`,
      payload: { path: "poster.png" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("PUT null clears the path", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/settings/side-panel`,
      payload: { path: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, path: null });
  });
});
