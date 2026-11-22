import type { ModelSettingsRequest } from "@spherse/contracts";
import type { ModelCatalog } from "@spherse/core";
import type { RpcModelSettings } from "@spherse/rpc";
import type { ModelSettingsStore } from "../model-settings.js";
import { applyModelSettingsToEnv } from "../model-settings.js";
import type { ProjectRegistry } from "../registry.js";

export function createRpcModelSettings(
  store: ModelSettingsStore,
  catalog: ModelCatalog,
  registry: ProjectRegistry,
): RpcModelSettings {
  return {
    sanitize: () => store.sanitize(),
    apply: (req: unknown) => {
      const next = store.applyUpdate(req as ModelSettingsRequest);
      applyModelSettingsToEnv(next, catalog);
      if (next.text.defaultModel) {
        registry.setDefaultModel(next.text.defaultModel);
      }
      registry.setSampling(next.text.sampling);
      registry.setThinkingLevel(next.text.thinkingLevel);
      return store.sanitize();
    },
  };
}
