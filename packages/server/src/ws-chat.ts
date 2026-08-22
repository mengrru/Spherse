import type { FastifyInstance } from "fastify";
import { NotFoundError } from "@spherse/core";
import {
  CHAT_CLOSE_CODES,
  parseChatClientMessage,
  parseChatServerEvent,
} from "@spherse/server/contracts";
import { classifyRunError } from "./classify-run-error.js";
import type { ProjectRegistry } from "./registry.js";
import type { ChatSessionHub } from "./chat-session-hub.js";

export function handleChatWebSocket(
  fastify: FastifyInstance,
  registry: ProjectRegistry,
  hub: ChatSessionHub,
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
      let closed = false;
      const send = (event: unknown): void => {
        if (closed) return;
        try {
          socket.send(JSON.stringify(parseChatServerEvent(event)));
        } catch (err) {
          fastify.log.debug({ err, sessionId }, "chat ws send skipped");
        }
      };
      fastify.log.info({ sessionId, agentId }, "chat ws connected");

      const attachment = hub.attach(
        req.params.projectId,
        ctx.sessionRuntime,
        agentId,
        sessionId,
        send,
      );
      const ready = attachment.ready
        .catch((err) => {
          const message = err instanceof Error ? err.message : "request failed";
          const code = err instanceof NotFoundError
            ? CHAT_CLOSE_CODES.SESSION_UNRECOVERABLE
            : 1000;
          send({ type: "error", message });
          socket.close(code, message);
          return false;
        });

      socket.on("message", async (raw: Buffer) => {
        let msg: ReturnType<typeof parseChatClientMessage>;
        try {
          msg = parseChatClientMessage(JSON.parse(raw.toString()));
        } catch (err) {
          fastify.log.warn({ err, sessionId }, "invalid chat ws message");
          send({ type: "error", message: "Invalid WebSocket message" });
          return;
        }

        if (msg.type === "ping") {
          send({ type: "pong" });
          return;
        }

        if (msg.type === "message") {
          try {
            await attachment.sendMessage(msg.content, msg.attachments ?? []);
          } catch (err) {
            if (closed) return;
            fastify.log.error({ err, sessionId }, "chat ws message error");
            const message = err instanceof Error ? err.message : "chat error";
            send({ type: "error", message, code: classifyRunError(err) });
          }
        } else if (msg.type === "retry") {
          try {
            await attachment.retryLastTurn();
          } catch (err) {
            if (closed) return;
            fastify.log.error({ err, sessionId }, "chat ws retry error");
            const message = err instanceof Error ? err.message : "retry error";
            send({ type: "error", message, code: classifyRunError(err) });
          }
        } else if (msg.type === "abort") {
          if (!(await ready) || closed) return;
          attachment.abort();
        } else if (msg.type === "resolve_control_request") {
          if (!(await ready) || closed) return;
          if (msg.kind === "question") {
            attachment.resolveControlRequest(msg.requestId, {
              answer: msg.answer,
              timedOut: false,
            });
          } else {
            attachment.resolveControlRequest(msg.requestId, {
              approved: msg.approved,
              reason: msg.reason,
            });
          }
        }
      });

      socket.on("close", () => {
        closed = true;
        attachment.close();
        fastify.log.info({ sessionId }, "chat ws disconnected");
      });
    },
  );
}
