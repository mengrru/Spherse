import { ipcMain, app, shell } from "electron";
import type { BrowserWindow } from "electron";
import { updater } from "../updater.js";

export function registerUpdaterIpc(
  _getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("check-for-updates", (_event, opts: { silent: boolean }) => {
    return updater.checkForUpdates(opts);
  });
  ipcMain.handle("download-update", () => updater.downloadUpdate());
  ipcMain.handle("install-update", () => updater.installUpdate());
  ipcMain.handle("cancel-update", () => updater.cancelUpdate());
  ipcMain.handle("get-update-state", () => updater.getState());
  ipcMain.handle("get-app-version", () => app.getVersion());
  ipcMain.handle("open-external", (_event, url: string) =>
    shell.openExternal(url),
  );
}
