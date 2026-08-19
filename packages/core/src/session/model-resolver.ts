import type { Model, Api } from "@earendil-works/pi-ai";
import type { AgentProfile } from "../types.js";
import { ModelNotConfiguredError } from "../errors.js";
import { resolveEffectiveModelId } from "./status.js";
import type { ModelCatalog } from "../model-providers/catalog.js";

export interface ModelResolver {
  resolveFor(profile: AgentProfile, defaultModel?: string): Model<Api> | undefined;
  resolveOrThrow(profile: AgentProfile, defaultModel?: string): Model<Api>;
}

export function createModelResolver(catalog: Pick<ModelCatalog, "resolveModelById">): ModelResolver {
  const resolveModelById = catalog.resolveModelById.bind(catalog);

  const tryResolve = (profile: AgentProfile, defaultModel?: string): Model<Api> | undefined => {
    const modelId = resolveEffectiveModelId(profile, defaultModel);
    if (!modelId) return undefined;
    try {
      return resolveModelById(modelId) as Model<Api>;
    } catch {
      return undefined;
    }
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
