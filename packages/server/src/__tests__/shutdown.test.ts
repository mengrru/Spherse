import { describe, expect, it, vi } from "vitest";
import { closeMultiProjectServer } from "../shutdown.js";

function createDeps() {
  const order: string[] = [];
  const hubClose = vi.fn(() => {
    order.push("hub");
  });
  const registryRemoveAll = vi.fn(async () => {
    order.push("registry");
  });
  const fastifyClose = vi.fn(async () => {
    order.push("fastify");
  });
  const logger = { warn: vi.fn(), error: vi.fn() };
  const deps = {
    hub: { close: hubClose },
    registry: { removeAll: registryRemoveAll },
    fastify: { close: fastifyClose },
    logger,
  };
  return { deps, hubClose, registryRemoveAll, fastifyClose, logger, order };
}

describe("closeMultiProjectServer", () => {
  it("closes the hub, then the registry, then fastify", async () => {
    const { deps, order } = createDeps();

    await closeMultiProjectServer(deps as never, { onStageOutcome: () => {} });

    expect(order).toEqual(["hub", "registry", "fastify"]);
  });

  it("keeps going when the hub close throws", async () => {
    const { deps, order, logger } = createDeps();
    deps.hub.close.mockImplementation(() => {
      throw new Error("hub boom");
    });

    await closeMultiProjectServer(deps as never, { onStageOutcome: () => {} });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "chat hub close failed",
    );
    expect(order).toEqual(["registry", "fastify"]);
  });

  it("reports a rejected stage and still closes fastify", async () => {
    const { deps, fastifyClose } = createDeps();
    deps.registry.removeAll.mockRejectedValue(new Error("registry boom"));
    const outcomes: string[] = [];

    await closeMultiProjectServer(deps as never, {
      onStageOutcome: (stage, outcome, detail) => {
        outcomes.push(`${stage}:${outcome}:${(detail as Error).message}`);
      },
    });

    expect(outcomes).toEqual(["registry.removeAll:error:registry boom"]);
    expect(fastifyClose).toHaveBeenCalledTimes(1);
  });

  it("times out a hanging stage and continues with the next one", async () => {
    vi.useFakeTimers();
    try {
      const { deps, fastifyClose } = createDeps();
      deps.registry.removeAll.mockImplementation(() => new Promise(() => {}));
      const outcomes: string[] = [];

      const closePromise = closeMultiProjectServer(deps as never, {
        stageTimeoutMs: 50,
        onStageOutcome: (stage, outcome) => {
          outcomes.push(`${stage}:${outcome}`);
        },
      });
      await vi.advanceTimersByTimeAsync(50);
      await closePromise;

      expect(outcomes).toEqual(["registry.removeAll:timeout"]);
      expect(fastifyClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the server logger when no outcome callback is provided", async () => {
    const { deps, logger } = createDeps();
    deps.fastify.close.mockRejectedValue(new Error("fastify boom"));

    await closeMultiProjectServer(deps as never);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "fastify.close",
        outcome: "error",
        err: expect.any(Error),
      }),
      "server close stage did not complete",
    );
  });
});
