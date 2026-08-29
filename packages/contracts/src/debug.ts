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

export const schemas = {
  turnContextSnapshot,
} as const;

export type TurnContextSnapshotContract = Static<typeof turnContextSnapshot>;
