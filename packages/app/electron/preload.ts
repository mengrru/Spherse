import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  startServer: (projectRoot: string) =>
    ipcRenderer.invoke("start-server", projectRoot),
});
