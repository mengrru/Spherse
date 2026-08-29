import { Type, type Static } from "@sinclair/typebox";

const marketplaceSkillEntry = Type.Object({
  name: Type.String(),
  description: Type.String(),
  version: Type.String(),
  zipUrl: Type.String(),
  size: Type.Number(),
  updatedAt: Type.String(),
});

export const schemas = {
  marketplaceSkillEntry,
  marketplaceManifestResponse: Type.Object({
    schemaVersion: Type.Number(),
    generatedAt: Type.String(),
    skills: Type.Array(marketplaceSkillEntry),
  }),
  skillMarketplaceInstallRequest: Type.Object({
    name: Type.String(),
    version: Type.String(),
  }),
} as const;

export type MarketplaceSkillEntry = Static<typeof marketplaceSkillEntry>;
export type MarketplaceManifestResponse = Static<typeof schemas.marketplaceManifestResponse>;
export type SkillMarketplaceInstallRequest = Static<typeof schemas.skillMarketplaceInstallRequest>;
