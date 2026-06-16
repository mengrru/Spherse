import { Type, type Static } from "@sinclair/typebox";

const providerModelItem = Type.Object({
  id: Type.String(),
  name: Type.String(),
  provider: Type.String(),
  api: Type.String(),
  reasoning: Type.Boolean(),
  input: Type.Array(Type.String()),
  contextWindow: Type.Optional(Type.Number()),
  maxTokens: Type.Optional(Type.Number()),
});

const providerCatalogItem = Type.Object({
  id: Type.String(),
  name: Type.String(),
  auth: Type.Object({
    type: Type.Union([Type.Literal("apiKey"), Type.Literal("external"), Type.Literal("unknown")]),
    envKeys: Type.Array(Type.String()),
  }),
  models: Type.Array(providerModelItem),
});

export const schemas = {
  providerCatalogItem,
  providerCatalog: Type.Record(Type.String(), providerCatalogItem),
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
} as const;

export type ProviderCatalogItemContract = Static<typeof providerCatalogItem>;
export type ProviderCatalogContract = Static<typeof schemas.providerCatalog>;
export type AiAccessSettingsRequest = Static<typeof schemas.aiAccessSettingsRequest>;
export type AiAccessSettingsResponse = Static<typeof schemas.aiAccessSettingsResponse>;
export type WelcomePageSettingsRequest = Static<typeof schemas.welcomePageSettingsRequest>;
export type WelcomePageSettingsResponse = Static<typeof schemas.welcomePageSettingsResponse>;
