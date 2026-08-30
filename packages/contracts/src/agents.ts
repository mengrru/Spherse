import { Type, type Static } from "@sinclair/typebox";

const timePerceptionConfig = Type.Object({
  enabled: Type.Boolean(),
  epochMs: Type.Number(),
  startMs: Type.Number(),
  flowRate: Type.Number(),
  timeZone: Type.Optional(Type.String()),
});

const agentProfile = Type.Object({
  id: Type.String(),
  name: Type.String(),
  alias: Type.Optional(Type.String()),
  slug: Type.String(),
  createdAt: Type.Optional(Type.Number()),
  model: Type.Optional(Type.String()),
  thinkingLevel: Type.Optional(
    Type.Union([
      Type.Literal("off"),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
    ]),
  ),
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
  timePerception: Type.Optional(timePerceptionConfig),
  yolo: Type.Optional(Type.Boolean()),
  systemPrompt: Type.String(),
  filePath: Type.String(),
});

const mcpServerConfig = Type.Union([
  Type.Object({
    id: Type.String(),
    name: Type.String(),
    enabled: Type.Boolean(),
    transport: Type.Literal("stdio"),
    command: Type.String(),
    args: Type.Optional(Type.Array(Type.String())),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
    cwd: Type.Optional(Type.String()),
  }),
  Type.Object({
    id: Type.String(),
    name: Type.String(),
    enabled: Type.Boolean(),
    transport: Type.Literal("http"),
    url: Type.String(),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  }),
  Type.Object({
    id: Type.String(),
    name: Type.String(),
    enabled: Type.Boolean(),
    transport: Type.Literal("sse"),
    url: Type.String(),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  }),
]);

const agentSummary = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    alias: Type.Optional(Type.String()),
    slug: Type.String(),
    createdAt: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

export const schemas = {
  agentProfile,
  agentSummary,
  agentListResponse: Type.Array(agentSummary),
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
  mcpServerConfig,
  agentMcpResponse: Type.Object({
    servers: Type.Array(mcpServerConfig),
  }),
  agentMcpUpdateRequest: Type.Object({
    servers: Type.Array(mcpServerConfig),
  }),
} as const;

export type AgentProfileContract = Static<typeof agentProfile>;
export type AgentSummaryContract = Static<typeof agentSummary>;
export type AgentListResponse = Static<typeof schemas.agentListResponse>;
export type AgentRawResponse = Static<typeof schemas.agentRawResponse>;
export type AgentCreateRequest = Static<typeof schemas.agentCreateRequest>;
export type AgentCreateResponse = Static<typeof schemas.agentCreateResponse>;
export type AgentUpdateRequest = Static<typeof schemas.agentUpdateRequest>;
export type AgentUpdateResponse = Static<typeof schemas.agentUpdateResponse>;
export type McpServerConfigContract = Static<typeof schemas.mcpServerConfig>;
export type AgentMcpResponse = Static<typeof schemas.agentMcpResponse>;
export type AgentMcpUpdateRequest = Static<typeof schemas.agentMcpUpdateRequest>;
