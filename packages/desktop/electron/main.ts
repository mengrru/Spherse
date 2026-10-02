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
import { beginQuit, beginUpdateQuit, isQuitting, isUpdateQuit } from "./lifecycle.js";
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
const GRACEFUL_SHUTDOWN_HARD_EXIT_MS = 30_000;
const UPDATE_QUIT_TUNNEL_STOP_TIMEOUT_MS = 1_000;

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

// 更新安装退走快路径：NSIS --updated 安装器约 1s 后开始收进程、约 3.3s 强杀，
// 常规 gracefulShutdown（隧道 5s + server 分阶段关闭）必然被截断。
// 跳过 server 优雅关闭（better-sqlite3 WAL 崩溃安全），隧道停止收敛 1s 内后直接退出。
async function fastShutdownForUpdate(): Promise<void> {
  await settleWithin(getTunnelManager().stop(), UPDATE_QUIT_TUNNEL_STOP_TIMEOUT_MS, (outcome, detail) => {
    if (outcome === "error") {
      console.error("[main] tunnel stop failed during update quit:", detail);
    } else if (outcome === "timeout") {
      console.error("[main] tunnel stop timed out during update quit, exiting anyway");
    }
  });
  destroyTray();
  app.exit(0);
}

// before-quit-for-update 是 electron-updater 在 quitAndInstall 前对 app.emit 的
// 自定义事件（Electron 类型定义未收录），监听以走更新退出的快路径
type ElectronAppUpdateEvents = {
  on(event: "before-quit-for-update", listener: () => void): unknown;
};

(app as unknown as ElectronAppUpdateEvents).on("before-quit-for-update", () => {
  if (beginUpdateQuit()) {
    void fastShutdownForUpdate();
  }
});

app.on("window-all-closed", () => {
  void gracefulShutdown();
});

app.on("before-quit", (event) => {
  if (isUpdateQuit()) {
    // 快路径期间的常规退出请求一律阻断，由 fastShutdownForUpdate 的 app.exit 收尾
    event.preventDefault();
    return;
  }
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
