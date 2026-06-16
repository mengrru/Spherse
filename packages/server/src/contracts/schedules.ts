import { Type, type Static } from "@sinclair/typebox";

const scheduleEntry = Type.Object({
  id: Type.String(),
  name: Type.Optional(Type.String()),
  enabled: Type.Boolean(),
  cron: Type.String(),
  mode: Type.Union([Type.Literal("new_session"), Type.Literal("existing_session")]),
  targetSessionId: Type.Optional(Type.String()),
  message: Type.String(),
  notify: Type.Boolean(),
  notificationMessage: Type.Optional(Type.String({ maxLength: 30 })),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
});

const scheduleInfoEntry = Type.Intersect([
  scheduleEntry,
  Type.Object({ nextTriggerAt: Type.Union([Type.Number(), Type.Null()]) }),
]);

const scheduleLogEntry = Type.Object({
  scheduleId: Type.String(),
  scheduleName: Type.Optional(Type.String()),
  agentName: Type.Optional(Type.String()),
  sessionId: Type.String(),
  triggeredAt: Type.Number(),
  completedAt: Type.Optional(Type.Number()),
  status: Type.Union([Type.Literal("running"), Type.Literal("success"), Type.Literal("failed")]),
  error: Type.Optional(Type.String()),
});

export const schemas = {
  scheduleEntry,
  scheduleInfoEntry,
  scheduleListResponse: Type.Array(scheduleInfoEntry),
  scheduleCreateRequest: Type.Object({
    name: Type.Optional(Type.String()),
    cron: Type.String(),
    mode: Type.Union([Type.Literal("new_session"), Type.Literal("existing_session")]),
    targetSessionId: Type.Optional(Type.String()),
    message: Type.String(),
    notify: Type.Boolean(),
    notificationMessage: Type.Optional(Type.String({ maxLength: 30 })),
  }),
  scheduleUpdateRequest: Type.Object({
    name: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
    cron: Type.Optional(Type.String()),
    mode: Type.Optional(Type.Union([Type.Literal("new_session"), Type.Literal("existing_session")])),
    targetSessionId: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
    notify: Type.Optional(Type.Boolean()),
    notificationMessage: Type.Optional(Type.String({ maxLength: 30 })),
  }),
  scheduleLogEntry,
  scheduleLogListResponse: Type.Array(scheduleLogEntry),
} as const;

export type ScheduleEntryContract = Static<typeof scheduleEntry>;
export type ScheduleInfoEntryContract = Static<typeof scheduleInfoEntry>;
export type ScheduleListResponse = Static<typeof schemas.scheduleListResponse>;
export type ScheduleCreateRequest = Static<typeof schemas.scheduleCreateRequest>;
export type ScheduleUpdateRequest = Static<typeof schemas.scheduleUpdateRequest>;
export type ScheduleLogEntryContract = Static<typeof scheduleLogEntry>;
export type ScheduleLogListResponse = Static<typeof schemas.scheduleLogListResponse>;
