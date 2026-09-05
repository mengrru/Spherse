import { Type, type Static } from "@sinclair/typebox";
import type {
  AgentEvent,
  AgentMessage,
  AssistantMessage,
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
  PROTOCOL_ERROR: 4400,
  SESSION_UNRECOVERABLE: 4401,
  MIGRATION_REQUIRED: 4402,
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
const assistantMessage = Type.Unsafe<AssistantMessage>(Type.Unknown());
const toolResultMessage = Type.Unsafe<ToolResultMessage>(Type.Unknown());
const toolResultMessages = Type.Unsafe<ToolResultMessage[]>(
  Type.Array(Type.Unknown()),
);
const toolArgs = Type.Unsafe<Record<string, unknown>>(Type.Unknown());

export const chatReplayEvent = Type.Union([
  Type.Object({
    type: Type.Literal("turn/start"),
    seq: Type.Integer(),
    time: Type.Integer(),
    data: Type.Object({}),
  }),
  Type.Object({
    type: Type.Literal("turn/end"),
    seq: Type.Integer(),
    time: Type.Integer(),
    data: Type.Object({
      reason: Type.Union([
        Type.Literal("completed"),
        Type.Literal("aborted"),
        Type.Literal("error"),
      ]),
    }),
  }),
  Type.Object({
    type: Type.Literal("user/message"),
    seq: Type.Integer(),
    time: Type.Integer(),
    data: Type.Object({
      message: agentMessage,
      source: Type.Optional(Type.Literal("triggered")),
      triggerName: Type.Optional(Type.String()),
    }),
  }),
  Type.Object({
    type: Type.Literal("assistant/message"),
    seq: Type.Integer(),
    time: Type.Integer(),
    data: Type.Object({ message: assistantMessage }),
  }),
  Type.Object({
    type: Type.Literal("tool/result"),
    seq: Type.Integer(),
    time: Type.Integer(),
    data: Type.Object({ message: toolResultMessage }),
  }),
  Type.Object({
    type: Type.Literal("compaction/applied"),
    seq: Type.Integer(),
    time: Type.Integer(),
    data: Type.Object({
      anchorSeq: Type.Integer(),
      digestContent: Type.String(),
      excludedSeqs: Type.Array(Type.Integer()),
      digestSource: Type.Optional(
        Type.Union([Type.Literal("llm"), Type.Literal("mechanical")]),
      ),
    }),
  }),
  Type.Object({
    type: Type.Literal("turn/retried"),
    seq: Type.Integer(),
    time: Type.Integer(),
    data: Type.Object({ abandonedSeqs: Type.Array(Type.Integer()) }),
  }),
  Type.Object({
    type: Type.Literal("turn/withdrawn"),
    seq: Type.Integer(),
    time: Type.Integer(),
    data: Type.Object({ seq: Type.Integer() }),
  }),
  Type.Object({
    type: Type.Literal("control/requested"),
    seq: Type.Integer(),
    time: Type.Integer(),
    data: Type.Object({
      requestId: Type.String(),
      kind: Type.Union([Type.Literal("approval"), Type.Literal("question")]),
      toolCallId: Type.String(),
      toolName: Type.String(),
      args: Type.Unknown(),
    }),
  }),
  Type.Object({
    type: Type.Literal("control/resolved"),
    seq: Type.Integer(),
    time: Type.Integer(),
    data: Type.Object({
      requestId: Type.String(),
      kind: Type.Union([Type.Literal("approval"), Type.Literal("question")]),
      approved: Type.Optional(Type.Boolean()),
      reason: Type.Optional(Type.String()),
      answer: Type.Optional(Type.String()),
      timedOut: Type.Optional(Type.Boolean()),
      aborted: Type.Optional(Type.Boolean()),
    }),
  }),
]);

const chatServerEvent = Type.Union([
  Type.Object({ type: Type.Literal("agent_start") }),
  Type.Object({
    type: Type.Literal("agent_end"),
    messages: Type.Unsafe<
      EventOf<AgentEvent, "agent_end">["messages"]
    >(Type.Array(Type.Unknown())),
    seq: Type.Optional(Type.Integer()),
  }),
  Type.Object({ type: Type.Literal("run_status"), active: Type.Boolean() }),
  Type.Object({ type: Type.Literal("turn_start") }),
  Type.Object({
    type: Type.Literal("turn_end"),
    message: agentMessage,
    toolResults: toolResultMessages,
  }),
  Type.Object({ type: Type.Literal("message_start"), message: agentMessage, messageId: Type.Optional(Type.String()) }),
  Type.Object({
    type: Type.Literal("message_update"),
    message: agentMessage,
    messageId: Type.Optional(Type.String()),
    assistantMessageEvent: Type.Optional(Type.Unknown()),
  }),
  Type.Object({
    type: Type.Literal("message_end"),
    message: agentMessage,
    messageId: Type.Optional(Type.String()),
    seq: Type.Optional(Type.Integer()),
  }),
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
    seq: Type.Optional(Type.Integer()),
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
    seq: Type.Optional(Type.Integer()),
  }),
  Type.Object({
    type: Type.Literal("control_resolved"),
    requestId: Type.String(),
    kind: Type.Literal("approval"),
    approved: Type.Boolean(),
    reason: Type.Optional(Type.String()),
    aborted: Type.Optional(Type.Boolean()),
    seq: Type.Optional(Type.Integer()),
  }),
  Type.Object({
    type: Type.Literal("control_resolved"),
    requestId: Type.String(),
    kind: Type.Literal("question"),
    answer: Type.Optional(Type.String()),
    timedOut: Type.Boolean(),
    aborted: Type.Optional(Type.Boolean()),
    seq: Type.Optional(Type.Integer()),
  }),
  Type.Object({
    type: Type.Literal("turn_withdrawn"),
    seq: Type.Integer(),
  }),
  Type.Object({
    type: Type.Literal("user_message"),
    seq: Type.Integer(),
    message: agentMessage,
    clientId: Type.Optional(Type.String()),
    source: Type.Optional(Type.Literal("triggered")),
    triggerName: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal("turn_retried"),
    seq: Type.Integer(),
    abandonedSeqs: Type.Array(Type.Integer()),
  }),
  Type.Object({
    type: Type.Literal("session_ready"),
    lastSeq: Type.Integer(),
    replay: Type.Boolean(),
  }),
  Type.Object({
    type: Type.Literal("replay_events"),
    events: Type.Array(chatReplayEvent),
  }),
  Type.Object({ type: Type.Literal("replay_done") }),
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
  chatReplayEvent,
} as const;

export type ChatClientMessage = Static<typeof schemas.chatClientMessage>;
export type ChatServerEvent = Static<typeof chatServerEvent>;
export type ChatReplayEvent = Static<typeof chatReplayEvent>;

export function parseChatClientMessage(payload: unknown): ChatClientMessage {
  return parseContract(schemas.chatClientMessage, payload);
}

export function parseChatServerEvent(payload: unknown): ChatServerEvent {
  return parseContract(chatServerEvent, payload);
}

export function parseChatReplayEvent(payload: unknown): ChatReplayEvent {
  return parseContract(chatReplayEvent, payload);
}
