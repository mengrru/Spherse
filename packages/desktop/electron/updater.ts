import { app } from "electron";
import type { BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater, CancellationToken } = electronUpdater;
import type { UpdateState, UpdateEvent } from "./types.js";
import { getMainWindow } from "./window.js";

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
  let silent = false;
  let activeCancellationToken: CancellationToken | null = null;

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
    silent = false;
    sendEvent({
      type: "update-available",
      version: info.version,
      releaseNotes,
    });
  });

  autoUpdater.on("update-not-available", () => {
    currentState = { status: "upToDate" };
    if (silent) {
      silent = false;
      return;
    }
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
    if (silent) {
      silent = false;
      return;
    }
    sendEvent({ type: "update-error", message: errorMessage });
  });

  async function checkForUpdatesMacFallback(): Promise<void> {
    currentState = { status: "checking" };
    try {
      const res = await fetch(
        "https://api.github.com/repos/mengrru/Spherse/releases/latest",
        { headers: { "User-Agent": "Spherse-Updater" } },
      );
      if (!res.ok) {
        throw new Error(`GitHub API responded ${res.status}`);
      }
      const data = (await res.json()) as {
        tag_name?: string;
        body?: string;
        html_url?: string;
      };
      const tagName = data.tag_name ?? "";
      const version = tagName.replace(/^v/, "");
      const current = app.getVersion();
      if (compareVersions(version, current) > 0) {
        const releaseNotes = data.body ?? "";
        const downloadUrl = data.html_url;
        currentState = {
          status: "available",
          version,
          releaseNotes,
          downloadUrl,
        };
        silent = false;
        sendEvent({
          type: "update-available",
          version,
          releaseNotes,
          downloadUrl,
        });
      } else {
        currentState = { status: "upToDate" };
        if (silent) {
          silent = false;
          return;
        }
        sendEvent({ type: "update-not-available" });
      }
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : String(err ?? "");
      currentState = { status: "error", errorMessage };
      if (silent) {
        silent = false;
        return;
      }
      sendEvent({ type: "update-error", message: errorMessage });
    }
  }

  return {
    async checkForUpdates(opts: { silent: boolean }): Promise<void> {
      if (!app.isPackaged) {
        currentState = { status: "upToDate" };
        if (opts.silent) return;
        sendEvent({ type: "update-not-available" });
        return;
      }
      silent = opts.silent;
      if (process.platform === "darwin") {
        await checkForUpdatesMacFallback();
        return;
      }
      currentState = { status: "checking" };
      await autoUpdater.checkForUpdates();
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

export function checkForUpdatesSilently(): Promise<void> {
  return updater.checkForUpdates({ silent: true });
}
