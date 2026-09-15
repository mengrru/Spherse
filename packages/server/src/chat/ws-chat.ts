import type { FastifyInstance } from "fastify";
import { MigrationRequiredError, NotFoundError } from "@spherse/core";
import {
  CHAT_CLOSE_CODES,
  parseChatClientMessage,
  parseChatServerEvent,
} from "@spherse/contracts";
import { classifyRunError } from "./classify-run-error.js";
import type { ChatSessionAttachment } from "./chat-channel.js";
import type { ProjectRegistry } from "../registry.js";
import type { ChatSessionHub } from "./chat-session-hub.js";

const validateOutbound = process.env.SPHERSE_VALIDATE_WS === "1";

function toCloseCode(err: unknown): number {
  if (err instanceof NotFoundError) return CHAT_CLOSE_CODES.SESSION_UNRECOVERABLE;
  if (err instanceof MigrationRequiredError) return CHAT_CLOSE_CODES.MIGRATION_REQUIRED;
  return 1000;
}

export function handleChatWebSocket(
  fastify: FastifyInstance,
  registry: ProjectRegistry,
  hub: ChatSessionHub,
) {
  fastify.get<{
    Params: { projectId: string; agentId: string; sessionId: string };
    Querystring: { since?: string };
  }>(
    "/ws/projects/:projectId/chat/:agentId/:sessionId",
    { websocket: true },
    (socket, req) => {
      const ctx = registry.get(req.params.projectId);
      if (!ctx) {
        fastify.log.warn({ projectId: req.params.projectId }, "chat ws project not found");
        socket.close(1000, "project not found");
        return;
      }
      const { agentId, sessionId } = req.params;
      const sinceQuery = Number(req.query?.since);
      const since =
        Number.isInteger(sinceQuery) && sinceQuery >= -1 ? sinceQuery : undefined;
      let closed = false;
      const send = (event: unknown): void => {
        if (closed) return;
        try {
          socket.send(
            JSON.stringify(validateOutbound ? parseChatServerEvent(event) : event),
          );
        } catch (err) {
          fastify.log.debug({ err, sessionId }, "chat ws send skipped");
        }
      };
      fastify.log.info({ sessionId, agentId }, "chat ws connected");

      let attachment: ChatSessionAttachment;
      try {
        attachment = hub.attach(
          ctx.sessionRuntime,
          agentId,
          sessionId,
          send,
          since !== undefined ? { since } : undefined,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "request failed";
        fastify.log.warn({ err, sessionId, agentId }, "chat ws attach rejected");
        send({ type: "error", message });
        socket.close(1000, message);
        return;
      }
      const ready = attachment.ready.then(
        () => true,
        (err) => {
          if (closed) return false;
          const message = err instanceof Error ? err.message : "request failed";
          const code = toCloseCode(err);
          send({ type: "error", message });
          socket.close(code, message);
          return false;
        },
      );

      socket.on("message", async (raw: Buffer) => {
        let msg: ReturnType<typeof parseChatClientMessage>;
        try {
          msg = parseChatClientMessage(JSON.parse(raw.toString()));
        } catch (err) {
          fastify.log.warn({ err, sessionId }, "invalid chat ws message");
          send({ type: "error", message: "Invalid WebSocket message" });
          socket.close(CHAT_CLOSE_CODES.PROTOCOL_ERROR, "Invalid WebSocket message");
          return;
        }

        if (msg.type === "ping") {
          send({ type: "pong" });
          return;
        }

        if (msg.type === "message") {
          try {
            await attachment.sendMessage(msg.content, msg.attachments ?? [], msg.clientId);
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
        } else if (msg.type === "withdraw") {
          try {
            await attachment.withdrawLastTurn();
          } catch (err) {
            if (closed) return;
            fastify.log.error({ err, sessionId }, "chat ws withdraw error");
            const message = err instanceof Error ? err.message : "withdraw error";
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
