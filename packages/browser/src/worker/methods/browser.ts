import { Type } from "@sinclair/typebox";
import { defineRpcMethod, type RpcMethodEntry } from "@spherse/rpc/host";
import type { BrowserProjectRegistry } from "../registry.js";

export function createBrowserRegistryMethods(registry: BrowserProjectRegistry): Record<string, RpcMethodEntry> {
  return {
    "browser.createProject": defineRpcMethod(
      Type.Object({ name: Type.String({ minLength: 1, maxLength: 64 }) }),
      async (params) => {
        const projectId = await registry.create(params.name);
        return { projectId };
      },
    ),
    "browser.removeProject": defineRpcMethod(
      Type.Object({ projectId: Type.String() }),
      async (params) => {
        await registry.remove(params.projectId);
        return { ok: true };
      },
    ),
  };
}
