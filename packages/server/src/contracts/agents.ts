import { Type, type Static } from "@sinclair/typebox";

const agentProfile = Type.Object({
  id: Type.String(),
  name: Type.String(),
  alias: Type.Optional(Type.String()),
  slug: Type.String(),
  createdAt: Type.Optional(Type.Number()),
  model: Type.Optional(Type.String()),
  schedule: Type.Optional(Type.Boolean()),
  tools: Type.Optional(Type.Array(Type.String())),
  context: Type.Optional(Type.Array(Type.String())),
  output: Type.Optional(
    Type.Object({
      path: Type.String(),
      naming: Type.String(),
      frontmatter: Type.Optional(Type.Record(Type.String(), Type.String())),
    }),
  ),
  systemPrompt: Type.String(),
  filePath: Type.String(),
});

export const schemas = {
  agentProfile,
  agentListResponse: Type.Array(agentProfile),
  agentRawResponse: Type.Object({ content: Type.String() }),
  agentCreateRequest: Type.Object({
    slugBase: Type.String(),
    content: Type.String(),
    themeContent: Type.Optional(Type.String()),
  }),
  agentCreateResponse: Type.Object({ ok: Type.Boolean(), id: Type.String() }),
  agentUpdateRequest: Type.Object({
    content: Type.String(),
    themeContent: Type.Optional(Type.String()),
  }),
  agentUpdateResponse: Type.Object({ ok: Type.Boolean(), id: Type.String() }),
} as const;

export type AgentProfileContract = Static<typeof agentProfile>;
export type AgentListResponse = Static<typeof schemas.agentListResponse>;
export type AgentRawResponse = Static<typeof schemas.agentRawResponse>;
export type AgentCreateRequest = Static<typeof schemas.agentCreateRequest>;
export type AgentCreateResponse = Static<typeof schemas.agentCreateResponse>;
export type AgentUpdateRequest = Static<typeof schemas.agentUpdateRequest>;
export type AgentUpdateResponse = Static<typeof schemas.agentUpdateResponse>;
