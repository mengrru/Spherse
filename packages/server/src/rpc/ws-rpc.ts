import type { FastifyInstance } from "fastify";
import { RpcAppError, RpcConnectionHandler, RpcDispatcher, type RpcContext } from "@spherse/rpc/host";
import { RpcErrorCode } from "@spherse/contracts";
import type { ProjectRegistry } from "../registry.js";
import type { ChatSessionHub } from "../chat/index.js";
import type { ModelSettingsStore } from "../model-settings.js";
import type { ModelCatalog } from "@spherse/core";
import { getAppVersion } from "../server-info.js";
import { buildMethodRegistry } from "./methods/registry.js";
import { createRpcModelSettings } from "./model-settings-port.js";

export interface RpcServerOptions {
  modelSettingsStore: ModelSettingsStore;
  modelCatalog: ModelCatalog;
  authRequired: boolean;
}

export function handleRpcWebSocket(
  fastify: FastifyInstance,
  registry: ProjectRegistry,
  hub: ChatSessionHub,
  options: RpcServerOptions,
): void {
  const methods = buildMethodRegistry();
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
  };
  fastify.get("/ws/rpc", { websocket: true }, (socket) => {
    const dispatcher = new RpcDispatcher({ methods, ctx, logger: fastify.log });
    const handler = new RpcConnectionHandler(socket, dispatcher, hub, ctx, fastify.log);
    socket.on("message", (raw: Buffer) => handler.onMessage(raw));
    socket.on("close", () => handler.onClose());
    socket.on("error", () => handler.onClose());
  });
}
