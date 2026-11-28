import type { FastifyInstance } from "fastify";
import { RpcAppError, RpcConnectionHandler, RpcDispatcher, type RpcBusSource, type RpcContext } from "@spherse/rpc/host";
import { RpcErrorCode } from "@spherse/contracts";
import type { ProjectRegistry } from "../registry.js";
import type { ChatSessionHub } from "../chat/index.js";
import type { ModelSettingsStore } from "../model-settings.js";
import type { ModelCatalog, HostContext } from "@spherse/core";
import { getAppVersion } from "../server-info.js";
import { buildMethodRegistry } from "./methods/registry.js";
import { registerRpcMethodGroups } from "@spherse/rpc/host";
import { createRpcModelSettings } from "./model-settings-port.js";
import { attachBusChannel } from "../bus/bus-channels.js";
import { registerRpcDebugGateway } from "./debug-gateway.js";

export interface RpcServerOptions {
  modelSettingsStore: ModelSettingsStore;
  modelCatalog: ModelCatalog;
  authRequired: boolean;
}

export function handleRpcWebSocket(
  fastify: FastifyInstance,
  registry: ProjectRegistry,
  hub: ChatSessionHub,
  appHost: HostContext,
  options: RpcServerOptions,
): void {
  const methods = registerRpcMethodGroups(appHost, [buildMethodRegistry()]);
  const bus: RpcBusSource = {
    attach: (projectId, channel, emit) =>
      attachBusChannel(
        registry,
        projectId,
        channel as Parameters<typeof attachBusChannel>[2],
        (type, payload) => emit({ type, payload }),
        fastify.log,
      ),
  };
  const ctx: RpcContext = {
    resolveProject(projectId: string) {
      const project = registry.get(projectId);
      if (!project) throw new RpcAppError(RpcErrorCode.AppNotFound, "Unknown project");
      return project;
    },
    registry,
    modelSettings: createRpcModelSettings(
      options.modelSettingsStore,
      options.modelCatalog,
      registry,
    ),
    authRequired: options.authRequired,
    appVersion: getAppVersion() ?? null,
    hub,
    bus,
  };
  if (process.env.NODE_ENV !== "production" || process.env.SPHERSE_RPC_DEBUG === "1") {
    registerRpcDebugGateway(fastify, methods, ctx);
  }
  fastify.get("/ws/rpc", { websocket: true }, (socket) => {
    const dispatcher = new RpcDispatcher({ methods, ctx, logger: fastify.log });
    const handler = new RpcConnectionHandler(socket, dispatcher, hub, ctx, fastify.log);
    socket.on("message", (raw: Buffer) => handler.onMessage(raw));
    socket.on("close", () => handler.onClose());
    socket.on("error", () => handler.onClose());
  });
}
