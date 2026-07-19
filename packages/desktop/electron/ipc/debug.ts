import { app, ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import { settingsStore } from "../settings.js";

export function registerDebugIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("is-dev", () => {
    return !app.isPackaged;
  });

  ipcMain.handle("toggle-dev-tools", () => {
    const win = getWindow();
    if (!win) return;
    if (win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools();
    } else {
      win.webContents.openDevTools();
    }
  });

  ipcMain.handle("is-dev-tools-open", () => {
    const win = getWindow();
    return win?.webContents.isDevToolsOpened() ?? false;
  });

  ipcMain.handle("get-electron-store-data", () => {
    return settingsStore.store;
  });

  ipcMain.handle("reload-renderer", () => {
    const win = getWindow();
    win?.webContents.reload();
  });

  ipcMain.handle("reset-app-data", () => {
    settingsStore.clear();
    app.relaunch();
    app.exit(0);
  });
}
