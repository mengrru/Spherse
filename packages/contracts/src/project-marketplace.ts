import { Type, type Static } from "@sinclair/typebox";

const marketplaceProjectEntry = Type.Object({
  name: Type.String(),
  description: Type.String(),
  version: Type.String(),
  category: Type.String(),
  zipUrl: Type.String(),
  size: Type.Number(),
  updatedAt: Type.String(),
});

export const schemas = {
  marketplaceProjectEntry,
  marketplaceProjectManifestResponse: Type.Object({
    schemaVersion: Type.Number(),
    generatedAt: Type.String(),
    projects: Type.Array(marketplaceProjectEntry),
  }),
  projectMarketplaceInstallRequest: Type.Object({
    name: Type.String(),
    version: Type.String(),
    destDir: Type.String(),
  }),
  projectMarketplaceInstallResponse: Type.Object({
    projectRoot: Type.String(),
  }),
} as const;

export type MarketplaceProjectEntry = Static<typeof marketplaceProjectEntry>;
export type MarketplaceProjectManifestResponse = Static<typeof schemas.marketplaceProjectManifestResponse>;
export type ProjectMarketplaceInstallRequest = Static<typeof schemas.projectMarketplaceInstallRequest>;
export type ProjectMarketplaceInstallResponse = Static<typeof schemas.projectMarketplaceInstallResponse>;
