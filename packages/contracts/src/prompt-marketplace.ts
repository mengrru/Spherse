import { Type, type Static } from "@sinclair/typebox";

const marketplacePromptEntry = Type.Object({
  id: Type.String(),
  title: Type.String(),
  description: Type.String(),
  category: Type.String(),
  content: Type.String(),
});

export const schemas = {
  marketplacePromptEntry,
  marketplacePromptManifestResponse: Type.Object({
    schemaVersion: Type.Number(),
    generatedAt: Type.String(),
    language: Type.String(),
    prompts: Type.Array(marketplacePromptEntry),
  }),
} as const;

export type MarketplacePromptEntry = Static<typeof marketplacePromptEntry>;
export type MarketplacePromptManifestResponse = Static<typeof schemas.marketplacePromptManifestResponse>;
