import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerConnectionRoutes } from "../routes/connection.js";
import { setAppVersion } from "../server-info.js";
import type { ProjectRegistry, ProjectInfo } from "../registry.js";

function buildRegistry(
  entries: Array<{ id: string; rootPath: string; lastOpened?: string }>,
): ProjectRegistry {
  const infos: ProjectInfo[] = entries.map((e) => ({
    id: e.id,
    rootPath: e.rootPath,
    name: e.rootPath.split("/").pop() ?? e.rootPath,
    lastOpened: e.lastOpened,
  }));
  return {
    listInfo: () => infos,
    getInfo: (id: string) => infos.find((i) => i.id === id),
  } as unknown as ProjectRegistry;
}

function buildApp(registry: ProjectRegistry, authRequired: boolean): FastifyInstance {
  const app = Fastify();
  registerConnectionRoutes(app, registry, { authRequired });
  return app;
}

describe("connection routes", () => {
  describe("GET /api/connection/info", () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = buildApp(buildRegistry([]), true);
      await app.ready();
    });
    afterAll(async () => { await app.close(); });

    it("returns server version and authRequired flag", async () => {
      const res = await app.inject({ method: "GET", url: "/api/connection/info" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({ authRequired: true });
      expect(typeof body.serverVersion).toBe("string");
      expect(typeof body.apiVersion).toBe("string");
    });

    it("returns null appVersion when not provided by the host", async () => {
      const res = await app.inject({ method: "GET", url: "/api/connection/info" });
      expect(JSON.parse(res.body).appVersion).toBeNull();
    });
  });

  describe("GET /api/connection/info with app version", () => {
    afterEach(() => {
      setAppVersion(undefined);
    });

    it("exposes the host app version", async () => {
      setAppVersion("1.2.3");
      const app = buildApp(buildRegistry([]), false);
      await app.ready();
      try {
        const res = await app.inject({ method: "GET", url: "/api/connection/info" });
        expect(JSON.parse(res.body).appVersion).toBe("1.2.3");
      } finally {
        await app.close();
      }
    });
  });

  describe("GET /api/projects", () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = buildApp(buildRegistry([
        { id: "p1", rootPath: "/home/user/project-a" },
        { id: "p2", rootPath: "/home/user/project-b" },
      ]), false);
      await app.ready();
    });
    afterAll(async () => { await app.close(); });

    it("returns project list with id, name, and lastOpened", async () => {
      const res = await app.inject({ method: "GET", url: "/api/projects" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toEqual([
        { id: "p1", name: "project-a" },
        { id: "p2", name: "project-b" },
      ]);
    });
  });

  describe("GET /api/projects/:projectId/info", () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = buildApp(buildRegistry([
        { id: "p1", rootPath: "/home/user/project-a" },
      ]), false);
      await app.ready();
    });
    afterAll(async () => { await app.close(); });

    it("returns full info for a known project", async () => {
      const res = await app.inject({ method: "GET", url: "/api/projects/p1/info" });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        id: "p1",
        name: "project-a",
        rootPath: "/home/user/project-a",
      });
    });

    it("returns 404 for an unknown project", async () => {
      const res = await app.inject({ method: "GET", url: "/api/projects/unknown/info" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/projects with lastOpened", () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = buildApp(buildRegistry([
        { id: "p1", rootPath: "/home/user/project-a", lastOpened: "2026-01-01T00:00:00.000Z" },
        { id: "p2", rootPath: "/home/user/project-b", lastOpened: "2026-02-01T00:00:00.000Z" },
      ]), false);
      await app.ready();
    });
    afterAll(async () => { await app.close(); });

    it("includes lastOpened in the list response", async () => {
      const res = await app.inject({ method: "GET", url: "/api/projects" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toEqual([
        { id: "p1", name: "project-a", lastOpened: "2026-01-01T00:00:00.000Z" },
        { id: "p2", name: "project-b", lastOpened: "2026-02-01T00:00:00.000Z" },
      ]);
    });

    it("includes lastOpened in the info response", async () => {
      const res = await app.inject({ method: "GET", url: "/api/projects/p1/info" });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        id: "p1",
        name: "project-a",
        rootPath: "/home/user/project-a",
        lastOpened: "2026-01-01T00:00:00.000Z",
      });
    });
  });
});
