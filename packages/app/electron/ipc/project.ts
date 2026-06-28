import { ipcMain, dialog, shell } from "electron";
import type { BrowserWindow } from "electron";
import path from "node:path";
import { existsSync, readdirSync, mkdirSync, cpSync } from "node:fs";
import { translate, normalizeLocale } from "@spherse/i18n";
import { registerProject, unregisterProject, getServerPort } from "../server.js";
import {
  getOpenProjects,
  addOpenProject,
  removeOpenProject,
  setLastActiveProject,
  getLastActiveProject,
  getLocale,
} from "../settings.js";
import { readSampleManifest, resolveSampleSrcDir } from "../sample-projects.js";

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
    const results: Array<{ id: string; path: string; name: string; lastOpened: string }> = [];
    for (const entry of entries) {
      try {
        const { projectId } = await registerProject(entry.path);
        results.push({ id: projectId, path: entry.path, name: entry.name, lastOpened: entry.lastOpened });
      } catch {
        // directory deleted or corrupt, skip silently
      }
    }
    return results;
  });

  ipcMain.handle("close-project", async (_event, projectId: string, projectPath: string) => {
    await unregisterProject(projectId);
    removeOpenProject(projectPath);
    if (getLastActiveProject() === projectId) {
      setLastActiveProject(null);
    }
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

  ipcMain.handle("show-save-dialog", async (_event, options: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => {
    const win = getWindow();
    if (!win) return null;
    const result = await dialog.showSaveDialog(win, {
      defaultPath: options.defaultPath,
      ...(options.filters ? { filters: options.filters } : {}),
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle("create-new-project", async () => {
    try {
      const win = getWindow();
      if (!win) return null;
      const title = translate(normalizeLocale(getLocale()), "onboarding.dialog.newProjectLocation");
      const defaultPath = translate(normalizeLocale(getLocale()), "onboarding.defaultProjectName");
      const result = await dialog.showSaveDialog(win, { title, defaultPath });
      if (result.canceled || !result.filePath) return null;
      const targetPath = result.filePath;
      if (existsSync(targetPath) && readdirSync(targetPath).length > 0) {
        return { error: "dirExistsNotEmpty" };
      }
      mkdirSync(targetPath, { recursive: true });
      const { projectId } = await registerProject(targetPath);
      addOpenProject(projectId, targetPath);
      setLastActiveProject(projectId);
      return { projectId, path: targetPath };
    } catch (err) {
      console.error("[create-new-project]", err);
      return { error: "createFailed" };
    }
  });

  ipcMain.handle("open-sample-project", async (_event, opts: { sampleId: string }) => {
    try {
      const manifest = await readSampleManifest();
      const entry = manifest.find((e) => e.id === opts.sampleId);
      if (!entry) return { error: "sampleNotFound" };
      const srcDir = resolveSampleSrcDir(entry);
      if (!existsSync(srcDir)) return { error: "sampleNotFound" };
      const win = getWindow();
      if (!win) return null;
      const title = translate(normalizeLocale(getLocale()), "onboarding.dialog.sampleLocation");
      const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"], title });
      if (result.canceled || result.filePaths.length === 0) return null;
      const parentDir = result.filePaths[0];
      let targetDir = path.join(parentDir, entry.displayName);
      let counter = 2;
      while (existsSync(targetDir)) {
        targetDir = path.join(parentDir, `${entry.displayName}-${counter}`);
        counter++;
      }
      mkdirSync(targetDir, { recursive: true });
      cpSync(srcDir, targetDir, { recursive: true });
      const { projectId } = await registerProject(targetDir);
      addOpenProject(projectId, targetDir);
      setLastActiveProject(projectId);
      return { projectId, path: targetDir };
    } catch (err) {
      console.error("[open-sample-project]", err);
      return { error: "copyFailed" };
    }
  });

  ipcMain.handle("get-sample-manifest", async () => {
    return readSampleManifest();
  });
}
