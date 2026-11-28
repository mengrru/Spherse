import { describe, expect, it } from "vitest";
import type { LightMyRequestResponse } from "light-my-request";
import Fastify, { type FastifyInstance } from "fastify";
import { buildMethodRegistry } from "../rpc/methods/registry.js";
import { registerRpcDebugGateway } from "../rpc/debug-gateway.js";
const silentLogger = {
  level: "silent",
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => silentLogger,
};

import { ChatSessionHub } from "@spherse/rpc/chat";
import { registerRpcMethodGroups } from "@spherse/rpc/host";
import { createHostContext } from "@spherse/core/host";
import { RpcAppError, type RpcContext } from "@spherse/rpc/host";
import { attachBusChannel } from "../bus/bus-channels.js";
import type { ProjectRegistry } from "../registry.js";

function buildApp(): FastifyInstance {
  const fastify = Fastify({ loggerInstance: silentLogger });
  const appHost = createHostContext();
  const methods = registerRpcMethodGroups(appHost, [buildMethodRegistry()]);
  const hub = new ChatSessionHub(silentLogger);
  const registry = { listInfo: () => [], getInfo: () => undefined } as unknown as ProjectRegistry;
  const ctx: RpcContext = {
    resolveProject(projectId: string) {
      throw new RpcAppError(100, `Unknown project: ${projectId}`);
    },
    registry,
    modelSettings: {
      sanitize: () => ({ models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } }, customProviders: [] }),
      apply: () => undefined,
    },
    authRequired: false,
    appVersion: null,
    hub,
    bus: {
      attach: () => ({ ok: false as const, error: "bus not available in debug gateway test" }),
    },
  };
  void attachBusChannel;
    registerRpcDebugGateway(fastify, methods, ctx);
  return fastify;
}

async function call(app: FastifyInstance, body: unknown): Promise<LightMyRequestResponse> {
  return app.inject({ method: "POST", url: "/api/rpc-debug", payload: body as object });
}

describe("rpc debug gateway", () => {
  it("returns method data for curl-style calls", async () => {
    const app = buildApp();
    const res = await call(app, { method: "connection.info", params: {} });
    expect(res.statusCode).toBe(200);
    const data = res.json() as { authRequired: boolean; apiVersion: string };
    expect(data.authRequired).toBe(false);
    expect(data.apiVersion).toBe("1");
    await app.close();
  });

  it("maps rpc errors to 400 with code", async () => {
    const app = buildApp();
    const res = await call(app, { method: "agents.list", params: { projectId: "missing" } });
    expect(res.statusCode).toBe(400);
    const data = res.json() as { code: number; error: string };
    expect(data.code).toBe(100);
    expect(data.error).toContain("Unknown project");
    await app.close();
  });

  it("rejects malformed bodies", async () => {
    const app = buildApp();
    const res = await call(app, {});
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain("method");
    await app.close();
  });

  it("reports unknown methods as invalid params", async () => {
    const app = buildApp();
    const res = await call(app, { method: "nope.nope", params: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

