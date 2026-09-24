import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/contracts";
import type {
  ProjectMarketplaceInstallRequest,
  MarketplaceProjectEntry,
  MarketplaceProjectManifestResponse,
} from "@spherse/contracts";
import { installMarketplaceProjectZip } from "@spherse/core";
import { notFound, conflict, badRequest } from "../errors.js";
import {
  projectMarketplaceService,
  type MarketplaceService,
} from "../marketplace.js";

export function registerProjectMarketplaceRoutes(
  fastify: FastifyInstance,
  options?: {
    projectMarketplace?: MarketplaceService<MarketplaceProjectManifestResponse, MarketplaceProjectEntry>;
  },
): void {
  const marketplace = options?.projectMarketplace ?? projectMarketplaceService;

  fastify.get(
    "/api/marketplace/projects",
    {
      schema: { response: { 200: schemas.marketplaceProjectManifestResponse } },
      async handler() {
        return marketplace.getManifest();
      },
    },
  );

  fastify.post<{ Body: ProjectMarketplaceInstallRequest }>(
    "/api/marketplace/projects/install",
    {
      schema: {
        body: schemas.projectMarketplaceInstallRequest,
        response: { 200: schemas.projectMarketplaceInstallResponse },
      },
      async handler(req) {
        const { name, version, destDir } = req.body;
        const manifest = await marketplace.getManifest();
        const entry = manifest.projects.find((p) => p.name === name);
        if (!entry) throw notFound(`Project "${name}" is not available in the marketplace`);
        if (entry.version !== version) {
          throw conflict("Marketplace manifest has been updated, please refresh and retry");
        }
        if (!path.isAbsolute(destDir)) {
          throw badRequest("destDir must be an absolute path");
        }
        const destStat = await fs.stat(destDir).catch(() => null);
        if (!destStat?.isDirectory()) {
          throw badRequest(`destDir is not a directory: ${destDir}`);
        }

        const zipPath = await marketplace.downloadZip(entry);
        try {
          const result = await installMarketplaceProjectZip(zipPath, destDir);
          return { projectRoot: result.projectRoot };
        } finally {
          await fs.rm(zipPath, { force: true });
        }
      },
    },
  );
}
