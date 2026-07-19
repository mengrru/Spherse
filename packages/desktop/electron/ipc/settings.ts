import { ipcMain } from "electron";
import { getMaskedSettings, saveSettings } from "../settings.js";
import { getSupportedProviders, getImageSupportedProviders } from "@spherse/core";
import { updateDefaultModel, updateSampling } from "../server.js";
import type { AppSettings } from "@spherse/core";

export function registerSettingsIpc(): void {
  ipcMain.handle("get-settings", () => {
    return getMaskedSettings();
  });

  ipcMain.handle("save-settings", (_event, settings: AppSettings) => {
    saveSettings(settings);
    const defaultModel = settings.models?.text?.defaultModel;
    if (defaultModel) {
      updateDefaultModel(defaultModel);
    }
    updateSampling(settings.models?.text?.sampling);
    return { success: true };
  });

  ipcMain.handle("get-supported-providers", () => {
    return getSupportedProviders();
  });

  ipcMain.handle("get-image-providers", () => {
    return getImageSupportedProviders();
  });
}
