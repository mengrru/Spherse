import { Type, type Static } from "@sinclair/typebox";

const turnContextSnapshot = Type.Object({
  sessionId: Type.String(),
  capturedAt: Type.String(),
  systemPrompt: Type.String(),
  messages: Type.Array(Type.Unknown()),
  tools: Type.Array(
    Type.Object({
      name: Type.String(),
      description: Type.String(),
      parameters: Type.Unknown(),
    }),
  ),
});

const debugSessionEvent = Type.Object({
  seq: Type.Integer(),
  type: Type.String(),
  time: Type.Integer(),
  data: Type.Unknown(),
});

const sessionEventLog = Type.Object({
  sessionId: Type.String(),
  events: Type.Array(debugSessionEvent),
});

export const schemas = {
  turnContextSnapshot,
  sessionEventLog,
} as const;

export type TurnContextSnapshotContract = Static<typeof turnContextSnapshot>;
export type DebugSessionEventContract = Static<typeof debugSessionEvent>;
export type SessionEventLogContract = Static<typeof sessionEventLog>;
