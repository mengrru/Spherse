import { Type, type Static } from "@sinclair/typebox";
import { parseContract } from "./common.js";

export const RPC_PROTOCOL_VERSION = 1;

const rpcErrorObject = Type.Object({
  code: Type.Integer(),
  message: Type.String(),
  data: Type.Optional(Type.Unknown()),
});

export type RpcErrorObject = Static<typeof rpcErrorObject>;

export const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ScopeNotSupported: -32000,
  AppNotFound: 100,
  AppAccessDenied: 101,
  AppInvalidState: 102,
} as const;

export const rpcMethodName = Type.String({
  pattern: "^[a-z][a-zA-Z0-9]*\\.[a-z][a-zA-Z0-9]*$",
  minLength: 1,
});

const rpcScope = Type.String({ minLength: 1, maxLength: 512 });

const rpcCallFrame = Type.Object({
  type: Type.Literal("call"),
  id: Type.Integer({ minimum: 1 }),
  method: rpcMethodName,
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

const rpcSubFrame = Type.Object({
  type: Type.Literal("sub"),
  id: Type.Integer({ minimum: 1 }),
  scope: rpcScope,
  since: Type.Optional(Type.Integer({ minimum: 0 })),
});

const rpcUnsubFrame = Type.Object({
  type: Type.Literal("unsub"),
  id: Type.Integer({ minimum: 1 }),
  scope: rpcScope,
});

const rpcPingFrame = Type.Object({ type: Type.Literal("ping") });

const rpcResultFrame = Type.Object({
  type: Type.Literal("result"),
  id: Type.Integer({ minimum: 1 }),
  ok: Type.Boolean(),
  data: Type.Optional(Type.Unknown()),
  error: Type.Optional(rpcErrorObject),
});

const rpcEventFrame = Type.Object({
  type: Type.Literal("event"),
  scope: rpcScope,
  event: Type.String({ minLength: 1 }),
  payload: Type.Unknown(),
  seq: Type.Optional(Type.Integer({ minimum: 0 })),
  ts: Type.Integer({ minimum: 0 }),
});

const rpcSnapshotFrame = Type.Object({
  type: Type.Literal("snapshot"),
  id: Type.Integer({ minimum: 1 }),
  events: Type.Array(rpcEventFrame),
});

const rpcPongFrame = Type.Object({ type: Type.Literal("pong") });

export const rpcClientFrame = Type.Union([rpcCallFrame, rpcSubFrame, rpcUnsubFrame, rpcPingFrame]);
export const rpcServerFrame = Type.Union([rpcResultFrame, rpcSnapshotFrame, rpcEventFrame, rpcPongFrame]);

export type RpcCallFrame = Static<typeof rpcCallFrame>;
export type RpcSubFrame = Static<typeof rpcSubFrame>;
export type RpcUnsubFrame = Static<typeof rpcUnsubFrame>;
export type RpcPingFrame = Static<typeof rpcPingFrame>;
export type RpcClientFrame = Static<typeof rpcClientFrame>;
export type RpcResultFrame = Static<typeof rpcResultFrame>;
export type RpcEventFrame = Static<typeof rpcEventFrame>;
export type RpcSnapshotFrame = Static<typeof rpcSnapshotFrame>;
export type RpcPongFrame = Static<typeof rpcPongFrame>;
export type RpcServerFrame = Static<typeof rpcServerFrame>;

export function parseRpcClientFrame(payload: unknown): RpcClientFrame {
  return parseContract(rpcClientFrame, payload);
}

export function parseRpcServerFrame(payload: unknown): RpcServerFrame {
  return parseContract(rpcServerFrame, payload);
}

export function isRpcPongFrame(payload: unknown): payload is RpcPongFrame {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { type?: unknown }).type === "pong"
  );
}

const CHAT_SCOPE_PREFIX = "chat";

export const schemas = {
  rpcErrorObject,
  rpcMethodName,
  rpcClientFrame,
  rpcServerFrame,
  rpcCallFrame,
  rpcSubFrame,
  rpcUnsubFrame,
  rpcPingFrame,
  rpcResultFrame,
  rpcEventFrame,
  rpcSnapshotFrame,
  rpcPongFrame,
} as const;

export function chatScope(projectId: string, agentId: string, sessionId: string): string {
  return `${CHAT_SCOPE_PREFIX}:${projectId}:${agentId}:${sessionId}`;
}

export function parseChatScope(scope: string): { projectId: string; agentId: string; sessionId: string } | null {
  const parts = scope.split(":");
  if (parts.length !== 4 || parts[0] !== CHAT_SCOPE_PREFIX) return null;
  const [, projectId, agentId, sessionId] = parts;
  if (!projectId || !agentId || !sessionId) return null;
  return { projectId, agentId, sessionId };
}
