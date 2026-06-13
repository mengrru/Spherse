import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const FileEntrySchema = Type.Object({
  name: Type.String(),
  type: Type.Union([Type.Literal("file"), Type.Literal("directory")]),
});
const ChatServerEventSchema = Type.Union([
  Type.Object({ type: Type.Literal("agent_start") }),
  Type.Object({ type: Type.Literal("agent_end"), messages: Type.Array(Type.Any()) }),
  Type.Object({ type: Type.Literal("turn_start") }),
  Type.Object({
    type: Type.Literal("turn_end"),
    message: Type.Any(),
    toolResults: Type.Array(Type.Any()),
  }),
  Type.Object({ type: Type.Literal("message_start"), message: Type.Any() }),
  Type.Object({ type: Type.Literal("message_update"), message: Type.Any(), assistantMessageEvent: Type.Optional(Type.Any()) }),
  Type.Object({ type: Type.Literal("message_end"), message: Type.Any() }),
  Type.Object({
    type: Type.Literal("tool_execution_start"),
    toolCallId: Type.String(),
    toolName: Type.String(),
    args: Type.Any(),
  }),
  Type.Object({
    type: Type.Literal("tool_execution_update"),
    toolCallId: Type.String(),
    toolName: Type.String(),
    args: Type.Any(),
    partialResult: Type.Any(),
  }),
  Type.Object({
    type: Type.Literal("tool_execution_end"),
    toolCallId: Type.String(),
    toolName: Type.String(),
    result: Type.Any(),
    isError: Type.Boolean(),
  }),
  Type.Object({ type: Type.Literal("error"), message: Type.String() }),
]);
const ScheduleEntrySchema = Type.Object({
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
const ScheduleServerEventSchema = Type.Union([
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
    schedule: Type.Optional(ScheduleEntrySchema),
  }),
]);
export const schemas = {
  okResponse: Type.Object({ ok: Type.Boolean() }),
  errorResponse: Type.Object({ error: Type.String() }),
  createSessionRequest: Type.Object({}),
  createSessionResponse: Type.Object({ sessionId: Type.String() }),
  sessionInfo: Type.Object({
    id: Type.String(),
    agentId: Type.String(),
    title: Type.Optional(Type.String()),
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
    status: Type.Union([Type.Literal("active"), Type.Literal("archived")]),
    source: Type.Optional(Type.Union([Type.Literal("manual"), Type.Literal("scheduled")])),
  }),
  renameSessionRequest: Type.Object({ title: Type.String() }),
  saveContentRequest: Type.Object({ content: Type.String() }),
  createContentRequest: Type.Object({
    action: Type.Union([Type.Literal("mkdir"), Type.Literal("touch")]),
  }),
  fileEntry: FileEntrySchema,
  fileEntries: Type.Array(FileEntrySchema),
  fileTreeResponse: Type.Array(Type.String()),
  contentResponse: Type.Object({
    content: Type.String(),
    path: Type.String(),
  }),
  aiAccessSettingsRequest: Type.Object({
    deniedPaths: Type.Array(Type.String()),
  }),
  aiAccessSettingsResponse: Type.Object({
    ok: Type.Boolean(),
    deniedPaths: Type.Array(Type.String()),
  }),
  welcomePageSettingsRequest: Type.Object({
    path: Type.Union([Type.String(), Type.Null()]),
  }),
  welcomePageSettingsResponse: Type.Object({
    ok: Type.Boolean(),
    path: Type.Union([Type.String(), Type.Null()]),
  }),
  scheduleEntry: ScheduleEntrySchema,
  createScheduleRequest: Type.Object({
    name: Type.Optional(Type.String()),
    cron: Type.String(),
    mode: Type.Union([Type.Literal("new_session"), Type.Literal("existing_session")]),
    targetSessionId: Type.Optional(Type.String()),
    message: Type.String(),
    notify: Type.Boolean(),
    notificationMessage: Type.Optional(Type.String({ maxLength: 30 })),
  }),
  updateScheduleRequest: Type.Object({
    name: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
    cron: Type.Optional(Type.String()),
    mode: Type.Optional(Type.Union([Type.Literal("new_session"), Type.Literal("existing_session")])),
    targetSessionId: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
    notify: Type.Optional(Type.Boolean()),
    notificationMessage: Type.Optional(Type.String({ maxLength: 30 })),
  }),
  scheduleLogEntry: Type.Object({
    scheduleId: Type.String(),
    scheduleName: Type.Optional(Type.String()),
    agentName: Type.Optional(Type.String()),
    sessionId: Type.String(),
    triggeredAt: Type.Number(),
    completedAt: Type.Optional(Type.Number()),
    status: Type.Union([Type.Literal("running"), Type.Literal("success"), Type.Literal("failed")]),
    error: Type.Optional(Type.String()),
  }),
  chatClientMessage: Type.Union([
    Type.Object({ type: Type.Literal("message"), content: Type.String() }),
    Type.Object({ type: Type.Literal("abort") }),
  ]),
  chatServerEvent: ChatServerEventSchema,
  scheduleServerEvent: ScheduleServerEventSchema,
} as const;

export type OkResponse = Static<typeof schemas.okResponse>;
export type CreateSessionRequest = Static<typeof schemas.createSessionRequest>;
export type CreateSessionResponse = Static<typeof schemas.createSessionResponse>;
export type SessionInfoContract = Static<typeof schemas.sessionInfo>;
export type RenameSessionRequest = Static<typeof schemas.renameSessionRequest>;
export type SaveContentRequest = Static<typeof schemas.saveContentRequest>;
export type CreateContentRequest = Static<typeof schemas.createContentRequest>;
export type FileEntryContract = Static<typeof schemas.fileEntry>;
export type FileTreeResponse = Static<typeof schemas.fileTreeResponse>;
export type ContentResponseContract = Static<typeof schemas.contentResponse>;
export type AiAccessSettingsRequest = Static<typeof schemas.aiAccessSettingsRequest>;
export type AiAccessSettingsResponse = Static<typeof schemas.aiAccessSettingsResponse>;
export type WelcomePageSettingsRequest = Static<typeof schemas.welcomePageSettingsRequest>;
export type WelcomePageSettingsResponse = Static<typeof schemas.welcomePageSettingsResponse>;
export type ChatClientMessage = Static<typeof schemas.chatClientMessage>;
export type ChatServerEvent = Static<typeof ChatServerEventSchema>;
export type CreateScheduleRequest = Static<typeof schemas.createScheduleRequest>;
export type UpdateScheduleRequest = Static<typeof schemas.updateScheduleRequest>;
export type ScheduleLogEntryContract = Static<typeof schemas.scheduleLogEntry>;
export type ScheduleServerEvent = Static<typeof ScheduleServerEventSchema>;

export function parseContract<T extends TSchema>(schema: T, payload: unknown): Static<T> {
  if (!Value.Check(schema, payload)) {
    const firstError = [...Value.Errors(schema, payload)][0];
    const message = firstError?.message ?? "unknown validation error";
    throw new Error(`Invalid payload: ${message}`);
  }
  return Value.Parse(schema, payload);
}

export function parseApiResponse<T extends TSchema>(schema: T, payload: unknown): Static<T> {
  return parseContract(schema, payload);
}

export function parseChatClientMessage(payload: unknown): ChatClientMessage {
  return parseContract(schemas.chatClientMessage, payload);
}

export function parseChatServerEvent(payload: unknown): ChatServerEvent {
  return parseContract(ChatServerEventSchema, payload);
}

export function parseScheduleServerEvent(payload: unknown): ScheduleServerEvent {
  return parseContract(ScheduleServerEventSchema, payload);
}
