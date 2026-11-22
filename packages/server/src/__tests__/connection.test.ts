import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerConnectionRoutes } from "../routes/connection.js";
import { setAppVersion } from "../server-info.js";
import type { ProjectRegistry } from "../registry.js";

describe("connection routes", () => {
  describe("GET /api/connection/info with app version", () => {
    afterEach(() => {
      setAppVersion(undefined);
    });

    it("returns null appVersion when not provided by the host", async () => {
      const app = Fastify();
      registerConnectionRoutes(app, {} as unknown as ProjectRegistry, { authRequired: true });
      await app.ready();
      try {
        const res = await app.inject({ method: "GET", url: "/api/connection/info" });
        expect(JSON.parse(res.body).appVersion).toBeNull();
      } finally {
        await app.close();
      }
    });
  });
});
