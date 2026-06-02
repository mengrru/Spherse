import { ipcMain } from "electron";
import { getMaskedSettings, saveSettings } from "../settings.js";
import { getSupportedProviders } from "@spherse/core";
import { updateDefaultModel } from "../server.js";
import type { AppSettings } from "@spherse/core";

export function registerSettingsIpc(): void {
  ipcMain.handle("get-settings", () => {
    return getMaskedSettings();
  });

  ipcMain.handle("save-settings", (_event, settings: AppSettings) => {
    saveSettings(settings);
    updateDefaultModel(settings.defaultModel || undefined);
    return { success: true };
  });

  ipcMain.handle("get-supported-providers", () => {
    return getSupportedProviders();
  });
}
