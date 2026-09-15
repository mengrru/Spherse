import type { FastifyInstance } from "fastify";
import { settleWithin, type Logger } from "@spherse/core";
import type { ChatSessionHub } from "./chat/index.js";
import type { ProjectRegistry } from "./registry.js";

export const DEFAULT_SERVER_CLOSE_STAGE_TIMEOUT_MS = 10_000;

export type ServerCloseStage = "registry.removeAll" | "fastify.close";
export type ServerCloseOutcome = "timeout" | "error";

export interface ServerCloseOptions {
  stageTimeoutMs?: number;
  onStageOutcome?: (
    stage: ServerCloseStage,
    outcome: ServerCloseOutcome,
    detail: unknown,
  ) => void;
}

export interface ServerCloseDeps {
  hub: ChatSessionHub;
  registry: ProjectRegistry;
  fastify: FastifyInstance;
  logger: Logger;
}

export async function closeMultiProjectServer(
  deps: ServerCloseDeps,
  options?: ServerCloseOptions,
): Promise<void> {
  const stageTimeoutMs = options?.stageTimeoutMs ?? DEFAULT_SERVER_CLOSE_STAGE_TIMEOUT_MS;
  const onStageOutcome =
    options?.onStageOutcome ??
    ((stage: ServerCloseStage, outcome: ServerCloseOutcome, detail: unknown) => {
      deps.logger.warn(
        { stage, outcome, err: outcome === "error" ? detail : undefined },
        "server close stage did not complete",
      );
    });

  try {
    deps.hub.close();
  } catch (err) {
    deps.logger.error({ err }, "chat hub close failed");
  }

  await settleWithin(deps.registry.removeAll(), stageTimeoutMs, (outcome, detail) => {
    onStageOutcome("registry.removeAll", outcome, detail);
  });
  await settleWithin(deps.fastify.close(), stageTimeoutMs, (outcome, detail) => {
    onStageOutcome("fastify.close", outcome, detail);
  });
}
