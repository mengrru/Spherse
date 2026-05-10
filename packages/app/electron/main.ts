import { app } from "electron";
import { createWindow, getMainWindow } from "./window.js";
import { restoreEnvFromSettings } from "./settings.js";
import { stopAllServers } from "./server.js";
import { registerAllIpc } from "./ipc/index.js";

app.whenReady().then(() => {
  restoreEnvFromSettings();
  createWindow();
  registerAllIpc(getMainWindow);
});

app.on("window-all-closed", () => {
  stopAllServers();
  app.quit();
});

app.on("before-quit", () => {
  stopAllServers();
});
