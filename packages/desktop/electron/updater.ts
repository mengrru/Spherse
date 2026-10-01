import { app, BrowserWindow, powerMonitor } from "electron";
import { accessSync, constants } from "node:fs";
import electronUpdater from "electron-updater";
const { autoUpdater, CancellationToken } = electronUpdater;
type CancellationTokenType = electronUpdater.CancellationToken;
import type { UpdateState, UpdateEvent } from "./types.js";
import { shutdown, type ShutdownCoordinator } from "./lifecycle.js";

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

export function createUpdater(
  getWindows: () => BrowserWindow | BrowserWindow[] | null,
  getShutdown: () => ShutdownCoordinator | undefined = () => shutdown,
): Updater {
  const inApp = process.platform === "win32";
  const updateMode = inApp ? "inApp" : "external";
  let currentState: UpdateState = { status: "idle", updateMode };
  let check: { manual: boolean; task: Promise<void>; error?: unknown } | null = null;
  let download: { token: CancellationTokenType; cancelled: boolean; task: Promise<void>; error?: unknown } | null = null;
  let manualCheckId = 0;

  function sendEvent(event: UpdateEvent): void {
    const windows = getWindows();
    for (const win of Array.isArray(windows) ? windows : windows ? [windows] : []) {
      try {
        win.webContents.send(event.type, event);
      } catch (error) {
        console.error("[updater] failed to send event:", error);
      }
    }
  }

  function setState(state: UpdateState): void {
    currentState = { ...state, updateMode };
    if (inApp) sendEvent({ type: "update-state", state: { ...currentState } });
  }

  function setError(error: unknown, errorPhase: "check" | "download" | "install"): void {
    const errorMessage = error instanceof Error ? error.message : String(error ?? "");
    setState({ ...currentState, status: "error", errorMessage, errorPhase });
    if (!inApp) sendEvent({ type: "update-error", message: errorMessage });
  }

  if (inApp) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.disableDifferentialDownload = true;
    autoUpdater.setFeedURL({ provider: "generic", url: `${OSS_BUCKET_BASE_URL}/win/${process.arch}/` });
    autoUpdater.on("download-progress", (progress) => {
      if (!download || download.cancelled || currentState.status !== "downloading") return;
      const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
      if (Number.isFinite(percent)) setState({ ...currentState, percent });
    });
    autoUpdater.on("error", (error: unknown) => {
      if (download) download.error = error;
      else if (check) check.error = error;
      else if (currentState.status === "installing") getShutdown()?.failInstall(error);
    });
  }

  async function checkForUpdatesViaOss(silent: boolean): Promise<void> {
    const checkId = silent ? manualCheckId : ++manualCheckId;
    if (!silent) setState({ status: "checking" });
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
        const releaseNotes = !silent && (process.platform === "darwin" || process.platform === "linux")
          ? await fetchReleaseNotes(version)
          : "";
        if (!silent && checkId !== manualCheckId) return;
        if (!silent) {
          setState({
            status: "available",
            version,
            releaseNotes,
            downloadUrl,
          });
        }
        sendEvent({
          type: "update-available",
          version,
          releaseNotes,
          downloadUrl,
          updateMode,
          silent,
        });
      } else {
        if (silent || checkId !== manualCheckId) return;
        setState({ status: "upToDate" });
        sendEvent({ type: "update-not-available" });
      }
    } catch (err: unknown) {
      if (silent || checkId !== manualCheckId) return;
      setError(err, "check");
    }
  }

  return {
    checkForUpdates(opts: { silent: boolean }): Promise<void> {
      if (download || currentState.status === "downloaded" || currentState.status === "installing" || getShutdown()?.isQuitting()) return Promise.resolve();
      if (check) {
        if (!opts.silent && !check.manual) {
          check.manual = true;
          setState({ status: "checking" });
        }
        return check.task;
      }
      if (!app.isPackaged) {
        if (!opts.silent) {
          setState({ status: "upToDate" });
          if (!inApp) sendEvent({ type: "update-not-available" });
        }
        return Promise.resolve();
      }
      if (!inApp) return checkForUpdatesViaOss(opts.silent);
      check = { manual: !opts.silent, task: Promise.resolve() };
      if (check.manual) setState({ status: "checking" });
      check.task = Promise.resolve().then(async () => {
        try {
          const result = await autoUpdater.checkForUpdates();
          if (check?.error) throw check.error;
          if (result?.isUpdateAvailable) {
            const { version, releaseNotes: notes } = result.updateInfo;
            const releaseNotes = typeof notes === "string" ? notes : "";
            setState({ status: "available", version, releaseNotes });
            sendEvent({ type: "update-available", version, releaseNotes, updateMode, silent: !check?.manual });
          } else if (check?.manual) {
            setState({ status: "upToDate" });
          }
        } catch (error) {
          if (check?.manual) setError(error, "check");
        } finally {
          check = null;
        }
      });
      return check.task;
    },

    downloadUpdate(): Promise<void> {
      if (!inApp || check || getShutdown()?.isQuitting()) return Promise.resolve();
      if (download) return download.task;
      if (currentState.status !== "available" && !(currentState.status === "error" && currentState.errorPhase === "download")) return Promise.resolve();
      const metadata = { version: currentState.version, releaseNotes: currentState.releaseNotes };
      const active = { token: new CancellationToken(), cancelled: false, task: Promise.resolve(), error: undefined as unknown };
      download = active;
      setState({ ...metadata, status: "downloading", percent: 0 });
      active.task = Promise.resolve().then(async () => {
        try {
          if (!active.cancelled) {
            await autoUpdater.downloadUpdate(active.token);
            if (active.error) throw active.error;
            if (!active.cancelled) setState({ ...metadata, status: "downloaded" });
          }
        } catch (error) {
          if (!active.cancelled) setError(error, "download");
        } finally {
          download = null;
          if (active.cancelled) setState({ ...metadata, status: "available" });
        }
      });
      return active.task;
    },

    async installUpdate(): Promise<void> {
      if (!inApp || download || currentState.status !== "downloaded") return;
      const coordinator = getShutdown();
      if (!coordinator) {
        setError(new Error("Shutdown coordinator is unavailable"), "install");
        return;
      }
      if (coordinator.isQuitting()) return;
      setState({ ...currentState, status: "installing" });
      await coordinator.install(
        () => {
          const installerPath = "installerPath" in autoUpdater ? autoUpdater.installerPath : null;
          if (typeof installerPath !== "string" || !installerPath) {
            throw new Error("Downloaded update installer is unavailable");
          }
          accessSync(installerPath, constants.R_OK);
          autoUpdater.quitAndInstall(true, true);
        },
        (error) => setError(error, "install"),
      );
    },

    async cancelUpdate(): Promise<void> {
      if (!inApp || !download) return;
      download.cancelled = true;
      download.token.cancel();
      await download.task;
    },

    getState(): UpdateState {
      return { ...currentState };
    },
  };
}

export const updater = createUpdater(() => BrowserWindow.getAllWindows());

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
