import path from "node:path";
import crypto from "node:crypto";
import { nativeTheme } from "electron";
import Store from "electron-store";
import type { AppSettings, ModelGroupSettings, ProviderCredentials, MobileAccessSettings } from "@spherse/core";
import { getSupportedProviders, syncCustomProviders } from "@spherse/core";

export interface OpenProjectEntry {
  id: string;
  path: string;
  name: string;
  lastOpened: string;
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

function extractProviderKeys(providers: Record<string, { apiKey?: string }> | undefined): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const [id, c] of Object.entries(providers ?? {})) {
    if (c?.apiKey) keys[id] = c.apiKey;
  }
  return keys;
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

export function maskModelGroup(group: ModelGroupSettings | undefined): ModelGroupSettings {
  const providers: Record<string, ProviderCredentials> = {};
  for (const [id, creds] of Object.entries(group?.providers ?? {})) {
    if (creds?.apiKey) {
      providers[id] = { apiKey: maskApiKey(creds.apiKey) };
    }
  }
  return { defaultModel: group?.defaultModel ?? "", providers, sampling: group?.sampling };
}

export function getMaskedSettings(): AppSettings | null {
  const settings = settingsStore.get("settings");
  if (!settings) return null;
  return {
    locale: settings.locale ?? "zh-CN",
    models: {
      text: maskModelGroup(settings.models?.text),
      image: maskModelGroup(settings.models?.image),
    },
    customProviders: settings.customProviders ?? [],
    debugToolsEnabled: settings.debugToolsEnabled ?? false,
    theme: settings.theme ?? "system",
  };
}

export function mergeModelGroup(
  incoming: ModelGroupSettings | undefined,
  prev: ModelGroupSettings | undefined,
): ModelGroupSettings {
  const defaultModel = incoming?.defaultModel ?? prev?.defaultModel ?? "";
  const providers: Record<string, ProviderCredentials> = {};
  const allIds = new Set([
    ...Object.keys(incoming?.providers ?? {}),
    ...Object.keys(prev?.providers ?? {}),
  ]);
  for (const id of allIds) {
    const newKey = incoming?.providers?.[id]?.apiKey;
    const prevKey = prev?.providers?.[id]?.apiKey;
    if (!newKey || newKey.trim() === "") continue;
    if (newKey.includes("****")) {
      if (prevKey) providers[id] = { apiKey: prevKey };
    } else {
      providers[id] = { apiKey: newKey };
    }
  }
  return { defaultModel, providers, sampling: incoming?.sampling };
}

export function saveSettings(incoming: AppSettings): void {
  const prev = settingsStore.get("settings");
  const merged: AppSettings = {
    locale: incoming.locale ?? prev?.locale ?? "zh-CN",
    models: {
      text: mergeModelGroup(incoming.models?.text, prev?.models?.text),
      image: mergeModelGroup(incoming.models?.image, prev?.models?.image),
    },
    customProviders: incoming.customProviders ?? prev?.customProviders ?? [],
    debugToolsEnabled: incoming.debugToolsEnabled ?? prev?.debugToolsEnabled ?? false,
    theme: incoming.theme ?? prev?.theme ?? "system",
  };
  settingsStore.set("settings", merged);
  applySettingsToEnv(merged);
}

export function restoreEnvFromSettings(): void {
  const settings = settingsStore.get("settings");
  if (!settings) return;
  applySettingsToEnv(settings);
}

export function applyThemeSource(theme: AppSettings["theme"]): void {
  nativeTheme.themeSource = theme ?? "system";
}

function applySettingsToEnv(settings: AppSettings): void {
  applyThemeSource(settings.theme);
  const textCatalog = getSupportedProviders();
  for (const [id, creds] of Object.entries(settings.models?.text?.providers ?? {})) {
    if (creds?.apiKey) {
      const item = textCatalog[id];
      if (item?.auth.envKeys[0]) {
        process.env[item.auth.envKeys[0]] = creds.apiKey;
      }
    }
  }

  const imageGroup = settings.models?.image;
  if (imageGroup?.defaultModel) {
    process.env.SPHERSE_IMAGE_MODEL = imageGroup.defaultModel;
    const slashIdx = imageGroup.defaultModel.indexOf("/");
    const provider = slashIdx > 0 ? imageGroup.defaultModel.slice(0, slashIdx) : "";
    process.env.SPHERSE_IMAGE_API_KEY = imageGroup.providers[provider]?.apiKey ?? "";
  } else {
    delete process.env.SPHERSE_IMAGE_MODEL;
    delete process.env.SPHERSE_IMAGE_API_KEY;
  }

  syncCustomProviders(settings.customProviders ?? [], extractProviderKeys(settings.models?.text?.providers));
}

export function getOpenProjects(): OpenProjectEntry[] {
  return settingsStore.get("openProjects") ?? [];
}

export function addOpenProject(projectId: string, projectPath: string): void {
  const projects = getOpenProjects();
  const idx = projects.findIndex((p) => p.path === projectPath);
  const entry: OpenProjectEntry = {
    id: projectId,
    path: projectPath,
    name: path.basename(projectPath),
    lastOpened: new Date().toISOString(),
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

export function removeOpenProjectById(projectId: string): void {
  const projects = getOpenProjects().filter((p) => p.id !== projectId);
  settingsStore.set("openProjects", projects);
  const lastActive = getLastActiveProject();
  if (lastActive === projectId) {
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

export function getLastActiveProject(): string | null {
  return settingsStore.get("lastActiveProject") ?? null;
}

export function setLastActiveProject(projectPath: string | null): void {
  settingsStore.set("lastActiveProject", projectPath);
}

export function getLocale(): string {
  return settingsStore.get("settings")?.locale ?? "zh-CN";
}

export function setLocale(locale: string): void {
  const settings = settingsStore.get("settings");
  if (settings) {
    settings.locale = locale;
    settingsStore.set("settings", settings);
  }
}

export function generateAccessToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function getMobileAccess(): MobileAccessSettings {
  const settings = settingsStore.get("settings");
  return {
    enabled: settings?.mobileAccess?.enabled ?? false,
    token: settings?.mobileAccess?.token,
  };
}

export function setMobileAccess(patch: Partial<MobileAccessSettings>): MobileAccessSettings {
  const settings = settingsStore.get("settings") ?? ({} as AppSettings);
  const current: MobileAccessSettings = {
    enabled: settings.mobileAccess?.enabled ?? false,
    token: settings.mobileAccess?.token,
  };
  const next: MobileAccessSettings = { ...current, ...patch };
  settings.mobileAccess = next;
  settingsStore.set("settings", settings);
  return next;
}
