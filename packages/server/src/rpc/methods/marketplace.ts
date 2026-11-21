import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { schemas, parseContract } from "@spherse/contracts";
import { installMarketplaceProjectZip } from "@spherse/core";
import { RpcAppError, defineRpcMethod, type RpcMethodEntry } from "../context.js";
import { projectMarketplaceService } from "../../marketplace.js";
import { promptMarketplaceService } from "../../prompt-marketplace.js";

const projects = defineRpcMethod(
  Type.Object({}, { additionalProperties: false }),
  async () => {
    return parseContract(
      schemas.marketplaceProjectManifestResponse,
      await projectMarketplaceService.getManifest(),
    );
  },
);

const installProject = defineRpcMethod(
  Type.Object(
    {
      name: Type.String(),
      version: Type.String(),
      destDir: Type.String(),
    },
    { additionalProperties: false },
  ),
  async (params) => {
    const manifest = await projectMarketplaceService.getManifest();
    const entry = manifest.projects.find((p) => p.name === params.name);
    if (!entry) {
      throw new RpcAppError(100, `Project "${params.name}" is not available in the marketplace`);
    }
    if (entry.version !== params.version) {
      throw new RpcAppError(102, "Marketplace manifest has been updated, please refresh and retry");
    }
    if (!path.isAbsolute(params.destDir)) {
      throw new RpcAppError(-32602, "destDir must be an absolute path");
    }
    const destStat = await fs.stat(params.destDir).catch(() => null);
    if (!destStat?.isDirectory()) {
      throw new RpcAppError(-32602, `destDir is not a directory: ${params.destDir}`);
    }
    const zipPath = await projectMarketplaceService.downloadZip(entry);
    try {
      const result = await installMarketplaceProjectZip(zipPath, params.destDir);
      return parseContract(schemas.projectMarketplaceInstallResponse, {
        projectRoot: result.projectRoot,
      });
    } finally {
      await fs.rm(zipPath, { force: true });
    }
  },
);

const prompts = defineRpcMethod(
  Type.Object(
    {
      language: Type.Optional(
        Type.String({ pattern: "^[a-z]{2}(-[a-z]{2})?$" }),
      ),
    },
    { additionalProperties: false },
  ),
  async (params) => {
    return parseContract(
      schemas.marketplacePromptManifestResponse,
      await promptMarketplaceService.getPrompts(params.language ?? "en-us"),
    );
  },
);

export const marketplaceMethods: Record<string, RpcMethodEntry> = {
  "marketplace.projects": projects,
  "marketplace.installProject": installProject,
  "marketplace.prompts": prompts,
};
