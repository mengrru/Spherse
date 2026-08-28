import { ipcMain } from "electron";
import { getMaskedSettings, saveSettings } from "../settings.js";
import { getImageSupportedProviders } from "@spherse/core";
import { getAppModelCatalog } from "../model-catalog.js";
import { updateDefaultModel, updateSampling, updateThinkingLevel } from "../server.js";
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
    updateThinkingLevel(settings.models?.text?.thinkingLevel);
    return { success: true };
  });

  ipcMain.handle("get-supported-providers", () => {
    return getAppModelCatalog().getSupportedProviders();
  });

  ipcMain.handle("get-image-providers", () => {
    return getImageSupportedProviders();
  });
}
