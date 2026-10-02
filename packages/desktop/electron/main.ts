import { app } from "electron";
import { createWindow, getMainWindow } from "./window.js";
import { restoreEnvFromSettings, getMobileAccess } from "./settings.js";
import { fixPath } from "./fix-path.js";
import { ensureServer, getServerPort } from "./server.js";
import { registerAllIpc } from "./ipc/index.js";
import { startAutoUpdateChecks } from "./updater.js";
import { setupContextMenu } from "./ipc/context-menu.js";
import { getTunnelManager } from "./tunnel/manager.js";
import { registerQuitHandlers } from "./quit-handlers.js";
import { attachCloseToTray, destroyTray, showMainWindow, syncTray } from "./tray.js";

app.whenReady().then(async () => {
  await fixPath();
  restoreEnvFromSettings();
  await ensureServer();
  const mainWindow = createWindow();
  setupContextMenu(mainWindow);
  attachCloseToTray(mainWindow);
  registerAllIpc(getMainWindow);
  syncTray();
  startAutoUpdateChecks();

  const mobile = getMobileAccess();
  if (mobile.enabled && (mobile.mode ?? "quick") === "quick") {
    try {
      void getTunnelManager().start(getServerPort());
    } catch (err) {
      console.error("[main] failed to start tunnel on launch:", err);
    }
  }
});

registerQuitHandlers();

app.on("will-quit", () => {
  destroyTray();
});

app.on("activate", () => {
  void showMainWindow();
});

app.on("second-instance", () => {
  void showMainWindow();
});
