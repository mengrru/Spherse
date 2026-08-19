import type { Models, ImagesModels } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { CustomProviderDef, ProviderCatalog, SamplingParams } from "../types.js";
import { ModelCatalog } from "./catalog.js";

export { ENABLED_PROVIDERS, ModelCatalog } from "./catalog.js";

const defaultCatalog = new ModelCatalog();

export function syncCustomProviders(defs: CustomProviderDef[], apiKeys: Record<string, string>): void {
  defaultCatalog.syncCustomProviders(defs, apiKeys);
}

export function getSupportedProviders(): ProviderCatalog {
  return defaultCatalog.getSupportedProviders();
}

export function getImageSupportedProviders(): ProviderCatalog {
  return defaultCatalog.getImageSupportedProviders();
}

export function resolveModelById(modelId: string) {
  return defaultCatalog.resolveModelById(modelId);
}

export function getChatStreamFn(sampling?: SamplingParams): StreamFn {
  return defaultCatalog.getChatStreamFn(sampling);
}

export function getImagesModels(): ImagesModels {
  return defaultCatalog.getImagesModels();
}

export function getChatModels(): Models {
  return defaultCatalog.getChatModels();
}
