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

async function fetchReleaseNotes(version: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`${OSS_BUCKET_BASE_URL}/changelog.json`, { signal: controller.signal });
    if (!response.ok) return "";
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("releases" in data) || !Array.isArray(data.releases)) return "";
    const target = version.trim().replace(/^v/, "");
    const release: unknown = data.releases.find((entry: unknown) =>
      entry !== null && typeof entry === "object" && "version" in entry &&
      typeof entry.version === "string" && entry.version.trim().replace(/^v/, "") === target,
    );
    if (!release || typeof release !== "object" || !("notes" in release) || !Array.isArray(release.notes)) return "";
    const notes: string[] = [];
    for (const note of release.notes as unknown[]) {
      if (!note || typeof note !== "object" || !("text" in note) || typeof note.text !== "string") return "";
      const text = note.text.replace(/\s+/g, " ").trim();
      if (text) notes.push(`- ${text.replace(/[!-/:-@[-`{-~]/g, "\\$&")}`);
    }
    return notes.join("\n");
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * OSS latest.json 清单结构（与 landing `resolveDownloadUrl` / CI `publish-oss`
 * 生成端对齐；`win.setup` 为旧版清单键名，保留兼容回退；`linux.x64` 与 `win.arm64`
 * 为可选键——旧版本 release 缺失时 CI 省略，读取端回退）。
 */
export interface OssUpdateManifest {
  version: string;
  mac?: { arm64?: string; intel?: string };
  win?: { x64?: string; arm64?: string; setup?: string };
  linux?: { x64?: string };
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
  if (platform === "linux") {
    return manifest.linux?.x64;
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

function inAppUpdateSupported(): boolean {
  return process.platform === "win32" && app.isPackaged;
}

/**
 * 从 manifest 下载 URL 派生 electron-updater generic feed 基址：
 * CI 将 latest.yml / latest-arm64.yml 与安装包上传到同一 `releases/{ver}/` 目录，
 * yml 内相对文件名以该基址解析。导出仅供测试。
 */
export function deriveFeedBaseUrl(downloadUrl: string): string {
  const url = new URL(downloadUrl);
  const lastSlash = url.pathname.lastIndexOf("/");
  url.pathname = lastSlash >= 0 ? url.pathname.slice(0, lastSlash + 1) : "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

interface OssManifestUpdate {
  version: string;
  downloadUrl: string;
}

/**
 * 裸拉最新 manifest（不派发任何事件）。downloadUpdate 每次现拉：
 * 点击「后台下载」可能距检测间隔数小时，manifest 可能已指向更新版本。
 */
export async function fetchOssManifestUpdate(): Promise<OssManifestUpdate | null> {
  const res = await fetch(OSS_UPDATE_MANIFEST_URL);
  if (!res.ok) {
    throw new Error(`OSS manifest responded ${res.status}`);
  }
  const data = (await res.json()) as Partial<OssUpdateManifest>;
  const version = typeof data.version === "string" ? data.version : "";
  if (!version || compareVersions(version, app.getVersion()) <= 0) return null;
  const downloadUrl = resolveDownloadUrlFromManifest(data as OssUpdateManifest);
  if (!downloadUrl) return null;
  return { version, downloadUrl };
}

export function createUpdater(getWindow: () => BrowserWindow | null): Updater {
  let currentState: UpdateState = { status: "idle" };
  let activeCancellationToken: CancellationTokenType | null = null;
  let manualCheckId = 0;

  function sendEvent(event: UpdateEvent): void {
    getWindow()?.webContents.send(event.type, event);
  }

  function reportDownloadError(err: unknown): void {
    const errorMessage =
      err instanceof Error ? err.message : String(err ?? "");
    currentState = { status: "error", errorMessage, errorPhase: "download" };
    sendEvent({ type: "update-error", message: errorMessage, phase: "download" });
  }

  // 仅转发下载生命周期事件。electron-updater 的 update-available /
  // update-not-available 是 downloadUpdate 内部 generic feed check 的产物，
  // 版本发现权归 OSS 检测（checkForUpdatesViaOss），转发会与弹窗/toast 冲突。
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
      downloadUrl: currentState.downloadUrl,
      inAppUpdate: currentState.inAppUpdate,
    };
    sendEvent({ type: "update-downloaded" });
  });

  autoUpdater.on("error", (err: unknown) => {
    const errorMessage =
      err instanceof Error ? err.message : String(err ?? "");
    currentState = { status: "error", errorMessage, errorPhase: "download" };
    sendEvent({ type: "update-error", message: errorMessage, phase: "download" });
  });

  async function checkForUpdatesViaOss(silent: boolean): Promise<void> {
    const checkId = silent ? manualCheckId : ++manualCheckId;
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
        // 下载进行中/已完成时不再重复发静默提醒（避免下载期间又弹「发现新版本」toast）
        if (silent && (currentState.status === "downloading" || currentState.status === "downloaded")) {
          return;
        }
        const downloadUrl = resolveDownloadUrlFromManifest(
          data as OssUpdateManifest,
        );
        const releaseNotes = !silent ? await fetchReleaseNotes(version) : "";
        if (!silent && checkId !== manualCheckId) return;
        const inAppUpdate = inAppUpdateSupported();
        if (!silent) {
          currentState = {
            status: "available",
            version,
            releaseNotes,
            downloadUrl,
            inAppUpdate,
          };
        }
        sendEvent({
          type: "update-available",
          version,
          releaseNotes,
          downloadUrl,
          silent,
          inAppUpdate,
        });
      } else {
        if (silent || checkId !== manualCheckId) return;
        currentState = { status: "upToDate" };
        sendEvent({ type: "update-not-available" });
      }
    } catch (err: unknown) {
      if (silent || checkId !== manualCheckId) return;
      const errorMessage =
        err instanceof Error ? err.message : String(err ?? "");
      currentState = { status: "error", errorMessage, errorPhase: "check" };
      sendEvent({ type: "update-error", message: errorMessage, phase: "check" });
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
      // 三平台统一 OSS 清单检测；Windows 在此之上额外提供 in-app
      // 后台下载（generic feed 指向 releases/{ver}/latest.yml），
      // macOS/Linux 仍引导浏览器下载。
      await checkForUpdatesViaOss(opts.silent);
    },

    async downloadUpdate(): Promise<void> {
      if (!inAppUpdateSupported()) return;
      if (currentState.status === "downloading" || currentState.status === "downloaded") return;

      let manifest: OssManifestUpdate | null;
      try {
        manifest = await fetchOssManifestUpdate();
      } catch (err: unknown) {
        reportDownloadError(err);
        return;
      }
      if (!manifest) {
        reportDownloadError(new Error("no newer update available in OSS manifest"));
        return;
      }

      try {
        const feedUrl = deriveFeedBaseUrl(manifest.downloadUrl);
        if (process.arch === "arm64") {
          // Windows 端 channel 文件名恒为 ${channel}.yml；arm64 应用读 latest-arm64.yml。
          // channel setter 会强制 allowDowngrade=true，需显式复位。
          autoUpdater.channel = "latest-arm64";
          autoUpdater.allowDowngrade = false;
        }
        autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });

        // downloadUpdate 内部依赖 checkForUpdates 填充的 updateInfoAndProvider；
        // 其网络/解析异常由 electron-updater 自行 emit "error"（上方监听已转发），此处不重复上报。
        const result = await autoUpdater.checkForUpdates();
        const feedVersion = result?.updateInfo?.version?.trim().replace(/^v/, "") ?? "";
        const manifestVersion = manifest.version.trim().replace(/^v/, "");
        if (!result?.isUpdateAvailable) {
          reportDownloadError(new Error(
            `update feed has no newer version (expected ${manifestVersion})`,
          ));
          return;
        }
        if (feedVersion !== manifestVersion) {
          reportDownloadError(new Error(
            `update feed version ${feedVersion} does not match manifest version ${manifestVersion}`,
          ));
          return;
        }

        currentState = {
          status: "downloading",
          version: manifest.version,
          releaseNotes: currentState.releaseNotes,
          downloadUrl: manifest.downloadUrl,
          inAppUpdate: true,
        };
        activeCancellationToken = new CancellationToken();
        await autoUpdater.downloadUpdate(activeCancellationToken);
      } catch {
        // 已由 electron-updater 的 "error" 事件转发；CancellationError 不派发事件，静默即可
      }
    },

    installUpdate(): Promise<void> {
      if (!inAppUpdateSupported() || currentState.status !== "downloaded") {
        return Promise.resolve();
      }
      // 静默安装到原目录（/S）并在完成后自动启动新版本（--force-run）
      autoUpdater.quitAndInstall(true, true);
      return Promise.resolve();
    },

    async cancelUpdate(): Promise<void> {
      if (!inAppUpdateSupported()) return;
      activeCancellationToken?.cancel();
      activeCancellationToken = null;
      if (currentState.status === "downloading") {
        // 取消后回到 available，保留版本信息，用户可再次发起
        currentState = {
          status: "available",
          version: currentState.version,
          releaseNotes: currentState.releaseNotes,
          downloadUrl: currentState.downloadUrl,
          inAppUpdate: currentState.inAppUpdate,
        };
      }
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
