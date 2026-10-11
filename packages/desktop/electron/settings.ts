import path from "node:path";
import crypto from "node:crypto";
import { app, nativeTheme } from "electron";
import Store from "electron-store";
import type { DesktopPrefs, GeneralPrefs, ThemeMode } from "@spherse/app/host-bridge";

export interface OpenProjectEntry {
  id: string;
  path: string;
  name: string;
  lastOpened: string;
}

export type MobileTunnelMode = "quick" | "manual";

export interface MobileAccessSettings {
  enabled: boolean;
  token?: string;
  mode?: MobileTunnelMode;
  publicDomain?: string;
}

export interface HostPrefsData extends GeneralPrefs, DesktopPrefs {}

type SettingsSchema = {
  settings?: unknown;
  hostPrefs?: HostPrefsData;
  mobileAccess?: MobileAccessSettings;
  openProjects?: OpenProjectEntry[];
  lastActiveProject?: string | null;
  serverToken?: string;
};

export const settingsStore = new Store<SettingsSchema>({
  name: "settings",
});

export function getModelSettingsPath(): string {
  return path.join(app.getPath("userData"), "model-settings.json");
}

function defaultHostPrefs(): HostPrefsData {
  return {
    locale: "zh-CN",
    theme: "system",
    tabsEnabled: true,
    debugToolsEnabled: false,
    closeToTray: defaultCloseToTray(),
  };
}

export function getHostPrefs(): HostPrefsData {
  return { ...defaultHostPrefs(), ...settingsStore.get("hostPrefs") };
}

export function getGeneralPrefs(): GeneralPrefs {
  return { locale: getHostPrefs().locale };
}

export function saveGeneralPrefs(prefs: GeneralPrefs): void {
  const current = getHostPrefs();
  settingsStore.set("hostPrefs", { ...current, locale: prefs.locale });
}

export function getDesktopPrefs(): DesktopPrefs {
  const prefs = getHostPrefs();
  return {
    theme: prefs.theme,
    tabsEnabled: prefs.tabsEnabled,
    debugToolsEnabled: prefs.debugToolsEnabled,
    closeToTray: prefs.closeToTray,
  };
}

export function saveDesktopPrefs(prefs: DesktopPrefs): void {
  const current = getHostPrefs();
  settingsStore.set("hostPrefs", { ...current, ...prefs });
  applyThemeSource(prefs.theme);
}

export function applyThemeSource(theme: ThemeMode): void {
  nativeTheme.themeSource = theme ?? "system";
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

export function bumpLastOpenedById(projectId: string): string | null {
  const projects = getOpenProjects();
  const entry = projects.find((p) => p.id === projectId);
  if (!entry) return null;
  const ts = new Date().toISOString();
  entry.lastOpened = ts;
  settingsStore.set("openProjects", projects);
  return ts;
}

export function getLastActiveProject(): string | null {
  return settingsStore.get("lastActiveProject") ?? null;
}

export function setLastActiveProject(projectPath: string | null): void {
  settingsStore.set("lastActiveProject", projectPath);
}

export function defaultCloseToTray(): boolean {
  return app.isPackaged || process.env.NODE_ENV === "test";
}

export function getCloseToTray(): boolean {
  return getHostPrefs().closeToTray;
}

export function getLocale(): string {
  return getHostPrefs().locale;
}

export function generateAccessToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function getServerToken(): string {
  const existing = settingsStore.get("serverToken");
  if (existing) return existing;
  const legacy = settingsStore.get("mobileAccess")?.token;
  if (legacy) {
    settingsStore.set("serverToken", legacy);
    return legacy;
  }
  const token = generateAccessToken();
  settingsStore.set("serverToken", token);
  return token;
}

export function setServerToken(token: string): void {
  settingsStore.set("serverToken", token);
}

export function getMobileAccess(): MobileAccessSettings {
  const stored = settingsStore.get("mobileAccess");
  return {
    enabled: stored?.enabled ?? false,
    token: stored?.token,
    mode: stored?.mode ?? "quick",
    publicDomain: stored?.publicDomain,
  };
}

export function setMobileAccess(patch: Partial<MobileAccessSettings>): MobileAccessSettings {
  const current = getMobileAccess();
  const next: MobileAccessSettings = { ...current, ...patch };
  settingsStore.set("mobileAccess", next);
  return next;
}
