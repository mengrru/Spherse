import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/contracts";
import { badRequest } from "../errors.js";
import { promptMarketplaceService, type PromptMarketplaceService } from "../prompt-marketplace.js";

const PROMPT_LANGUAGE_RE = /^[a-z]{2}(-[a-z]{2})?$/;

export function registerPromptMarketplaceRoutes(
  fastify: FastifyInstance,
  options?: {
    promptMarketplace?: PromptMarketplaceService;
  },
): void {
  const service = options?.promptMarketplace ?? promptMarketplaceService;

  fastify.get<{ Querystring: { language?: string } }>(
    "/api/marketplace/prompts",
    {
      schema: { response: { 200: schemas.marketplacePromptManifestResponse } },
      async handler(req) {
        const language = req.query.language ?? "en-us";
        if (!PROMPT_LANGUAGE_RE.test(language)) {
          throw badRequest(`language must match ${PROMPT_LANGUAGE_RE.source} (got: ${language})`);
        }
        return service.getPrompts(language);
      },
    },
  );
}
