import { app, powerMonitor } from "electron";
import type { BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater, CancellationToken } = electronUpdater;
type CancellationTokenType = electronUpdater.CancellationToken;
import type { UpdateState, UpdateEvent } from "./types.js";
import { getMainWindow } from "./window.js";

// 更新检测源：CI publish-oss job 每次发版自动维护的 OSS 清单（国内可达，
// 与 landing page 下载按钮同源）。替代此前 GitHub API / electron-updater
// GitHub feed（后者 latest.yml 自 ba8c049 起不再上传，检测必然 404）。
const OSS_BUCKET_BASE_URL =
  "https://mengru-open-source.oss-cn-beijing.aliyuncs.com/spherse";
const OSS_UPDATE_MANIFEST_URL = `${OSS_BUCKET_BASE_URL}/latest.json`;

/**
 * OSS latest.json 清单结构（与 landing `resolveDownloadUrl` / CI `publish-oss`
 * 生成端对齐；`win.setup` 为旧版清单键名，保留兼容回退）。
 */
export interface OssUpdateManifest {
  version: string;
  mac?: { arm64?: string; intel?: string };
  win?: { x64?: string; arm64?: string; setup?: string };
}

export function resolveDownloadUrlFromManifest(
  manifest: OssUpdateManifest,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined {
  if (platform === "darwin") {
    // x64 Mac 跑的是 intel 包（反之亦然，缺键时互为回退）；全缺 → undefined
    return arch === "arm64"
      ? (manifest.mac?.arm64 ?? manifest.mac?.intel)
      : (manifest.mac?.intel ?? manifest.mac?.arm64);
  }
  if (platform === "win32") {
    // x64 包在 ARM64 Windows 可模拟运行（与 landing 语义一致）
    if (arch === "arm64") {
      return manifest.win?.arm64 ?? manifest.win?.x64 ?? manifest.win?.setup;
    }
    return manifest.win?.x64 ?? manifest.win?.setup;
  }
  return undefined;
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

export interface Updater {
  checkForUpdates(opts: { silent: boolean }): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  cancelUpdate(): Promise<void>;
  getState(): UpdateState;
}

export function compareVersions(a: string, b: string): number {
  const pa = a
    .replace(/^v/, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10));
  const pb = b
    .replace(/^v/, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export function createUpdater(getWindow: () => BrowserWindow | null): Updater {
  let currentState: UpdateState = { status: "idle" };
  let activeCancellationToken: CancellationTokenType | null = null;

  function sendEvent(event: UpdateEvent): void {
    getWindow()?.webContents.send(event.type, event);
  }

  autoUpdater.on("update-available", (info) => {
    const releaseNotes =
      typeof info.releaseNotes === "string" ? info.releaseNotes : "";
    currentState = {
      status: "available",
      version: info.version,
      releaseNotes,
    };
    sendEvent({
      type: "update-available",
      version: info.version,
      releaseNotes,
      silent: false,
    });
  });

  autoUpdater.on("update-not-available", () => {
    currentState = { status: "upToDate" };
    sendEvent({ type: "update-not-available" });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent);
    currentState = { ...currentState, status: "downloading", percent };
    sendEvent({ type: "download-progress", percent });
  });

  autoUpdater.on("update-downloaded", () => {
    currentState = {
      status: "downloaded",
      version: currentState.version,
      releaseNotes: currentState.releaseNotes,
    };
    sendEvent({ type: "update-downloaded" });
  });

  autoUpdater.on("error", (err: unknown) => {
    const errorMessage =
      err instanceof Error ? err.message : String(err ?? "");
    currentState = { status: "error", errorMessage };
    sendEvent({ type: "update-error", message: errorMessage });
  });

  async function checkForUpdatesViaOss(silent: boolean): Promise<void> {
    if (!silent) currentState = { status: "checking" };
    try {
      const res = await fetch(OSS_UPDATE_MANIFEST_URL);
      if (!res.ok) {
        throw new Error(`OSS manifest responded ${res.status}`);
      }
      const data = (await res.json()) as Partial<OssUpdateManifest>;
      const version = typeof data.version === "string" ? data.version : "";
      const current = app.getVersion();
      if (compareVersions(version, current) > 0) {
        const downloadUrl = resolveDownloadUrlFromManifest(
          data as OssUpdateManifest,
        );
        // OSS 清单无 release notes，留空由 UI 自动隐藏
        const releaseNotes = "";
        if (!silent) {
          currentState = {
            status: "available",
            version,
            releaseNotes,
            downloadUrl,
          };
        }
        sendEvent({
          type: "update-available",
          version,
          releaseNotes,
          downloadUrl,
          silent,
        });
      } else {
        if (silent) return;
        currentState = { status: "upToDate" };
        sendEvent({ type: "update-not-available" });
      }
    } catch (err: unknown) {
      if (silent) return;
      const errorMessage =
        err instanceof Error ? err.message : String(err ?? "");
      currentState = { status: "error", errorMessage };
      sendEvent({ type: "update-error", message: errorMessage });
    }
  }

  return {
    async checkForUpdates(opts: { silent: boolean }): Promise<void> {
      if (!app.isPackaged) {
        if (opts.silent) return;
        currentState = { status: "upToDate" };
        sendEvent({ type: "update-not-available" });
        return;
      }
      // mac/win 统一走 OSS 清单检测 + 引导浏览器下载（前往下载）。
      // electron-updater 的 GitHub feed 自 ba8c049 起无 latest.yml，不再使用；
      // 其 in-app 下载 API 保留给未来恢复 feed（backlog #149）。
      await checkForUpdatesViaOss(opts.silent);
    },

    async downloadUpdate(): Promise<void> {
      if (process.platform === "darwin") return;
      currentState = { status: "downloading" };
      activeCancellationToken = new CancellationToken();
      await autoUpdater.downloadUpdate(activeCancellationToken);
    },

    installUpdate(): Promise<void> {
      if (process.platform === "darwin") return Promise.resolve();
      autoUpdater.quitAndInstall();
      return Promise.resolve();
    },

    async cancelUpdate(): Promise<void> {
      if (process.platform === "darwin") return;
      activeCancellationToken?.cancel();
      activeCancellationToken = null;
      currentState = { status: "idle" };
    },

    getState(): UpdateState {
      return { ...currentState };
    },
  };
}

export const updater = createUpdater(() => getMainWindow());

const AUTO_CHECK_STARTUP_DELAY_MS = 5_000;
const AUTO_CHECK_TICK_MS = 60 * 60 * 1000;
const AUTO_CHECK_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTO_CHECK_USER_ACTIVE_IDLE_SEC = 300;

export function startAutoUpdateChecks(): void {
  let lastCheckAt = 0;
  const runCheck = (): void => {
    lastCheckAt = Date.now();
    void updater.checkForUpdates({ silent: true });
  };
  setTimeout(runCheck, AUTO_CHECK_STARTUP_DELAY_MS);
  setInterval(() => {
    if (Date.now() - lastCheckAt < AUTO_CHECK_MIN_INTERVAL_MS) return;
    if (powerMonitor.getSystemIdleTime() > AUTO_CHECK_USER_ACTIVE_IDLE_SEC) {
      return;
    }
    runCheck();
  }, AUTO_CHECK_TICK_MS);
}
