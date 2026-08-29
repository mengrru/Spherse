import { Type, type Static } from "@sinclair/typebox";

export const triggerEntry = Type.Object({
  id: Type.String(),
  name: Type.Optional(Type.String()),
  enabled: Type.Boolean(),
  type: Type.Union([Type.Literal("time"), Type.Literal("event")]),
  cron: Type.Optional(Type.String()),
  eventName: Type.Optional(Type.String()),
  mode: Type.Union([
    Type.Literal("new_session"),
    Type.Literal("existing_session"),
    Type.Literal("reusable_session"),
  ]),
  targetSessionId: Type.Optional(Type.String()),
  boundSessionId: Type.Optional(Type.String()),
  message: Type.String(),
  notify: Type.Boolean(),
  notificationMessage: Type.Optional(Type.String({ maxLength: 30 })),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
});

const triggerInfoEntry = Type.Intersect([
  triggerEntry,
  Type.Object({ nextTriggerAt: Type.Union([Type.Number(), Type.Null()]) }),
]);

const triggerLogEntry = Type.Object({
  triggerId: Type.String(),
  triggerName: Type.Optional(Type.String()),
  agentName: Type.Optional(Type.String()),
  eventName: Type.Optional(Type.String()),
  sessionId: Type.String(),
  triggeredAt: Type.Number(),
  completedAt: Type.Optional(Type.Number()),
  status: Type.Union([Type.Literal("running"), Type.Literal("success"), Type.Literal("failed")]),
  error: Type.Optional(Type.String()),
});

export const schemas = {
  triggerEntry,
  triggerInfoEntry,
  triggerListResponse: Type.Array(triggerInfoEntry),
  projectTriggerListResponse: Type.Object({
    ok: Type.Boolean(),
    triggers: Type.Array(
      Type.Composite([triggerInfoEntry, Type.Object({ agentId: Type.String() })]),
    ),
  }),
  triggerCreateRequest: Type.Object(
    {
      name: Type.Optional(Type.String()),
      type: Type.Union([Type.Literal("time"), Type.Literal("event")]),
      cron: Type.Optional(Type.String()),
      eventName: Type.Optional(Type.String()),
      mode: Type.Union([
        Type.Literal("new_session"),
        Type.Literal("existing_session"),
        Type.Literal("reusable_session"),
      ]),
      targetSessionId: Type.Optional(Type.String()),
      message: Type.String(),
      notify: Type.Boolean(),
      notificationMessage: Type.Optional(Type.String({ maxLength: 30 })),
    },
    { additionalProperties: false },
  ),
  triggerUpdateRequest: Type.Object(
    {
      name: Type.Optional(Type.String()),
      enabled: Type.Optional(Type.Boolean()),
      type: Type.Optional(Type.Union([Type.Literal("time"), Type.Literal("event")])),
      cron: Type.Optional(Type.String()),
      eventName: Type.Optional(Type.String()),
      mode: Type.Optional(
        Type.Union([
          Type.Literal("new_session"),
          Type.Literal("existing_session"),
          Type.Literal("reusable_session"),
        ]),
      ),
      targetSessionId: Type.Optional(Type.String()),
      message: Type.Optional(Type.String()),
      notify: Type.Optional(Type.Boolean()),
      notificationMessage: Type.Optional(Type.String({ maxLength: 30 })),
    },
    { additionalProperties: false },
  ),
  triggerLogEntry,
  triggerLogListResponse: Type.Array(triggerLogEntry),
} as const;

export type TriggerEntryContract = Static<typeof triggerEntry>;
export type TriggerInfoEntryContract = Static<typeof triggerInfoEntry>;
export type TriggerListResponse = Static<typeof schemas.triggerListResponse>;
export type ProjectTriggerListResponse = Static<typeof schemas.projectTriggerListResponse>;
export type TriggerCreateRequest = Static<typeof schemas.triggerCreateRequest>;
export type TriggerUpdateRequest = Static<typeof schemas.triggerUpdateRequest>;
export type TriggerLogEntryContract = Static<typeof triggerLogEntry>;
export type TriggerLogListResponse = Static<typeof schemas.triggerLogListResponse>;
