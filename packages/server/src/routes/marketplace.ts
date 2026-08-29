import fs from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { schemas, parseContract } from "@spherse/contracts";
import type { SkillMarketplaceInstallRequest } from "@spherse/contracts";
import type { ProjectRegistry } from "../registry.js";
import { notFound, conflict } from "../errors.js";
import { marketplaceService, type MarketplaceService } from "../marketplace.js";

export function registerMarketplaceRoutes(
  fastify: FastifyInstance,
  _registry: ProjectRegistry,
  options?: { marketplace?: MarketplaceService },
): void {
  const marketplace = options?.marketplace ?? marketplaceService;

  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/marketplace/skills",
    {
      schema: { response: { 200: schemas.marketplaceManifestResponse } },
      async handler() {
        return marketplace.getManifest();
      },
    },
  );

  fastify.post<{ Params: { projectId: string }; Body: SkillMarketplaceInstallRequest }>(
    "/api/projects/:projectId/skills/marketplace-install",
    {
      schema: {
        body: schemas.skillMarketplaceInstallRequest,
        response: { 200: schemas.skillDefinition },
      },
      async handler(req) {
        const { name, version } = req.body;
        const manifest = await marketplace.getManifest();
        const entry = manifest.skills.find((s) => s.name === name);
        if (!entry) throw notFound(`Skill "${name}" is not available in the marketplace`);
        if (entry.version !== version) {
          throw conflict("Marketplace manifest has been updated, please refresh and retry");
        }

        const zipPath = await marketplace.downloadSkillZip(entry);
        try {
          const skill = await req.projectCtx!.projectManager.installSkill(zipPath, { overwrite: true });
          return parseContract(schemas.skillDefinition, skill);
        } finally {
          await fs.rm(zipPath, { force: true });
        }
      },
    },
  );
}
