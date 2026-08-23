import { Type, type Static } from "@sinclair/typebox";
import type {
  AgentEvent,
  AgentMessage,
  SessionControlEvent,
  ToolResultMessage,
} from "@spherse/core";
import { parseContract } from "./common.js";

export enum ErrorEventCode {
  ModelNotConfigured = "MODEL_NOT_CONFIGURED",
  Auth = "AUTH_ERROR",
  Permanent = "PERMANENT",
  Transient = "TRANSIENT",
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
type EventOf<
  TEvent extends { type: string },
  TType extends TEvent["type"],
> = Extract<TEvent, { type: TType }>;

const agentMessage = Type.Unsafe<AgentMessage>(Type.Unknown());
const toolResultMessages = Type.Unsafe<ToolResultMessage[]>(
  Type.Array(Type.Unknown()),
);
const toolArgs = Type.Unsafe<Record<string, unknown>>(Type.Unknown());

const chatServerEvent = Type.Union([
  Type.Object({ type: Type.Literal("agent_start") }),
  Type.Object({
    type: Type.Literal("agent_end"),
    messages: Type.Unsafe<
      EventOf<AgentEvent, "agent_end">["messages"]
    >(Type.Array(Type.Unknown())),
  }),
  Type.Object({ type: Type.Literal("run_status"), active: Type.Boolean() }),
  Type.Object({ type: Type.Literal("turn_start") }),
  Type.Object({
    type: Type.Literal("turn_end"),
    message: agentMessage,
    toolResults: toolResultMessages,
  }),
  Type.Object({ type: Type.Literal("message_start"), message: agentMessage }),
  Type.Object({
    type: Type.Literal("message_update"),
    message: agentMessage,
    assistantMessageEvent: Type.Optional(Type.Unknown()),
  }),
  Type.Object({ type: Type.Literal("message_end"), message: agentMessage }),
  Type.Object({
    type: Type.Literal("tool_execution_start"),
    toolCallId: Type.String(),
    toolName: Type.String(),
    args: toolArgs,
  }),
  Type.Object({
    type: Type.Literal("tool_execution_update"),
    toolCallId: Type.String(),
    toolName: Type.String(),
    args: toolArgs,
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
    type: Type.Literal("control_request"),
    requestId: Type.String(),
    kind: Type.Literal("approval"),
    toolCallId: Type.String(),
    toolName: Type.String(),
    args: Type.Unsafe<
      EventOf<SessionControlEvent, "control_request">["args"]
    >(Type.Unknown()),
  }),
  Type.Object({
    type: Type.Literal("control_request"),
    requestId: Type.String(),
    kind: Type.Literal("question"),
    toolCallId: Type.String(),
    toolName: Type.String(),
    args: Type.Unsafe<
      EventOf<SessionControlEvent, "control_request">["args"]
    >(Type.Unknown()),
  }),
  Type.Object({
    type: Type.Literal("control_resolved"),
    requestId: Type.String(),
    kind: Type.Literal("approval"),
    approved: Type.Boolean(),
    reason: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal("control_resolved"),
    requestId: Type.String(),
    kind: Type.Literal("question"),
    answer: Type.Optional(Type.String()),
    timedOut: Type.Boolean(),
  }),
  Type.Object({
    type: Type.Literal("turn_withdrawn"),
    seq: Type.Integer(),
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
    Type.Object({
      type: Type.Literal("message"),
      content: Type.String(),
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
    Type.Object({ type: Type.Literal("abort") }),
    Type.Object({ type: Type.Literal("ping") }),
    Type.Object({ type: Type.Literal("retry") }),
    Type.Object({ type: Type.Literal("withdraw") }),
    Type.Object({
      type: Type.Literal("resolve_control_request"),
      requestId: Type.String(),
      kind: Type.Literal("approval"),
      approved: Type.Boolean(),
      reason: Type.Optional(Type.String()),
    }),
    Type.Object({
      type: Type.Literal("resolve_control_request"),
      requestId: Type.String(),
      kind: Type.Literal("question"),
      answer: Type.String({ minLength: 1 }),
    }),
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
