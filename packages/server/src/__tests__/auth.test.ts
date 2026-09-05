import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuthHook } from "../middlewares/auth.js";

function buildApp(token?: string): FastifyInstance {
  const app = Fastify();
  registerAuthHook(app, token ? { accessToken: token } : {});
  app.get("/health", async () => ({ ok: true }));
  app.get("/api/foo", async () => ({ ok: true }));
  app.get("/api/connection/info", async () => ({ serverVersion: "0.1.0", authRequired: true, apiVersion: "1" }));
  app.get("/api/projects/:projectId/preview/__auth/:token/*", async () => ({ ok: true }));
  app.get("/ws/foo", { websocket: true }, () => undefined);
  return app;
}

describe("registerAuthHook", () => {
  describe("when no access token is configured", () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = buildApp();
      await app.ready();
    });
    afterAll(async () => { await app.close(); });

    it("allows /api/* without Authorization header", async () => {
      const res = await app.inject({ method: "GET", url: "/api/foo" });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("when access token is configured", () => {
    const TOKEN = "secret-token-123";
    let app: FastifyInstance;
    beforeAll(async () => {
      app = buildApp(TOKEN);
      await app.ready();
    });
    afterAll(async () => { await app.close(); });

    it("allows /health without token", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
    });

    it("rejects /api/* without Authorization header (401)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/foo" });
      expect(res.statusCode).toBe(401);
    });

    it("rejects /api/* with wrong Bearer token (401)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/foo",
        headers: { authorization: "Bearer wrong-token" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("allows /api/* with correct Bearer token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/foo",
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("allows /api/* with ?token= query fallback (for img/link/iframe)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/foo?token=${encodeURIComponent(TOKEN)}`,
      });
      expect(res.statusCode).toBe(200);
    });

    it("rejects /api/* with both header and query but neither match", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/foo?token=wrong`,
        headers: { authorization: "Bearer also-wrong" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("prefers Authorization header over query token when both present", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/foo?token=wrong`,
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("allows /api/connection/info without token (mobile pre-flight)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/connection/info" });
      expect(res.statusCode).toBe(200);
    });

    it("rejects /ws/* without ?token= query", async () => {
      const res = await app.inject({ method: "GET", url: "/ws/foo" });
      expect(res.statusCode).toBe(401);
    });

    it("rejects /ws/* with wrong ?token= query", async () => {
      const res = await app.inject({ method: "GET", url: "/ws/foo?token=wrong" });
      expect(res.statusCode).toBe(401);
    });

    it("allows /api/preview/__auth/<token>/<file> with path-based token", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/p1/preview/__auth/${TOKEN}/icon.svg`,
      });
      expect(res.statusCode).toBe(200);
    });

    it("rejects /api/preview/__auth/<wrong-token>/<file>", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/p1/preview/__auth/wrong-token/icon.svg`,
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
