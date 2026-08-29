import { Type, type Static } from "@sinclair/typebox";
import { parseContract } from "./common.js";
import { triggerEntry } from "./trigger.js";

const triggerTriggeredPayload = Type.Object({
  agentId: Type.String(),
  triggerId: Type.String(),
  eventName: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
  triggeredAt: Type.Number(),
});

const triggerCompletedPayload = Type.Object({
  agentId: Type.String(),
  triggerId: Type.String(),
  sessionId: Type.String(),
  status: Type.Literal("success"),
});

const triggerFailedPayload = Type.Object({
  agentId: Type.String(),
  triggerId: Type.String(),
  error: Type.String(),
});

const triggerUpdatedPayload = Type.Object({
  agentId: Type.String(),
  triggerId: Type.String(),
  trigger: Type.Optional(triggerEntry),
});

const agentUpdatedPayload = Type.Object({
  agentId: Type.String(),
  action: Type.Union([Type.Literal("created"), Type.Literal("updated"), Type.Literal("deleted")]),
});
export type AgentUpdatedEvent = Static<typeof agentUpdatedPayload>;

export const fsWatchChangeEvent = Type.Object({
  eventType: Type.Union([Type.Literal("rename"), Type.Literal("change")]),
  path: Type.String(),
});
export type FsWatchChangeEvent = Static<typeof fsWatchChangeEvent>;

export const debugLogEvent = Type.Object({
  line: Type.String(),
});
export type DebugLogEvent = Static<typeof debugLogEvent>;

const busClientChannel = Type.Union([
  Type.Literal("trigger"),
  Type.Literal("agent"),
  Type.Literal("fs-watch"),
  Type.Literal("debug"),
]);

const busServerMessage = Type.Union([
  Type.Object({
    channel: Type.Literal("trigger"),
    projectId: Type.String(),
    type: Type.Literal("trigger_triggered"),
    payload: triggerTriggeredPayload,
  }),
  Type.Object({
    channel: Type.Literal("trigger"),
    projectId: Type.String(),
    type: Type.Literal("trigger_completed"),
    payload: triggerCompletedPayload,
  }),
  Type.Object({
    channel: Type.Literal("trigger"),
    projectId: Type.String(),
    type: Type.Literal("trigger_failed"),
    payload: triggerFailedPayload,
  }),
  Type.Object({
    channel: Type.Literal("trigger"),
    projectId: Type.String(),
    type: Type.Literal("trigger_updated"),
    payload: triggerUpdatedPayload,
  }),
  Type.Object({
    channel: Type.Literal("agent"),
    projectId: Type.String(),
    type: Type.Literal("agent_updated"),
    payload: agentUpdatedPayload,
  }),
  Type.Object({
    channel: Type.Literal("fs-watch"),
    projectId: Type.String(),
    type: Type.Literal("change"),
    payload: fsWatchChangeEvent,
  }),
  Type.Object({
    channel: Type.Literal("debug"),
    type: Type.Literal("log"),
    payload: debugLogEvent,
  }),
  Type.Object({
    channel: Type.Literal("__system__"),
    type: Type.Literal("pong"),
    payload: Type.Object({}),
  }),
  Type.Object({
    channel: Type.Literal("__system__"),
    projectId: Type.String(),
    type: Type.Literal("fs_watch_error"),
    payload: Type.Object({ error: Type.String() }),
  }),
]);

const busClientMessage = Type.Union([
  Type.Object({
    kind: Type.Literal("subscribe"),
    projectId: Type.String(),
    channel: busClientChannel,
  }),
  Type.Object({
    kind: Type.Literal("unsubscribe"),
    projectId: Type.String(),
    channel: busClientChannel,
  }),
  Type.Object({ kind: Type.Literal("ping") }),
  Type.Object({
    kind: Type.Literal("emit-trigger-event"),
    projectId: Type.String(),
    eventName: Type.String({ minLength: 1 }),
    payload: Type.Optional(Type.String()),
  }),
]);

const triggerServerEvent = Type.Union([
  Type.Object({
    type: Type.Literal("trigger_triggered"),
    ...triggerTriggeredPayload.properties,
  }),
  Type.Object({
    type: Type.Literal("trigger_completed"),
    ...triggerCompletedPayload.properties,
  }),
  Type.Object({
    type: Type.Literal("trigger_failed"),
    ...triggerFailedPayload.properties,
  }),
  Type.Object({
    type: Type.Literal("trigger_updated"),
    ...triggerUpdatedPayload.properties,
  }),
]);

export const schemas = {
  busServerMessage,
  busClientMessage,
  triggerServerEvent,
} as const;

export type BusServerMessage = Static<typeof busServerMessage>;
export type BusClientMessage = Static<typeof busClientMessage>;
export type TriggerServerEvent = Static<typeof triggerServerEvent>;

export function parseBusServerMessage(payload: unknown): BusServerMessage {
  return parseContract(busServerMessage, payload);
}

export function parseBusClientMessage(payload: unknown): BusClientMessage {
  return parseContract(busClientMessage, payload);
}

export function parseTriggerServerEvent(payload: unknown): TriggerServerEvent {
  return parseContract(triggerServerEvent, payload);
}
