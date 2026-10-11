import { existsSync } from "node:fs";
import { ModelSettingsStore } from "@spherse/server";
import type { CustomProviderDef, ModelGroupSettings } from "@spherse/core";
import type { ModelSettingsRequest } from "@spherse/contracts";
import type { ThemeMode } from "@spherse/app/host-bridge";
import { settingsStore, getModelSettingsPath, getHostPrefs, applyThemeSource, defaultCloseToTray } from "./settings.js";

interface LegacySettings {
  locale?: string;
  models?: { text?: ModelGroupSettings; image?: ModelGroupSettings };
  customProviders?: CustomProviderDef[];
  debugToolsEnabled?: boolean;
  tabsEnabled?: boolean;
  closeToTray?: boolean;
  theme?: string;
  mobileAccess?: { enabled?: boolean; token?: string; mode?: "quick" | "manual"; publicDomain?: string };
}

function normalizeTheme(raw: string | undefined): ThemeMode {
  return raw === "light" || raw === "dark" ? raw : "system";
}

function seedModelSettings(legacy: LegacySettings): void {
  const filePath = getModelSettingsPath();
  if (existsSync(filePath)) return;
  const request: ModelSettingsRequest = {
    models: {
      text: {
        defaultModel: legacy.models?.text?.defaultModel ?? "",
        providers: legacy.models?.text?.providers ?? {},
        sampling: legacy.models?.text?.sampling,
        thinkingLevel: legacy.models?.text?.thinkingLevel,
      },
      image: {
        defaultModel: legacy.models?.image?.defaultModel ?? "",
        providers: legacy.models?.image?.providers ?? {},
      },
    },
    customProviders: legacy.customProviders ?? [],
  };
  new ModelSettingsStore({ filePath }).applyUpdate(request);
}

export function migrateLegacySettings(): void {
  const legacy = settingsStore.get("settings") as LegacySettings | undefined;
  if (legacy) {
    if (!settingsStore.get("serverToken") && legacy.mobileAccess?.token) {
      settingsStore.set("serverToken", legacy.mobileAccess.token);
    }
    seedModelSettings(legacy);
    if (!settingsStore.get("hostPrefs")) {
      settingsStore.set("hostPrefs", {
        locale: legacy.locale ?? "zh-CN",
        theme: normalizeTheme(legacy.theme),
        tabsEnabled: legacy.tabsEnabled ?? true,
        debugToolsEnabled: legacy.debugToolsEnabled ?? false,
        closeToTray: legacy.closeToTray ?? defaultCloseToTray(),
      });
    }
    if (!settingsStore.get("mobileAccess") && legacy.mobileAccess) {
      settingsStore.set("mobileAccess", {
        enabled: legacy.mobileAccess.enabled ?? false,
        mode: legacy.mobileAccess.mode ?? "quick",
        publicDomain: legacy.mobileAccess.publicDomain,
      });
    }
    settingsStore.delete("settings");
  }
  applyThemeSource(getHostPrefs().theme);
}
