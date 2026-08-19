import type { Model, Api } from "@earendil-works/pi-ai";
import type { AgentProfile } from "../types.js";
import { ModelNotConfiguredError } from "../errors.js";
import { resolveEffectiveModelId } from "./status.js";
import { resolveModelById } from "../model-providers/index.js";

export interface ModelResolver {
  resolveFor(profile: AgentProfile, defaultModel?: string): Model<Api> | undefined;
  resolveOrThrow(profile: AgentProfile, defaultModel?: string): Model<Api>;
}

function resolveOf(resolveById: (modelId: string) => unknown): ModelResolver {
  const tryResolve = (profile: AgentProfile, defaultModel?: string): Model<Api> | undefined => {
    const modelId = resolveEffectiveModelId(profile, defaultModel);
    if (!modelId) return undefined;
    try {
      return resolveById(modelId) as Model<Api>;
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

export function createDefaultModelResolver(): ModelResolver {
  return resolveOf(resolveModelById);
}
