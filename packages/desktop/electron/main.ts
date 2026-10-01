import { app } from "electron";
import { createWindow, getMainWindow } from "./window.js";
import { restoreEnvFromSettings, getMobileAccess } from "./settings.js";
import { fixPath } from "./fix-path.js";
import { ensureServer, stopServer, getServerPort } from "./server.js";
import { registerAllIpc } from "./ipc/index.js";
import { startAutoUpdateChecks } from "./updater.js";
import { setupContextMenu } from "./ipc/context-menu.js";
import { getTunnelManager } from "./tunnel/manager.js";
import { settleWithin } from "@spherse/core";
import { configureShutdown } from "./lifecycle.js";
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

const TUNNEL_STOP_TIMEOUT_MS = 5_000;
const shutdown = configureShutdown({
  async cleanup() {
    let tunnelFailure: Error | undefined;
    await settleWithin(Promise.resolve().then(() => getTunnelManager().stop()), TUNNEL_STOP_TIMEOUT_MS, (outcome, detail) => {
      tunnelFailure = new Error(`Tunnel stop ${outcome}`, { cause: detail });
      console.error("[main] tunnel stop failed:", tunnelFailure);
    });
    await stopServer();
    if (tunnelFailure) throw tunnelFailure;
  },
  quit: () => app.quit(),
  relaunch: () => app.relaunch(),
  exit: (code) => app.exit(code),
});

app.on("window-all-closed", () => {
  void shutdown.quit();
});

app.on("before-quit", (event) => {
  if (!shutdown.canExit()) {
    event.preventDefault();
    void shutdown.quit();
  }
});

app.on("will-quit", () => {
  destroyTray();
});

app.on("activate", () => {
  void showMainWindow();
});

app.on("second-instance", () => {
  void showMainWindow();
});
