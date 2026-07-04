import type { FastifyInstance } from "fastify";
import { NotFoundError, ModelNotConfiguredError } from "@spherse/core";
import {
  CHAT_CLOSE_CODES,
  ErrorEventCode,
  parseChatClientMessage,
  parseChatServerEvent,
} from "@spherse/server/contracts";
import type { ProjectRegistry } from "./registry.js";

export function handleChatWebSocket(
  fastify: FastifyInstance,
  registry: ProjectRegistry,
) {
  fastify.get<{ Params: { projectId: string; agentId: string; sessionId: string } }>(
    "/ws/projects/:projectId/chat/:agentId/:sessionId",
    { websocket: true },
    (socket, req) => {
      const ctx = registry.get(req.params.projectId);
      if (!ctx) {
        socket.close();
        return;
      }
      const { agentId, sessionId } = req.params;
      fastify.log.info({ sessionId, agentId }, "chat ws connected");

      ctx.sessionRuntime.restoreSession(agentId, sessionId).catch((err) => {
        const message = err instanceof Error ? err.message : "request failed";
        const code = err instanceof NotFoundError
          ? CHAT_CLOSE_CODES.SESSION_UNRECOVERABLE
          : 1000;
        socket.send(JSON.stringify(parseChatServerEvent({ type: "error", message })));
        socket.close(code, message);
      });

      socket.on("message", async (raw: Buffer) => {
        let msg: ReturnType<typeof parseChatClientMessage>;
        try {
          msg = parseChatClientMessage(JSON.parse(raw.toString()));
        } catch (err) {
          fastify.log.warn({ err, sessionId }, "invalid chat ws message");
          socket.send(
            JSON.stringify({
              type: "error",
              message: "Invalid WebSocket message",
            }),
          );
          return;
        }

        if (msg.type === "message") {
          try {
            await ctx.sessionRuntime.sendMessage(sessionId, msg.content, (event) => {
              socket.send(JSON.stringify(parseChatServerEvent(event)));
            });
          } catch (err) {
            fastify.log.error({ err, sessionId }, "chat ws message error");
            const message = err instanceof Error ? err.message : "chat error";
            const code = err instanceof ModelNotConfiguredError
              ? ErrorEventCode.ModelNotConfigured
              : ErrorEventCode.Unknown;
            socket.send(JSON.stringify(parseChatServerEvent({ type: "error", message, code })));
          }
        } else if (msg.type === "abort") {
          ctx.sessionRuntime.abortSession(sessionId);
        } else if (msg.type === "ping") {
          socket.send(JSON.stringify(parseChatServerEvent({ type: "pong" })));
        }
      });

      socket.on("close", () => {
        ctx.sessionRuntime.destroySession(sessionId);
        fastify.log.info({ sessionId }, "chat ws disconnected");
      });
    },
  );
}
