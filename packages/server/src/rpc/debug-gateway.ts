import type { FastifyInstance } from "fastify";
import { RpcDispatcher, type RpcContext, type RpcMethodEntry } from "@spherse/rpc/host";
import type { FastifyBaseLogger } from "fastify";

interface RpcDebugBody {
  method?: unknown;
  params?: unknown;
}

export function registerRpcDebugGateway(
  fastify: FastifyInstance,
  methods: Map<string, RpcMethodEntry>,
  ctx: RpcContext,
): void {
  const logger = fastify.log as FastifyBaseLogger;
  fastify.post("/api/rpc-debug", async (req, reply) => {
    const body = (req.body ?? {}) as RpcDebugBody;
    if (typeof body.method !== "string" || body.method.length === 0) {
      return reply.code(400).send({ error: "body must be { method: string, params?: object }" });
    }
    const params =
      body.params !== undefined && body.params !== null && typeof body.params === "object"
        ? body.params
        : {};
    const dispatcher = new RpcDispatcher({ methods, ctx, logger });
    let resultFrame: unknown;
    await dispatcher.dispatchCall(
      { type: "call", id: 0, method: body.method, params: params as Record<string, unknown> },
      (frame) => {
        resultFrame = frame;
      },
      { chatAttachment: () => undefined },
    );
    const frame = resultFrame as { type: string; ok: boolean; data?: unknown; error?: { code: number; message: string } };
    if (!frame || frame.type !== "result") {
      return reply.code(502).send({ error: "no result frame" });
    }
    if (frame.ok) return frame.data;
    return reply.code(400).send({ error: frame.error?.message ?? "rpc failed", code: frame.error?.code });
  });
}
