import Store from "electron-store";
import type { AppSettings } from "@worldbuilding-agent/core";
import { SUPPORTED_PROVIDERS, type SupportedProviderId } from "@worldbuilding-agent/core";

export const settingsStore = new Store<{ settings?: AppSettings }>({
  name: "settings",
});

export function getSettings(): AppSettings | undefined {
  return settingsStore.get("settings");
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

export function getMaskedSettings(): AppSettings | null {
  const settings = settingsStore.get("settings");
  if (!settings) return null;
  const masked: AppSettings = { providers: {}, defaultModel: settings.defaultModel };
  for (const [id, config] of Object.entries(settings.providers)) {
    if (config?.apiKey) {
      (masked.providers as any)[id] = { apiKey: maskApiKey(config.apiKey) };
    }
  }
  return masked;
}

export function saveSettings(incoming: AppSettings): void {
  const prev = settingsStore.get("settings");
  const merged: AppSettings = { providers: {}, defaultModel: incoming.defaultModel };
  for (const id of Object.keys(SUPPORTED_PROVIDERS) as SupportedProviderId[]) {
    const newConfig = incoming.providers[id];
    const prevConfig = prev?.providers?.[id as keyof typeof prev.providers];
    if (newConfig?.apiKey && !newConfig.apiKey.includes("****")) {
      (merged.providers as any)[id] = { apiKey: newConfig.apiKey };
    } else if (prevConfig?.apiKey) {
      (merged.providers as any)[id] = { apiKey: prevConfig.apiKey };
    }
  }
  settingsStore.set("settings", merged);
  applySettingsToEnv(merged);
}

export function restoreEnvFromSettings(): void {
  const settings = settingsStore.get("settings");
  if (!settings) return;
  applySettingsToEnv(settings);
}

function applySettingsToEnv(settings: AppSettings): void {
  for (const [id, config] of Object.entries(settings.providers)) {
    if (config?.apiKey) {
      const provider = SUPPORTED_PROVIDERS[id as SupportedProviderId];
      if (provider) {
        process.env[provider.envKey] = config.apiKey;
      }
    }
  }
}
