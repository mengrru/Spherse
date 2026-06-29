import { Type, type Static } from "@sinclair/typebox";

const sessionInfo = Type.Object({
  id: Type.String(),
  agentId: Type.String(),
  title: Type.Optional(Type.String()),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
  status: Type.Union([Type.Literal("active"), Type.Literal("archived")]),
  source: Type.Optional(Type.Union([Type.Literal("manual"), Type.Literal("scheduled")])),
});

export const schemas = {
  sessionInfo,
  sessionListResponse: Type.Array(sessionInfo),
  sessionListPageResponse: Type.Object({
    items: Type.Array(sessionInfo),
    hasMore: Type.Boolean(),
  }),
  sessionCreateResponse: Type.Object({ sessionId: Type.String() }),
  sessionRenameRequest: Type.Object({ title: Type.String() }),
  sessionMessagesResponse: Type.Array(Type.Unknown()),
  sessionMessagesPageResponse: Type.Object({
    messages: Type.Array(Type.Unknown()),
    hasMore: Type.Boolean(),
    oldestId: Type.Union([Type.Number(), Type.Null()]),
  }),
} as const;

export type SessionInfoContract = Static<typeof sessionInfo>;
export type SessionListResponse = Static<typeof schemas.sessionListResponse>;
export type SessionListPageResponse = Static<typeof schemas.sessionListPageResponse>;
export type SessionCreateResponse = Static<typeof schemas.sessionCreateResponse>;
export type SessionRenameRequest = Static<typeof schemas.sessionRenameRequest>;
export type SessionMessagesResponse = Static<typeof schemas.sessionMessagesResponse>;
export type SessionMessagesPageResponse = Static<typeof schemas.sessionMessagesPageResponse>;
