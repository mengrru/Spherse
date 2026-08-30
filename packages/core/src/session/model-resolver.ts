import type { Model, Api } from "@earendil-works/pi-ai";
import type { AgentProfile } from "../types.js";
import { ModelNotConfiguredError } from "../errors.js";
import type { ModelCatalog } from "../model-providers/catalog.js";

export interface ModelResolver {
  resolveFor(profile: AgentProfile, defaultModel?: string): Model<Api> | undefined;
  resolveOrThrow(profile: AgentProfile, defaultModel?: string): Model<Api>;
}

export function createModelResolver(catalog: Pick<ModelCatalog, "resolveModelById">): ModelResolver {
  const resolveModelById = catalog.resolveModelById.bind(catalog);

  const tryResolve = (profile: AgentProfile, defaultModel?: string): Model<Api> | undefined => {
    const candidates = profile.model
      ? profile.model === defaultModel
        ? [profile.model]
        : [profile.model, defaultModel]
      : [defaultModel];
    for (const modelId of candidates) {
      if (!modelId) continue;
      try {
        return resolveModelById(modelId) as Model<Api>;
      } catch {
        continue;
      }
    }
    return undefined;
  };

  return {
    resolveFor: tryResolve,
    resolveOrThrow(profile, defaultModel) {
      const model = tryResolve(profile, defaultModel);
      if (!model) throw new ModelNotConfiguredError();
      return model;
    },
  };
}
