import { Type, type Static } from "@sinclair/typebox";
import { parseContract } from "./common.js";

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
  Type.Object({ type: Type.Literal("error"), message: Type.String() }),
]);

const scheduleServerEvent = Type.Union([
  Type.Object({
    type: Type.Literal("schedule_triggered"),
    agentId: Type.String(),
    scheduleId: Type.String(),
    sessionId: Type.Optional(Type.String()),
    triggeredAt: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal("schedule_completed"),
    agentId: Type.String(),
    scheduleId: Type.String(),
    sessionId: Type.String(),
    status: Type.Literal("success"),
  }),
  Type.Object({
    type: Type.Literal("schedule_failed"),
    agentId: Type.String(),
    scheduleId: Type.String(),
    error: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("schedule_updated"),
    agentId: Type.String(),
    scheduleId: Type.String(),
    schedule: Type.Optional(Type.Unknown()),
  }),
]);

export const schemas = {
  chatClientMessage: Type.Union([
    Type.Object({ type: Type.Literal("message"), content: Type.String() }),
    Type.Object({ type: Type.Literal("abort") }),
  ]),
  chatServerEvent,
  scheduleServerEvent,
} as const;

export type ChatClientMessage = Static<typeof schemas.chatClientMessage>;
export type ChatServerEvent = Static<typeof chatServerEvent>;
export type ScheduleServerEvent = Static<typeof scheduleServerEvent>;

export function parseChatClientMessage(payload: unknown): ChatClientMessage {
  return parseContract(schemas.chatClientMessage, payload);
}

export function parseChatServerEvent(payload: unknown): ChatServerEvent {
  return parseContract(chatServerEvent, payload);
}

export function parseScheduleServerEvent(payload: unknown): ScheduleServerEvent {
  return parseContract(scheduleServerEvent, payload);
}
