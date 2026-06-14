import { ipcMain, dialog, shell } from "electron";
import type { BrowserWindow } from "electron";
import { registerProject, unregisterProject, getServerPort } from "../server.js";
import {
  getOpenProjects,
  addOpenProject,
  removeOpenProjectById,
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

  ipcMain.handle("open-project", async (_event, projectRoot: string) => {
    return registerProject(projectRoot);
  });

  ipcMain.handle("get-server-port", () => {
    return getServerPort();
  });

  ipcMain.handle("add-open-project", async (_event, projectId: string, projectPath: string) => {
    addOpenProject(projectId, projectPath);
  });

  ipcMain.handle("restore-projects", async () => {
    const entries = getOpenProjects();
    const results: Array<{ id: string; path: string; name: string; lastRoute?: string }> = [];
    for (const entry of entries) {
      try {
        const { projectId } = await registerProject(entry.path);
        results.push({ id: projectId, path: entry.path, name: entry.name, lastRoute: entry.lastRoute });
      } catch {
        // directory deleted or corrupt, skip silently
      }
    }
    return results;
  });

  ipcMain.handle("close-project", async (_event, projectId: string) => {
    await unregisterProject(projectId);
    removeOpenProjectById(projectId);
  });

  ipcMain.handle("reveal-in-finder", async (_event, projectPath: string) => {
    shell.showItemInFolder(projectPath);
  });

  ipcMain.handle("set-last-active-project", (_event, projectId: string) => {
    setLastActiveProject(projectId);
  });

  ipcMain.handle("get-last-active-project", () => {
    return getLastActiveProject();
  });

  ipcMain.handle("set-project-last-route", (_event, projectId: string, route: string) => {
    updateProjectLastRoute(projectId, route);
  });

  ipcMain.handle("show-save-dialog", async (_event, options: { defaultPath?: string }) => {
    const win = getWindow();
    if (!win) return null;
    const result = await dialog.showSaveDialog(win, {
      defaultPath: options.defaultPath,
      filters: [{ name: "HTML", extensions: ["html", "htm"] }],
    });
    return result.canceled ? null : result.filePath;
  });
}
