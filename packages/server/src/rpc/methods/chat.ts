import { Type } from "@sinclair/typebox";
import { schemas, parseContract } from "@spherse/contracts";
import {
  RpcAppError,
  defineRpcMethod,
  type RpcConnectionState,
  type RpcMethodEntry,
} from "../context.js";
import type { ChatSessionAttachment } from "../../chat/chat-channel.js";

function requireAttachment(
  conn: RpcConnectionState,
  params: { projectId: string; agentId: string; sessionId: string },
): ChatSessionAttachment {
  const attachment = conn.chatAttachment(params.projectId, params.agentId, params.sessionId);
  if (!attachment) throw new RpcAppError(102, "Not subscribed to session");
  return attachment;
}

const sessionRef = {
  projectId: Type.String(),
  agentId: Type.String(),
  sessionId: Type.String(),
};

const send = defineRpcMethod(
  Type.Object({
    ...sessionRef,
    content: Type.String({ minLength: 1 }),
    clientId: Type.Optional(Type.String()),
    attachments: Type.Optional(
      Type.Array(
        Type.Object({
          type: Type.String(),
          path: Type.String(),
          mimeType: Type.String(),
        }),
      ),
    ),
  }),
  async (params, _ctx, conn) => {
    const attachment = requireAttachment(conn, params);
    await attachment.sendMessage(params.content, params.attachments ?? [], params.clientId);
    return parseContract(schemas.okResponse, { ok: true });
  },
);

const retry = defineRpcMethod(
  Type.Object({ ...sessionRef }),
  async (params, _ctx, conn) => {
    const attachment = requireAttachment(conn, params);
    await attachment.retryLastTurn();
    return parseContract(schemas.okResponse, { ok: true });
  },
);

const withdraw = defineRpcMethod(
  Type.Object({ ...sessionRef }),
  async (params, _ctx, conn) => {
    const attachment = requireAttachment(conn, params);
    await attachment.withdrawLastTurn();
    return parseContract(schemas.okResponse, { ok: true });
  },
);

const abort = defineRpcMethod(
  Type.Object({ ...sessionRef }),
  async (params, _ctx, conn) => {
    const attachment = requireAttachment(conn, params);
    try {
      await attachment.ready;
    } catch {
      throw new RpcAppError(102, "Session not ready");
    }
    attachment.abort();
    return parseContract(schemas.okResponse, { ok: true });
  },
);

const resolveControlRequest = defineRpcMethod(
  Type.Intersect([
    Type.Object({ ...sessionRef, requestId: Type.String() }),
    Type.Union([
      Type.Object({ kind: Type.Literal("approval"), approved: Type.Boolean(), reason: Type.Optional(Type.String()) }),
      Type.Object({ kind: Type.Literal("question"), answer: Type.String({ minLength: 1 }) }),
    ]),
  ]),
  (params, _ctx, conn) => {
    const attachment = requireAttachment(conn, params);
    if (params.kind === "approval") {
      attachment.resolveControlRequest(params.requestId, {
        approved: params.approved,
        reason: params.reason,
      });
    } else {
      attachment.resolveControlRequest(params.requestId, {
        answer: params.answer,
        timedOut: false,
      });
    }
    return parseContract(schemas.okResponse, { ok: true });
  },
);

export const chatMethods: Record<string, RpcMethodEntry> = {
  "chat.send": send,
  "chat.retry": retry,
  "chat.withdraw": withdraw,
  "chat.abort": abort,
  "chat.resolveControlRequest": resolveControlRequest,
};
