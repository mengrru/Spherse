import { ipcMain } from "electron";
import type { DesktopPrefs, GeneralPrefs } from "@spherse/app/host-bridge";
import { getGeneralPrefs, saveGeneralPrefs, getDesktopPrefs, saveDesktopPrefs } from "../settings.js";
import { syncTray } from "../tray.js";

export function registerHostPrefsIpc(): void {
  ipcMain.handle("get-general-prefs", () => {
    return getGeneralPrefs();
  });

  ipcMain.handle("save-general-prefs", (_event, prefs: GeneralPrefs) => {
    saveGeneralPrefs(prefs);
    syncTray();
    return { success: true };
  });

  ipcMain.handle("get-desktop-prefs", () => {
    return getDesktopPrefs();
  });

  ipcMain.handle("save-desktop-prefs", (_event, prefs: DesktopPrefs) => {
    saveDesktopPrefs(prefs);
    syncTray();
    return { success: true };
  });
}
