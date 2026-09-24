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
import { beginQuit, isQuitting } from "./lifecycle.js";
import { attachCloseToTray, destroyTray, showMainWindow, syncTray } from "./tray.js";

app.whenReady().then(async () => {
  await fixPath();
  restoreEnvFromSettings();
  await ensureServer();
  const mainWindow = createWindow();
  setupContextMenu(mainWindow);
  attachCloseToTray(mainWindow);
  syncTray();
  registerAllIpc(getMainWindow);
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
const GRACEFUL_SHUTDOWN_HARD_EXIT_MS = 30_000;

async function gracefulShutdown(): Promise<void> {
  if (!beginQuit()) return;
  setTimeout(() => {
    console.error("[main] graceful shutdown timed out, forcing app exit");
    app.exit(1);
  }, GRACEFUL_SHUTDOWN_HARD_EXIT_MS).unref();
  await settleWithin(getTunnelManager().stop(), TUNNEL_STOP_TIMEOUT_MS, (outcome, detail) => {
    if (outcome === "error") {
      console.error("[main] tunnel stop failed:", detail);
    } else {
      console.error(`[main] tunnel stop timed out after ${TUNNEL_STOP_TIMEOUT_MS}ms, continuing`);
    }
  });
  await stopServer();
  app.quit();
}

app.on("window-all-closed", () => {
  void gracefulShutdown();
});

app.on("before-quit", (event) => {
  if (!isQuitting()) {
    event.preventDefault();
    void gracefulShutdown();
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
