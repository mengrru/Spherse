import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI, UpdateEvent } from "@shared/electron-api.js";

const UPDATE_EVENT_CHANNELS = [
  "update-available",
  "update-not-available",
  "download-progress",
  "update-downloaded",
  "update-error",
] as const;

contextBridge.exposeInMainWorld("electronAPI", {
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  selectSkillZip: () => ipcRenderer.invoke("select-skill-zip"),
  openProject: (projectRoot: string) =>
    ipcRenderer.invoke("open-project", projectRoot),
  getServerPort: () => ipcRenderer.invoke("get-server-port"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings: unknown) =>
    ipcRenderer.invoke("save-settings", settings),
  getSupportedProviders: () =>
    ipcRenderer.invoke("get-supported-providers"),
  getImageProviders: () =>
    ipcRenderer.invoke("get-image-providers"),
  restoreProjects: () => ipcRenderer.invoke("restore-projects"),
  addOpenProject: (projectId: string, projectRoot: string) =>
    ipcRenderer.invoke("add-open-project", projectId, projectRoot),
  closeProject: (projectId: string, projectPath: string) =>
    ipcRenderer.invoke("close-project", projectId, projectPath),
  openProjectFolder: (projectRoot: string) =>
    ipcRenderer.invoke("open-project-folder", projectRoot),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  setLastActiveProject: (projectId: string) =>
    ipcRenderer.invoke("set-last-active-project", projectId),
  getLastActiveProject: () =>
    ipcRenderer.invoke("get-last-active-project"),
  isDev: () => ipcRenderer.invoke("is-dev"),
  toggleDevTools: () => ipcRenderer.invoke("toggle-dev-tools"),
  isDevToolsOpen: () => ipcRenderer.invoke("is-dev-tools-open"),
  getElectronStoreData: () => ipcRenderer.invoke("get-electron-store-data"),
  reloadRenderer: () => ipcRenderer.invoke("reload-renderer"),
  resetAppData: () => ipcRenderer.invoke("reset-app-data"),
  showSaveDialog: (options: { defaultPath?: string }) =>
    ipcRenderer.invoke("show-save-dialog", options),
  createNewProject: () => ipcRenderer.invoke("create-new-project"),
  openSampleProject: (opts: { sampleId: string }) =>
    ipcRenderer.invoke("open-sample-project", opts),
  getSampleManifest: () => ipcRenderer.invoke("get-sample-manifest"),
  checkForUpdates: (opts: { silent: boolean }) =>
    ipcRenderer.invoke("check-for-updates", opts),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  cancelUpdate: () => ipcRenderer.invoke("cancel-update"),
  getUpdateState: () => ipcRenderer.invoke("get-update-state"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  onUpdateEvent: (callback: (event: UpdateEvent) => void) => {
    const handler = (_e: unknown, payload: UpdateEvent) => callback(payload);
    UPDATE_EVENT_CHANNELS.forEach((ch) => ipcRenderer.on(ch, handler));
    return () =>
      UPDATE_EVENT_CHANNELS.forEach((ch) =>
        ipcRenderer.removeListener(ch, handler),
      );
  },
} satisfies ElectronAPI);
