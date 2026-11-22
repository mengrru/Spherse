import fs from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import { schemas, parseContract } from "@spherse/contracts";
import { RpcAppError, defineRpcMethod, type RpcMethodEntry } from "@spherse/rpc/host";
import { marketplaceService } from "../../marketplace.js";

const create = defineRpcMethod(
  Type.Object(
    {
      projectId: Type.String(),
      name: Type.String(),
      description: Type.String(),
      instructions: Type.String(),
    },
    { additionalProperties: false },
  ),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const skill = await projectManager.createSkill(
      params.name,
      params.description,
      params.instructions,
    );
    return parseContract(schemas.skillDefinition, skill);
  },
);

const install = defineRpcMethod(
  Type.Object(
    { projectId: Type.String(), zipPath: Type.String() },
    { additionalProperties: false },
  ),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const skill = await projectManager.installSkill(params.zipPath);
    return parseContract(schemas.skillDefinition, skill);
  },
);

const list = defineRpcMethod(
  Type.Object({ projectId: Type.String() }, { additionalProperties: false }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const skills = await projectManager.listSkills();
    return parseContract(
      schemas.skillListResponse,
      skills.map(({ instructions: _instructions, ...summary }) => summary),
    );
  },
);

const installMarketplace = defineRpcMethod(
  Type.Object(
    {
      projectId: Type.String(),
      name: Type.String(),
      version: Type.String(),
    },
    { additionalProperties: false },
  ),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const manifest = await marketplaceService.getManifest();
    const entry = manifest.skills.find((s) => s.name === params.name);
    if (!entry) {
      throw new RpcAppError(100, `Skill "${params.name}" is not available in the marketplace`);
    }
    if (entry.version !== params.version) {
      throw new RpcAppError(102, "Marketplace manifest has been updated, please refresh and retry");
    }
    const zipPath = await marketplaceService.downloadZip(entry);
    try {
      const skill = await projectManager.installSkill(zipPath, { overwrite: true });
      return parseContract(schemas.skillDefinition, skill);
    } finally {
      await fs.rm(zipPath, { force: true });
    }
  },
);

const listMarketplace = defineRpcMethod(
  Type.Object({ projectId: Type.String() }),
  async () => {
    return parseContract(schemas.marketplaceManifestResponse, await marketplaceService.getManifest());
  },
);

export const skillMethods: Record<string, RpcMethodEntry> = {
  "skills.create": create,
  "skills.install": install,
  "skills.list": list,
  "skills.listMarketplace": listMarketplace,
  "skills.installMarketplace": installMarketplace,
};
