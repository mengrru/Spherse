import type { ProviderCatalogItem } from "@spherse/core";
import type { IpcAppSettings } from "@shared/electron-api";

export type ProviderConfig = ProviderCatalogItem;
export type AppSettings = IpcAppSettings;

export interface SettingsApi {
  getSettings: () => Promise<AppSettings | null>;
  saveSettings: (settings: AppSettings) => Promise<{ success: boolean }>;
  getSupportedProviders: () => Promise<Record<string, ProviderConfig>>;
}
