import { Type, type Static } from "@sinclair/typebox";
import { parseContract } from "./common.js";

export enum ErrorEventCode {
  ModelNotConfigured = "MODEL_NOT_CONFIGURED",
  Unknown = "UNKNOWN",
}

export const CHAT_CLOSE_CODES = {
  SESSION_UNRECOVERABLE: 4401,
} as const;

/**
 * Chat WebSocket server events.
 *
 * Server is a transparent transport: it forwards pi-agent-core events to the
 * renderer without interpreting message/tool payloads. The `Type.Unknown()`
 * fields below carry pi-ai Message / tool details objects whose typed shape is
 * reconstructed on the consumer side via `@spherse/core` re-exports and type
 * guards (see `packages/app/src/features/chat/agent-event-parse.ts`).
 *
 * Keeping the contract payload-agnostic prevents coupling server to specific
 * message schemas or tools, and avoids type drift between server and pi-ai.
 */
const chatServerEvent = Type.Union([
  Type.Object({ type: Type.Literal("agent_start") }),
  Type.Object({ type: Type.Literal("agent_end"), messages: Type.Array(Type.Unknown()) }),
  Type.Object({ type: Type.Literal("turn_start") }),
  Type.Object({
    type: Type.Literal("turn_end"),
    message: Type.Unknown(),
    toolResults: Type.Array(Type.Unknown()),
  }),
  Type.Object({ type: Type.Literal("message_start"), message: Type.Unknown() }),
  Type.Object({ type: Type.Literal("message_update"), message: Type.Unknown(), assistantMessageEvent: Type.Optional(Type.Unknown()) }),
  Type.Object({ type: Type.Literal("message_end"), message: Type.Unknown() }),
  Type.Object({
    type: Type.Literal("tool_execution_start"),
    toolCallId: Type.String(),
    toolName: Type.String(),
    args: Type.Unknown(),
  }),
  Type.Object({
    type: Type.Literal("tool_execution_update"),
    toolCallId: Type.String(),
    toolName: Type.String(),
    args: Type.Unknown(),
    partialResult: Type.Unknown(),
  }),
  Type.Object({
    type: Type.Literal("tool_execution_end"),
    toolCallId: Type.String(),
    toolName: Type.String(),
    result: Type.Unknown(),
    isError: Type.Boolean(),
  }),
  Type.Object({
    type: Type.Literal("error"),
    message: Type.String(),
    code: Type.Optional(Type.Enum(ErrorEventCode)),
  }),
  Type.Object({ type: Type.Literal("pong") }),
]);

export const schemas = {
  chatClientMessage: Type.Union([
    Type.Object({ type: Type.Literal("message"), content: Type.String() }),
    Type.Object({ type: Type.Literal("abort") }),
    Type.Object({ type: Type.Literal("ping") }),
  ]),
  chatServerEvent,
} as const;

export type ChatClientMessage = Static<typeof schemas.chatClientMessage>;
export type ChatServerEvent = Static<typeof chatServerEvent>;

export function parseChatClientMessage(payload: unknown): ChatClientMessage {
  return parseContract(schemas.chatClientMessage, payload);
}

export function parseChatServerEvent(payload: unknown): ChatServerEvent {
  return parseContract(chatServerEvent, payload);
}
