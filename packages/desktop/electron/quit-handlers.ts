import { app, autoUpdater as builtinAutoUpdater } from "electron";
import type { EventEmitter } from "node:events";
import { settleWithin } from "@spherse/core";
import { beginQuit, beginUpdateQuit, isQuitting, isUpdateQuit } from "./lifecycle.js";
import { getTunnelManager } from "./tunnel/manager.js";
import { stopServer } from "./server.js";
import { destroyTray } from "./tray.js";

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

export function registerQuitHandlers(): void {
  // before-quit-for-update 由 electron-updater 的 quitAndInstall 对 Electron 内置
  // autoUpdater 模块 emit（不在 app 上，Electron 类型定义亦未收录）
  (builtinAutoUpdater as unknown as EventEmitter).on("before-quit-for-update", () => {
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
}
