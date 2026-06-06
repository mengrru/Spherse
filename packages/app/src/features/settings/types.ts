import type { ProviderCatalogItem } from "@spherse/core";

export type ProviderConfig = ProviderCatalogItem;

export interface AppSettings {
  providers?: Record<string, { apiKey?: string } | undefined>;
  defaultModel?: string;
  locale?: string;
}

export interface SettingsApi {
  getSettings: () => Promise<AppSettings | null>;
  saveSettings: (settings: AppSettings) => Promise<{ success: boolean }>;
  getSupportedProviders: () => Promise<Record<string, ProviderConfig>>;
}
