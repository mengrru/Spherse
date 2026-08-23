import type { ImagesModels } from "@earendil-works/pi-ai";
import type { ProviderCatalog } from "../types.js";
import { ModelCatalog } from "./catalog.js";

export { CUSTOM_PROVIDER_DEFAULTS, ENABLED_PROVIDERS, ModelCatalog } from "./catalog.js";

const defaultCatalog = new ModelCatalog();

export function getImageSupportedProviders(): ProviderCatalog {
  return defaultCatalog.getImageSupportedProviders();
}

export function getImagesModels(): ImagesModels {
  return defaultCatalog.getImagesModels();
}
