import { ipcMain, dialog, shell } from "electron";
import type { BrowserWindow } from "electron";
import path from "node:path";
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { isInsideAnyOpenProject } from "./open-file-path.js";
import { translate, normalizeLocale } from "@spherse/i18n";
import { registerProject, unregisterProject, getServerPort, setProjectLastOpened } from "../server.js";
import {
  getOpenProjects,
  addOpenProject,
  removeOpenProject,
  setLastActiveProject,
  getLastActiveProject,
  getLocale,
  bumpLastOpenedById,
} from "../settings.js";
import { readSampleManifest, resolveSampleSrcDir } from "../sample-projects.js";

export function registerProjectIpc(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("select-directory", async () => {
    const win = getWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("open-project", async (_event, projectRoot: string) => {
    return registerProject(projectRoot, { lastOpened: new Date().toISOString() });
  });

  ipcMain.handle("get-server-port", () => {
    return getServerPort();
  });

  ipcMain.handle("add-open-project", async (_event, projectId: string, projectPath: string) => {
    addOpenProject(projectId, projectPath);
  });

  ipcMain.handle("restore-projects", async () => {
    const entries = getOpenProjects().slice().sort((a, b) => (b.lastOpened ?? "").localeCompare(a.lastOpened ?? ""));
    const results: Array<{ id: string; path: string; name: string; lastOpened: string }> = [];
    for (const entry of entries) {
      try {
        const { projectId } = await registerProject(entry.path, { lastOpened: entry.lastOpened });
        results.push({ id: projectId, path: entry.path, name: entry.name, lastOpened: entry.lastOpened });
      } catch (err) {
        console.error(`[restore-projects] failed to open project at ${entry.path}:`, err);
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

  ipcMain.handle("open-project-folder", async (_event, projectPath: string) => {
    await shell.openPath(projectPath);
  });

  ipcMain.handle("open-file", async (_event, filePath: string) => {
    if (typeof filePath !== "string" || filePath.length === 0) return;
    const projectRoots = getOpenProjects().map((entry) => entry.path);
    if (!isInsideAnyOpenProject(filePath, projectRoots)) return;
    const error = await shell.openPath(path.resolve(filePath));
    if (error) throw new Error(error);
  });

  ipcMain.handle("open-external", async (_event, url: string) => {
    if (typeof url !== "string") return;
    const parsed = (() => {
      try {
        return new URL(url);
      } catch {
        return null;
      }
    })();
    if (
      parsed &&
      (parsed.protocol === "http:" ||
        parsed.protocol === "https:" ||
        parsed.protocol === "mailto:" ||
        parsed.protocol === "tel:")
    ) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle("set-last-active-project", (_event, projectId: string) => {
    setLastActiveProject(projectId);
    const ts = bumpLastOpenedById(projectId);
    if (ts) setProjectLastOpened(projectId, ts);
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

  ipcMain.handle("open-sample-project", async (_event, opts: { sampleId: string }) => {
    let targetDir: string;
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
      targetDir = path.join(parentDir, entry.displayName);
      let counter = 2;
      while (existsSync(targetDir)) {
        targetDir = path.join(parentDir, `${entry.displayName}-${counter}`);
        counter++;
      }
      mkdirSync(targetDir, { recursive: true });
      cpSync(srcDir, targetDir, { recursive: true });
    } catch (err) {
      console.error("[open-sample-project] copy failed:", err);
      return { error: "copyFailed" };
    }
    try {
      const { projectId } = await registerProject(targetDir, { lastOpened: new Date().toISOString() });
      return { projectId, path: targetDir };
    } catch (err) {
      console.error("[open-sample-project] register failed:", err);
      return { error: "openFailed" };
    }
  });

  ipcMain.handle("get-sample-manifest", async () => {
    return readSampleManifest();
  });
}
