import { Type, type Static } from "@sinclair/typebox";
import { parseContract } from "./common.js";

const scheduleTriggeredPayload = Type.Object({
  agentId: Type.String(),
  scheduleId: Type.String(),
  sessionId: Type.Optional(Type.String()),
  triggeredAt: Type.Number(),
});

const scheduleCompletedPayload = Type.Object({
  agentId: Type.String(),
  scheduleId: Type.String(),
  sessionId: Type.String(),
  status: Type.Literal("success"),
});

const scheduleFailedPayload = Type.Object({
  agentId: Type.String(),
  scheduleId: Type.String(),
  error: Type.String(),
});

const scheduleUpdatedPayload = Type.Object({
  agentId: Type.String(),
  scheduleId: Type.String(),
  schedule: Type.Optional(Type.Unknown()),
});

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
  Type.Literal("schedule"),
  Type.Literal("fs-watch"),
  Type.Literal("debug"),
]);

const busServerMessage = Type.Union([
  Type.Object({
    channel: Type.Literal("schedule"),
    projectId: Type.String(),
    type: Type.Literal("schedule_triggered"),
    payload: scheduleTriggeredPayload,
  }),
  Type.Object({
    channel: Type.Literal("schedule"),
    projectId: Type.String(),
    type: Type.Literal("schedule_completed"),
    payload: scheduleCompletedPayload,
  }),
  Type.Object({
    channel: Type.Literal("schedule"),
    projectId: Type.String(),
    type: Type.Literal("schedule_failed"),
    payload: scheduleFailedPayload,
  }),
  Type.Object({
    channel: Type.Literal("schedule"),
    projectId: Type.String(),
    type: Type.Literal("schedule_updated"),
    payload: scheduleUpdatedPayload,
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
]);

const scheduleServerEvent = Type.Union([
  Type.Object({
    type: Type.Literal("schedule_triggered"),
    ...scheduleTriggeredPayload.properties,
  }),
  Type.Object({
    type: Type.Literal("schedule_completed"),
    ...scheduleCompletedPayload.properties,
  }),
  Type.Object({
    type: Type.Literal("schedule_failed"),
    ...scheduleFailedPayload.properties,
  }),
  Type.Object({
    type: Type.Literal("schedule_updated"),
    ...scheduleUpdatedPayload.properties,
  }),
]);

export const schemas = {
  busServerMessage,
  busClientMessage,
  scheduleServerEvent,
} as const;

export type BusServerMessage = Static<typeof busServerMessage>;
export type BusClientMessage = Static<typeof busClientMessage>;
export type ScheduleServerEvent = Static<typeof scheduleServerEvent>;

export function parseBusServerMessage(payload: unknown): BusServerMessage {
  return parseContract(busServerMessage, payload);
}

export function parseBusClientMessage(payload: unknown): BusClientMessage {
  return parseContract(busClientMessage, payload);
}

export function parseScheduleServerEvent(payload: unknown): ScheduleServerEvent {
  return parseContract(scheduleServerEvent, payload);
}
