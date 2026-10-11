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
  custom: Type.Optional(Type.Boolean()),
  keyless: Type.Optional(Type.Boolean()),
  baseUrl: Type.Optional(Type.String()),
});

const samplingParams = Type.Object({
  temperature: Type.Optional(Type.Number()),
  topP: Type.Optional(Type.Number()),
});

const thinkingLevel = Type.Union([
  Type.Literal("off"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
]);

const customProviderDef = Type.Object({
  id: Type.String(),
  name: Type.String(),
  baseUrl: Type.String(),
  models: Type.Array(Type.String()),
  keyless: Type.Boolean(),
  contextWindow: Type.Optional(Type.Number()),
  maxTokens: Type.Optional(Type.Number()),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
});

const providerCredentialsWrite = Type.Object({
  apiKey: Type.Optional(Type.String()),
});

const modelGroupPublic = Type.Object({
  defaultModel: Type.String(),
  providers: Type.Record(Type.String(), Type.Object({ configured: Type.Boolean() })),
  sampling: Type.Optional(samplingParams),
  thinkingLevel: Type.Optional(thinkingLevel),
});

const imageGroupPublic = Type.Object({
  defaultModel: Type.String(),
  providers: Type.Record(Type.String(), Type.Object({ configured: Type.Boolean() })),
});

const modelGroupWrite = Type.Object({
  defaultModel: Type.String(),
  providers: Type.Optional(Type.Record(Type.String(), providerCredentialsWrite)),
  sampling: Type.Optional(samplingParams),
  thinkingLevel: Type.Optional(thinkingLevel),
});

const imageGroupWrite = Type.Object({
  defaultModel: Type.String(),
  providers: Type.Optional(Type.Record(Type.String(), providerCredentialsWrite)),
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
    path: Type.Union([Type.Null(), Type.String()]),
  }),
  welcomePageSettingsResponse: Type.Object({
    ok: Type.Boolean(),
    path: Type.Union([Type.Null(), Type.String()]),
  }),
  sidePanelSettingsRequest: Type.Object({
    path: Type.Union([Type.Null(), Type.String()]),
  }),
  sidePanelSettingsResponse: Type.Object({
    ok: Type.Boolean(),
    path: Type.Union([Type.Null(), Type.String()]),
  }),
  themeSettingsRequest: Type.Object({
    content: Type.String(),
  }),
  themeSettingsResponse: Type.Object({
    ok: Type.Boolean(),
    content: Type.String(),
  }),
  modelSettingsRequest: Type.Object({
    models: Type.Object({
      text: modelGroupWrite,
      image: imageGroupWrite,
    }),
    customProviders: Type.Optional(Type.Array(customProviderDef)),
  }),
  modelSettingsResponse: Type.Object({
    models: Type.Object({
      text: modelGroupPublic,
      image: imageGroupPublic,
    }),
    customProviders: Type.Array(customProviderDef),
  }),
} as const;

export type ProviderCatalogItemContract = Static<typeof providerCatalogItem>;
export type ProviderCatalogContract = Static<typeof schemas.providerCatalog>;
export type AiAccessSettingsRequest = Static<typeof schemas.aiAccessSettingsRequest>;
export type AiAccessSettingsResponse = Static<typeof schemas.aiAccessSettingsResponse>;
export type WelcomePageSettingsRequest = Static<typeof schemas.welcomePageSettingsRequest>;
export type WelcomePageSettingsResponse = Static<typeof schemas.welcomePageSettingsResponse>;
export type SidePanelSettingsRequest = Static<typeof schemas.sidePanelSettingsRequest>;
export type SidePanelSettingsResponse = Static<typeof schemas.sidePanelSettingsResponse>;
export type ThemeSettingsRequest = Static<typeof schemas.themeSettingsRequest>;
export type ThemeSettingsResponse = Static<typeof schemas.themeSettingsResponse>;
export type CustomProviderDefContract = Static<typeof customProviderDef>;
export type ModelSettingsRequest = Static<typeof schemas.modelSettingsRequest>;
export type ModelSettingsResponse = Static<typeof schemas.modelSettingsResponse>;
