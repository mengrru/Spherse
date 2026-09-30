import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { PushStore } from "../push/push-store.js";
import { registerPushRoutes } from "../routes/push.js";
import { registerConnectionRoutes } from "../routes/connection.js";
import { registerAuthHook } from "../middlewares/auth.js";
import { ProjectRegistry } from "../registry.js";

const TOKEN = "test-token-123";

describe("push routes contract", () => {
  let tmpDir: string;
  let store: PushStore;
  let app: FastifyInstance;
  let noPushApp: FastifyInstance;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-push-routes-"));
    store = new PushStore(path.join(tmpDir, "push-storage.json"));

    app = Fastify();
    registerAuthHook(app, { accessToken: TOKEN });
    registerPushRoutes(app, { store });
    await app.ready();

    noPushApp = Fastify();
    registerAuthHook(noPushApp, { accessToken: TOKEN });
    registerConnectionRoutes(noPushApp, new ProjectRegistry(console as never) as never, { authRequired: true });
    await noPushApp.ready();
  });

  afterAll(async () => {
    await app.close();
    await noPushApp.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const validBody = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    keys: { p256dh: "dh-key", auth: "auth-key" },
    locale: "zh-CN",
  };

  it("rejects subscribe without token", async () => {
    const res = await app.inject({ method: "POST", url: "/api/push/subscribe", payload: validBody });
    expect(res.statusCode).toBe(401);
  });

  it("rejects invalid subscribe body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/push/subscribe",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { endpoint: "https://x", keys: {}, locale: "zh-CN" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("subscribes and upserts idempotently", async () => {
    const headers = { authorization: `Bearer ${TOKEN}` };
    const first = await app.inject({ method: "POST", url: "/api/push/subscribe", headers, payload: validBody });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true });

    const second = await app.inject({
      method: "POST",
      url: "/api/push/subscribe",
      headers,
      payload: { ...validBody, locale: "en" },
    });
    expect(second.statusCode).toBe(200);
    await store.flush();

    const subs = store.list();
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ endpoint: validBody.endpoint, locale: "en" });
  });

  it("unsubscribes idempotently", async () => {
    const headers = { authorization: `Bearer ${TOKEN}` };
    const res = await app.inject({
      method: "POST",
      url: "/api/push/unsubscribe",
      headers,
      payload: { endpoint: validBody.endpoint },
    });
    expect(res.statusCode).toBe(200);
    expect(store.list()).toHaveLength(0);

    const again = await app.inject({
      method: "POST",
      url: "/api/push/unsubscribe",
      headers,
      payload: { endpoint: "https://missing.example" },
    });
    expect(again.statusCode).toBe(200);
    await store.flush();
  });

  it("connection info omits push field when push store is absent", async () => {
    const res = await noPushApp.inject({ method: "GET", url: "/api/connection/info" });
    expect(res.statusCode).toBe(200);
    expect(res.json().push).toBeUndefined();
  });

  it("connection info exposes push publicKey when push store is present", async () => {
    const withPush = Fastify();
    registerConnectionRoutes(withPush, new ProjectRegistry(console as never) as never, {
      authRequired: true,
      pushStore: store,
    });
    await withPush.ready();
    try {
      const res = await withPush.inject({ method: "GET", url: "/api/connection/info" });
      expect(res.statusCode).toBe(200);
      expect(typeof res.json().push?.publicKey).toBe("string");
      await store.flush();
    } finally {
      await withPush.close();
    }
  });
});
