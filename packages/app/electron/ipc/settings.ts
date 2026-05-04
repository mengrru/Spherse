import { ipcMain } from "electron";
import { getMaskedSettings, saveSettings } from "../settings.js";
import { SUPPORTED_PROVIDERS } from "@worldbuilding-agent/core";
import type { AppSettings } from "@worldbuilding-agent/core";

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
