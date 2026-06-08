import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const UnknownRecord = Type.Record(Type.String(), Type.Unknown());
const FileEntrySchema = Type.Object({
  name: Type.String(),
  type: Type.Union([Type.Literal("file"), Type.Literal("directory")]),
});
const KnownChatServerEventSchema = Type.Union([
  Type.Object({ type: Type.Literal("message_update"), message: Type.Unknown() }),
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
  Type.Object({ type: Type.Literal("agent_end_done") }),
  Type.Object({ type: Type.Literal("error"), message: Type.String() }),
]);
const ExtendedChatServerEventSchema = Type.Intersect([
  Type.Object({ type: Type.String() }),
  UnknownRecord,
]);
const knownChatServerEventTypes = new Set([
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "agent_end_done",
  "error",
]);

export const schemas = {
  okResponse: Type.Object({ ok: Type.Boolean() }),
  errorResponse: Type.Object({ error: Type.String() }),
  createSessionRequest: Type.Object({ agentId: Type.String({ minLength: 1 }) }),
  createSessionResponse: Type.Object({ sessionId: Type.String() }),
  sessionInfo: Type.Object({
    id: Type.String(),
    agentId: Type.String(),
    title: Type.Optional(Type.String()),
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
    status: Type.Union([Type.Literal("active"), Type.Literal("archived")]),
  }),
  renameSessionRequest: Type.Object({ title: Type.String() }),
  saveContentRequest: Type.Object({ content: Type.String() }),
  createContentRequest: Type.Object({
    action: Type.Union([Type.Literal("mkdir"), Type.Literal("touch")]),
  }),
  fileEntry: FileEntrySchema,
  fileEntries: Type.Array(FileEntrySchema),
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
  chatClientMessage: Type.Union([
    Type.Object({ type: Type.Literal("message"), content: Type.String() }),
    Type.Object({ type: Type.Literal("abort") }),
  ]),
  chatServerEvent: Type.Union([
    KnownChatServerEventSchema,
    ExtendedChatServerEventSchema,
  ]),
} as const;

export type OkResponse = Static<typeof schemas.okResponse>;
export type CreateSessionRequest = Static<typeof schemas.createSessionRequest>;
export type CreateSessionResponse = Static<typeof schemas.createSessionResponse>;
export type SessionInfoContract = Static<typeof schemas.sessionInfo>;
export type RenameSessionRequest = Static<typeof schemas.renameSessionRequest>;
export type SaveContentRequest = Static<typeof schemas.saveContentRequest>;
export type CreateContentRequest = Static<typeof schemas.createContentRequest>;
export type FileEntryContract = Static<typeof schemas.fileEntry>;
export type ContentResponseContract = Static<typeof schemas.contentResponse>;
export type AiAccessSettingsRequest = Static<typeof schemas.aiAccessSettingsRequest>;
export type AiAccessSettingsResponse = Static<typeof schemas.aiAccessSettingsResponse>;
export type WelcomePageSettingsRequest = Static<typeof schemas.welcomePageSettingsRequest>;
export type WelcomePageSettingsResponse = Static<typeof schemas.welcomePageSettingsResponse>;
export type ChatClientMessage = Static<typeof schemas.chatClientMessage>;
export type ChatServerEvent = Static<typeof schemas.chatServerEvent>;

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
  if (
    payload &&
    typeof payload === "object" &&
    "type" in payload &&
    typeof payload.type === "string" &&
    knownChatServerEventTypes.has(payload.type)
  ) {
    return parseContract(KnownChatServerEventSchema, payload);
  }
  return parseContract(ExtendedChatServerEventSchema, payload);
}
