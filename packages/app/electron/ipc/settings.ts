import { ipcMain } from "electron";
import { getMaskedSettings, saveSettings } from "../settings.js";
import { SUPPORTED_PROVIDERS } from "@spherse/core";
import type { AppSettings } from "@spherse/core";

export function registerSettingsIpc(): void {
  ipcMain.handle("get-settings", () => {
    return getMaskedSettings();
  });

  ipcMain.handle("save-settings", (_event, settings: AppSettings) => {
    saveSettings(settings);
    return { success: true };
  });

  ipcMain.handle("get-supported-providers", () => {
    return SUPPORTED_PROVIDERS;
  });
}
