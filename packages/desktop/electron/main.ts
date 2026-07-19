import { app } from "electron";
import { createWindow, getMainWindow } from "./window.js";
import { restoreEnvFromSettings } from "./settings.js";
import { ensureServer, stopServer } from "./server.js";
import { registerAllIpc } from "./ipc/index.js";
import { checkForUpdatesSilently } from "./updater.js";
import { setupContextMenu } from "./ipc/context-menu.js";

app.whenReady().then(async () => {
  restoreEnvFromSettings();
  await ensureServer();
  createWindow();
  setupContextMenu(getMainWindow()!);
  registerAllIpc(getMainWindow);
  setTimeout(() => {
    void checkForUpdatesSilently();
  }, 5000);
});

let quitting = false;
async function gracefulShutdown(): Promise<void> {
  if (quitting) return;
  quitting = true;
  await stopServer();
  app.quit();
}

app.on("window-all-closed", () => {
  void gracefulShutdown();
});

app.on("before-quit", (event) => {
  if (!quitting) {
    event.preventDefault();
    void gracefulShutdown();
  }
});
