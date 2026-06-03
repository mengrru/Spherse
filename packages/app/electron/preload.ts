import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  startServer: (projectRoot: string) =>
    ipcRenderer.invoke("start-server", projectRoot),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings: unknown) =>
    ipcRenderer.invoke("save-settings", settings),
  getSupportedProviders: () =>
    ipcRenderer.invoke("get-supported-providers"),
  restoreProjects: () => ipcRenderer.invoke("restore-projects"),
  addOpenProject: (projectRoot: string) => ipcRenderer.invoke("add-open-project", projectRoot),
  closeProject: (projectRoot: string) =>
    ipcRenderer.invoke("close-project", projectRoot),
  revealInFinder: (projectRoot: string) =>
    ipcRenderer.invoke("reveal-in-finder", projectRoot),
  setLastActiveProject: (path: string) =>
    ipcRenderer.invoke("set-last-active-project", path),
  getLastActiveProject: () =>
    ipcRenderer.invoke("get-last-active-project"),
  setProjectLastRoute: (projectRoot: string, route: string) =>
    ipcRenderer.invoke("set-project-last-route", projectRoot, route),
  isDev: () => ipcRenderer.invoke("is-dev"),
  toggleDevTools: () => ipcRenderer.invoke("toggle-dev-tools"),
  isDevToolsOpen: () => ipcRenderer.invoke("is-dev-tools-open"),
  getElectronStoreData: () => ipcRenderer.invoke("get-electron-store-data"),
  reloadRenderer: () => ipcRenderer.invoke("reload-renderer"),
  resetAppData: () => ipcRenderer.invoke("reset-app-data"),
  showSaveDialog: (options: { defaultPath?: string }) =>
    ipcRenderer.invoke("show-save-dialog", options),
});
