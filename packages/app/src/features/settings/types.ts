import type { ProviderCatalogItem } from "@spherse/core";
import type { ModelSettingsRequest, ModelSettingsResponse } from "@spherse/contracts";

export type ProviderConfig = ProviderCatalogItem;

export interface ModelSettingsApi {
  getModelSettings(): Promise<ModelSettingsResponse>;
  updateModelSettings(req: ModelSettingsRequest): Promise<ModelSettingsResponse>;
  getSupportedProviders(): Promise<Record<string, ProviderConfig>>;
  getImageProviders(): Promise<Record<string, ProviderConfig>>;
}
