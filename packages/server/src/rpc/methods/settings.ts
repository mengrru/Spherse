import fs from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import { schemas, parseContract } from "@spherse/contracts";
import { getImageSupportedProviders, resolveProjectPath } from "@spherse/core";
import { defineRpcMethod, type RpcMethodEntry } from "@spherse/rpc/host";

const supportedProviders = defineRpcMethod(Type.Object({}), (_params, ctx) =>
  parseContract(schemas.providerCatalog, ctx.registry.getSupportedProviders()),
);

const imageProviders = defineRpcMethod(Type.Object({}), () =>
  parseContract(schemas.providerCatalog, getImageSupportedProviders()),
);

const getModels = defineRpcMethod(Type.Object({}), (_params, ctx) =>
  parseContract(schemas.modelSettingsResponse, ctx.modelSettings.sanitize()),
);

const updateModels = defineRpcMethod(schemas.modelSettingsRequest, (params, ctx) =>
  parseContract(schemas.modelSettingsResponse, ctx.modelSettings.apply(params)),
);

const getAiAccess = defineRpcMethod(Type.Object({ projectId: Type.String() }), (params, ctx) => {
  const { projectManager } = ctx.resolveProject(params.projectId);
  return parseContract(schemas.aiAccessSettingsResponse, {
    ok: true,
    ...projectManager.getAiAccessSettings(),
  });
});

const updateAiAccess = defineRpcMethod(
  Type.Object({ projectId: Type.String(), ...schemas.aiAccessSettingsRequest.properties }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const settings = await projectManager.updateAiAccessSettings(params.deniedPaths);
    return parseContract(schemas.aiAccessSettingsResponse, { ok: true, ...settings });
  },
);

const getWelcomePage = defineRpcMethod(Type.Object({ projectId: Type.String() }), (params, ctx) => {
  const { projectManager } = ctx.resolveProject(params.projectId);
  return parseContract(schemas.welcomePageSettingsResponse, {
    ok: true,
    ...projectManager.getWelcomePageSettings(),
  });
});

const updateWelcomePage = defineRpcMethod(
  Type.Object({ projectId: Type.String(), ...schemas.welcomePageSettingsRequest.properties }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const settings = await projectManager.updateWelcomePageSettings(params.path);
    return parseContract(schemas.welcomePageSettingsResponse, { ok: true, ...settings });
  },
);

const getSidePanel = defineRpcMethod(Type.Object({ projectId: Type.String() }), (params, ctx) => {
  const { projectManager } = ctx.resolveProject(params.projectId);
  return parseContract(schemas.sidePanelSettingsResponse, {
    ok: true,
    ...projectManager.getSidePanelSettings(),
  });
});

const updateSidePanel = defineRpcMethod(
  Type.Object({ projectId: Type.String(), ...schemas.sidePanelSettingsRequest.properties }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const settings = await projectManager.updateSidePanelSettings(params.path);
    return parseContract(schemas.sidePanelSettingsResponse, { ok: true, ...settings });
  },
);

const getTheme = defineRpcMethod(Type.Object({ projectId: Type.String() }), async (params, ctx) => {
  const { projectManager } = ctx.resolveProject(params.projectId);
  const root = projectManager.getRootPath();
  const absolutePath = resolveProjectPath(root, ".spherse/theme.css");
  let content = "";
  try {
    content = await fs.readFile(absolutePath, "utf-8");
  } catch {
    content = "";
  }
  return parseContract(schemas.themeSettingsResponse, { ok: true, content });
});

const updateTheme = defineRpcMethod(
  Type.Object({ projectId: Type.String(), ...schemas.themeSettingsRequest.properties }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    await projectManager.writeFile(".spherse/theme.css", params.content);
    return parseContract(schemas.okResponse, { ok: true });
  },
);

export const settingsMethods: Record<string, RpcMethodEntry> = {
  "settings.supportedProviders": supportedProviders,
  "settings.imageProviders": imageProviders,
  "settings.getModels": getModels,
  "settings.updateModels": updateModels,
  "settings.getAiAccess": getAiAccess,
  "settings.updateAiAccess": updateAiAccess,
  "settings.getWelcomePage": getWelcomePage,
  "settings.updateWelcomePage": updateWelcomePage,
  "settings.getSidePanel": getSidePanel,
  "settings.updateSidePanel": updateSidePanel,
  "settings.getTheme": getTheme,
  "settings.updateTheme": updateTheme,
};
