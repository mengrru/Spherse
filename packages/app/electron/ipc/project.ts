import { ipcMain, dialog } from "electron";
import type { BrowserWindow } from "electron";
import { startServer } from "../server.js";

export function registerProjectIpc(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("select-directory", async () => {
    const win = getWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("start-server", async (_event, projectRoot: string) => {
    return startServer(projectRoot);
  });
}
