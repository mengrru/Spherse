import { ipcMain, dialog } from "electron";
import type { BrowserWindow } from "electron";

export function registerSkillIpc(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("select-skill-zip", async () => {
    const win = getWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "Zip", extensions: ["zip"] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}
