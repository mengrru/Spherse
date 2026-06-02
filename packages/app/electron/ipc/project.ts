import { ipcMain, dialog, shell } from "electron";
import type { BrowserWindow } from "electron";
import { startServer, stopServer, getServerPort } from "../server.js";
import {
  getOpenProjects,
  addOpenProject,
  removeOpenProject,
  setLastActiveProject,
  getLastActiveProject,
  updateProjectLastRoute,
} from "../settings.js";

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

  ipcMain.handle("add-open-project", async (_event, projectPath: string) => {
    addOpenProject(projectPath);
  });

  ipcMain.handle("restore-projects", async () => {
    const entries = getOpenProjects();
    const results: Array<{ path: string; name: string; port: number; lastRoute?: string }> = [];
    for (const entry of entries) {
      if (!getServerPort(entry.path)) {
        try {
          const port = await startServer(entry.path);
          results.push({ path: entry.path, name: entry.name, port, lastRoute: entry.lastRoute });
        } catch {
          // If server fails to start (e.g. directory deleted), skip silently
        }
      } else {
        results.push({
          path: entry.path,
          name: entry.name,
          port: getServerPort(entry.path)!,
          lastRoute: entry.lastRoute,
        });
      }
    }
    return results;
  });

  ipcMain.handle("close-project", async (_event, projectPath: string) => {
    stopServer(projectPath);
    removeOpenProject(projectPath);
  });

  ipcMain.handle("reveal-in-finder", async (_event, projectPath: string) => {
    shell.showItemInFolder(projectPath);
  });

  ipcMain.handle("set-last-active-project", (_event, path: string) => {
    setLastActiveProject(path);
  });

  ipcMain.handle("get-last-active-project", () => {
    return getLastActiveProject();
  });

  ipcMain.handle("set-project-last-route", (_event, projectPath: string, route: string) => {
    updateProjectLastRoute(projectPath, route);
  });
}
