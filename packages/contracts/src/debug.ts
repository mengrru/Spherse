import { Type, type Static } from "@sinclair/typebox";

const turnContextCompactionMeta = Type.Object({
  seq: Type.Integer(),
  anchorSeq: Type.Integer(),
  digestSource: Type.Union([Type.Literal("llm"), Type.Literal("mechanical"), Type.Null()]),
  excludedCount: Type.Integer({ minimum: 0 }),
  digestLength: Type.Integer({ minimum: 0 }),
  appliedAtMs: Type.Integer(),
});

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
  compaction: Type.Union([turnContextCompactionMeta, Type.Null()]),
  compactionCount: Type.Integer({ minimum: 0 }),
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
  turnContextCompactionMeta,
  sessionEventLog,
} as const;

export type TurnContextSnapshotContract = Static<typeof turnContextSnapshot>;
export type TurnContextCompactionMetaContract = Static<typeof turnContextCompactionMeta>;
export type DebugSessionEventContract = Static<typeof debugSessionEvent>;
export type SessionEventLogContract = Static<typeof sessionEventLog>;
