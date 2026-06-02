import path from "node:path";
import Store from "electron-store";
import type { AppSettings } from "@spherse/core";
import { SUPPORTED_PROVIDERS, type SupportedProviderId } from "@spherse/core";

export interface OpenProjectEntry {
  path: string;
  name: string;
  lastOpened: string;
  lastRoute?: string;
}

type SettingsSchema = {
  settings?: AppSettings;
  openProjects?: OpenProjectEntry[];
  lastActiveProject?: string | null;
};

export const settingsStore = new Store<SettingsSchema>({
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
    if (newConfig && newConfig.apiKey.trim() === "") {
      continue;
    } else if (newConfig?.apiKey && !newConfig.apiKey.includes("****")) {
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

export function getOpenProjects(): OpenProjectEntry[] {
  return settingsStore.get("openProjects") ?? [];
}

export function addOpenProject(projectPath: string): void {
  const projects = getOpenProjects();
  const idx = projects.findIndex((p) => p.path === projectPath);
  const existing = idx >= 0 ? projects[idx] : undefined;
  const entry: OpenProjectEntry = {
    path: projectPath,
    name: path.basename(projectPath),
    lastOpened: new Date().toISOString(),
    lastRoute: existing?.lastRoute,
  };
  if (idx >= 0) {
    projects[idx] = entry;
  } else {
    projects.push(entry);
  }
  settingsStore.set("openProjects", projects);
}

export function removeOpenProject(projectPath: string): void {
  const projects = getOpenProjects().filter((p) => p.path !== projectPath);
  settingsStore.set("openProjects", projects);
  const lastActive = getLastActiveProject();
  if (lastActive === projectPath) {
    setLastActiveProject(null);
  }
}

export function updateLastOpened(projectPath: string): void {
  const projects = getOpenProjects();
  const entry = projects.find((p) => p.path === projectPath);
  if (entry) {
    entry.lastOpened = new Date().toISOString();
    settingsStore.set("openProjects", projects);
  }
}

export function updateProjectLastRoute(projectPath: string, route: string): void {
  const projects = getOpenProjects();
  const entry = projects.find((p) => p.path === projectPath);
  if (entry) {
    entry.lastRoute = route;
    settingsStore.set("openProjects", projects);
  }
}

export function getLastActiveProject(): string | null {
  return settingsStore.get("lastActiveProject") ?? null;
}

export function setLastActiveProject(projectPath: string | null): void {
  settingsStore.set("lastActiveProject", projectPath);
}
