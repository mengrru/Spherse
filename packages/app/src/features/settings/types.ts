import type { ProviderCatalogItem } from "@spherse/core";
import type { HostSettings } from "../../lib/host-bridge";

export type ProviderConfig = ProviderCatalogItem;
export type AppSettings = HostSettings;

export interface SettingsApi {
  getSettings: () => Promise<AppSettings | null>;
  saveSettings: (settings: AppSettings) => Promise<{ success: boolean }>;
  getSupportedProviders: () => Promise<Record<string, ProviderConfig>>;
  getImageProviders: () => Promise<Record<string, ProviderConfig>>;
}
