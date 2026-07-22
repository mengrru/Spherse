import { app } from "electron";
import { createWindow, getMainWindow } from "./window.js";
import { restoreEnvFromSettings } from "./settings.js";
import { ensureServer, stopServer, getServerPort } from "./server.js";
import { registerAllIpc } from "./ipc/index.js";
import { checkForUpdatesSilently } from "./updater.js";
import { setupContextMenu } from "./ipc/context-menu.js";
import { getTunnelManager } from "./tunnel/manager.js";
import { getMobileAccess, setMobileAccess, generateAccessToken } from "./settings.js";

app.whenReady().then(async () => {
  restoreEnvFromSettings();
  const mobile = getMobileAccess();
  if ((mobile.mode ?? "quick") === "manual" && !mobile.token) {
    setMobileAccess({ token: generateAccessToken() });
  }
  await ensureServer();
  createWindow();
  setupContextMenu(getMainWindow()!);
  registerAllIpc(getMainWindow);
  setTimeout(() => {
    void checkForUpdatesSilently();
  }, 5000);

  if (mobile.enabled && (mobile.mode ?? "quick") === "quick") {
    try {
      void getTunnelManager().start(getServerPort());
    } catch (err) {
      console.error("[main] failed to start tunnel on launch:", err);
    }
  }
});

let quitting = false;
async function gracefulShutdown(): Promise<void> {
  if (quitting) return;
  quitting = true;
  await getTunnelManager().stop();
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
