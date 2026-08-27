import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const { appMock, events, autoUpdaterMock, powerMonitorMock } = vi.hoisted(() => {
  const appMock = {
    isPackaged: false,
    getVersion: () => "0.1.0",
  };
  const events: Array<Record<string, unknown>> = [];
  const autoUpdaterMock = {
    autoDownload: false,
    on: vi.fn(),
    checkForUpdates: vi.fn(),
  };
  const powerMonitorMock = {
    getSystemIdleTime: vi.fn<() => number>(() => 0),
  };
  return { appMock, events, autoUpdaterMock, powerMonitorMock };
});

vi.mock("electron", () => ({
  app: appMock,
  powerMonitor: powerMonitorMock,
}));
vi.mock("electron-updater", () => ({
  default: {
    autoUpdater: autoUpdaterMock,
    CancellationToken: class {},
  },
}));
vi.mock("./window.js", () => ({
  getMainWindow: () => ({
    webContents: {
      send: (_type: string, event: Record<string, unknown>) => {
        events.push(event);
      },
    },
  }),
}));

import {
  compareVersions,
  createUpdater,
  resolveDownloadUrlFromManifest,
  startAutoUpdateChecks,
  updater,
  type OssUpdateManifest,
  type Updater,
} from "./updater.js";

const MANIFEST_URL =
  "https://mengru-open-source.oss-cn-beijing.aliyuncs.com/spherse/latest.json";

const manifest: OssUpdateManifest = {
  version: "0.2.0",
  mac: {
    arm64: "https://oss/spherse/releases/0.2.0/Spherse-0.2.0-arm64.dmg",
    intel: "https://oss/spherse/releases/0.2.0/Spherse-0.2.0-intel.dmg",
  },
  win: {
    x64: "https://oss/spherse/releases/0.2.0/Spherse-Setup-0.2.0-x64.exe",
    arm64: "https://oss/spherse/releases/0.2.0/Spherse-Setup-0.2.0-arm64.exe",
  },
};

const fetchMock = vi.fn();

beforeEach(() => {
  events.length = 0;
  appMock.isPackaged = true;
  appMock.getVersion = () => "0.1.0";
  autoUpdaterMock.checkForUpdates.mockReset();
  powerMonitorMock.getSystemIdleTime.mockReturnValue(0);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockManifestResponse(body: unknown, ok = true, status = 200): void {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

function createTestUpdater(): {
  u: Updater;
  localEvents: Array<Record<string, unknown>>;
} {
  const localEvents: Array<Record<string, unknown>> = [];
  const fakeWindow = {
    webContents: {
      send: (_type: string, event: Record<string, unknown>) => {
        localEvents.push(event);
      },
    },
  } as unknown as BrowserWindow;
  return { u: createUpdater(() => fakeWindow), localEvents };
}

/** 临时切换 process.platform/arch（测试后还原，避免跨用例污染） */
async function withProcess(
  platform: NodeJS.Platform,
  arch: string,
  fn: () => Promise<void>,
): Promise<void> {
  const origPlatform = process.platform;
  const origArch = process.arch;
  Object.defineProperty(process, "platform", { value: platform });
  Object.defineProperty(process, "arch", { value: arch });
  try {
    await fn();
  } finally {
    Object.defineProperty(process, "platform", { value: origPlatform });
    Object.defineProperty(process, "arch", { value: origArch });
  }
}

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("returns positive when a > b (patch)", () => {
    expect(compareVersions("1.0.2", "1.0.1")).toBeGreaterThan(0);
  });

  it("returns negative when a < b (minor)", () => {
    expect(compareVersions("1.0.0", "1.1.0")).toBeLessThan(0);
  });

  it("returns positive when a > b (major)", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("handles different segment counts", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2")).toBeGreaterThan(0);
  });

  it("strips v prefix", () => {
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("v2.0.0", "v1.0.0")).toBeGreaterThan(0);
  });

  it("returns 0 when parsing fails (NaN guard)", () => {
    expect(compareVersions("beta", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "invalid")).toBe(0);
  });
});

describe("resolveDownloadUrlFromManifest", () => {
  it("darwin arm64 selects mac.arm64", () => {
    expect(
      resolveDownloadUrlFromManifest(manifest, "darwin", "arm64"),
    ).toBe(manifest.mac?.arm64);
  });

  it("darwin x64 selects mac.intel", () => {
    expect(
      resolveDownloadUrlFromManifest(manifest, "darwin", "x64"),
    ).toBe(manifest.mac?.intel);
  });

  it("darwin falls back to the other arch key when the preferred one is missing", () => {
    const m: OssUpdateManifest = {
      version: "0.2.0",
      mac: { intel: "https://oss/intel.dmg" },
    };
    expect(resolveDownloadUrlFromManifest(m, "darwin", "arm64")).toBe(
      "https://oss/intel.dmg",
    );
    expect(resolveDownloadUrlFromManifest(m, "darwin", "x64")).toBe(
      "https://oss/intel.dmg",
    );
  });

  it("darwin returns undefined when mac section is missing entirely", () => {
    expect(
      resolveDownloadUrlFromManifest(
        { version: "0.2.0" },
        "darwin",
        "arm64",
      ),
    ).toBeUndefined();
  });

  it("win32 x64 selects win.x64", () => {
    expect(
      resolveDownloadUrlFromManifest(manifest, "win32", "x64"),
    ).toBe(manifest.win?.x64);
  });

  it("win32 arm64 prefers win.arm64 and falls back to x64", () => {
    expect(
      resolveDownloadUrlFromManifest(manifest, "win32", "arm64"),
    ).toBe(manifest.win?.arm64);
    const noArm64: OssUpdateManifest = {
      version: "0.2.0",
      win: { x64: "https://oss/x64.exe" },
    };
    expect(
      resolveDownloadUrlFromManifest(noArm64, "win32", "arm64"),
    ).toBe("https://oss/x64.exe");
  });

  it("win32 falls back to legacy win.setup key", () => {
    const legacy: OssUpdateManifest = {
      version: "0.2.0",
      win: { setup: "https://oss/setup.exe" },
    };
    expect(resolveDownloadUrlFromManifest(legacy, "win32", "x64")).toBe(
      "https://oss/setup.exe",
    );
    expect(resolveDownloadUrlFromManifest(legacy, "win32", "arm64")).toBe(
      "https://oss/setup.exe",
    );
  });

  it("returns undefined on unknown platform", () => {
    expect(
      resolveDownloadUrlFromManifest(manifest, "linux", "x64"),
    ).toBeUndefined();
  });
});

describe("updater.checkForUpdates (OSS manifest source)", () => {
  it("dev mode short-circuits to upToDate without fetching", async () => {
    appMock.isPackaged = false;
    const { u, localEvents } = createTestUpdater();
    await u.checkForUpdates({ silent: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localEvents).toEqual([{ type: "update-not-available" }]);
    expect(u.getState()).toEqual({ status: "upToDate" });
  });

  it("dev mode silent check emits nothing and leaves state untouched", async () => {
    appMock.isPackaged = false;
    const { u, localEvents } = createTestUpdater();
    await u.checkForUpdates({ silent: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localEvents).toEqual([]);
    expect(u.getState()).toEqual({ status: "idle" });
  });

  it("darwin: newer manifest version emits update-available with OSS downloadUrl", async () => {
    mockManifestResponse(manifest);
    await withProcess("darwin", "arm64", () =>
      updater.checkForUpdates({ silent: false }),
    );
    expect(fetchMock).toHaveBeenCalledWith(MANIFEST_URL);
    expect(events).toEqual([
      {
        type: "update-available",
        version: "0.2.0",
        releaseNotes: "",
        downloadUrl: manifest.mac?.arm64,
        silent: false,
      },
    ]);
    expect(updater.getState()).toEqual({
      status: "available",
      version: "0.2.0",
      releaseNotes: "",
      downloadUrl: manifest.mac?.arm64,
    });
  });

  it("win32 x64: emits update-available with x64 installer URL", async () => {
    mockManifestResponse(manifest);
    await withProcess("win32", "x64", () =>
      updater.checkForUpdates({ silent: false }),
    );
    expect(events).toEqual([
      {
        type: "update-available",
        version: "0.2.0",
        releaseNotes: "",
        downloadUrl: manifest.win?.x64,
        silent: false,
      },
    ]);
  });

  it("equal or older manifest version emits update-not-available", async () => {
    mockManifestResponse({ ...manifest, version: "0.1.0" });
    await updater.checkForUpdates({ silent: false });
    expect(events).toEqual([{ type: "update-not-available" }]);
    expect(updater.getState()).toEqual({ status: "upToDate" });
  });

  it("manifest missing version degrades safely to update-not-available", async () => {
    mockManifestResponse({ mac: manifest.mac, win: manifest.win });
    await updater.checkForUpdates({ silent: false });
    expect(events).toEqual([{ type: "update-not-available" }]);
  });

  it("non-200 manifest response emits update-error", async () => {
    mockManifestResponse(null, false, 503);
    await updater.checkForUpdates({ silent: false });
    expect(events).toEqual([
      { type: "update-error", message: "OSS manifest responded 503" },
    ]);
    expect(updater.getState()).toEqual({
      status: "error",
      errorMessage: "OSS manifest responded 503",
    });
  });

  it("invalid JSON emits update-error", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("Unexpected token <")),
    });
    await updater.checkForUpdates({ silent: false });
    expect(events).toEqual([
      { type: "update-error", message: "Unexpected token <" },
    ]);
  });

  it("silent check still notifies on available but swallows not-available / error", async () => {
    // available 即使 silent 也通知（自动检测的目的就是发现新版 toast），
    // silent 只吞掉 not-available / error 噪音
    const { u, localEvents } = createTestUpdater();
    mockManifestResponse(manifest);
    await withProcess("darwin", "arm64", () =>
      u.checkForUpdates({ silent: true }),
    );
    expect(localEvents).toEqual([
      {
        type: "update-available",
        version: "0.2.0",
        releaseNotes: "",
        downloadUrl: manifest.mac?.arm64,
        silent: true,
      },
    ]);
    expect(u.getState()).toEqual({ status: "idle" });

    localEvents.length = 0;
    mockManifestResponse({ ...manifest, version: "0.1.0" });
    await u.checkForUpdates({ silent: true });
    expect(localEvents).toEqual([]);
    expect(u.getState()).toEqual({ status: "idle" });

    mockManifestResponse(null, false, 500);
    await u.checkForUpdates({ silent: true });
    expect(localEvents).toEqual([]);
    expect(u.getState()).toEqual({ status: "idle" });
  });

  it("silent check never overwrites an in-flight interactive state", async () => {
    const { u, localEvents } = createTestUpdater();
    mockManifestResponse(manifest);
    await withProcess("darwin", "arm64", () =>
      u.checkForUpdates({ silent: false }),
    );
    expect(u.getState().status).toBe("available");

    mockManifestResponse({ ...manifest, version: "0.1.0" });
    await u.checkForUpdates({ silent: true });
    expect(localEvents).toHaveLength(1);
    expect(u.getState().status).toBe("available");
  });

  it("never calls electron-updater's GitHub feed (regression guard)", async () => {
    mockManifestResponse(manifest);
    await updater.checkForUpdates({ silent: false });
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
  });
});

describe("createUpdater", () => {
  it("exposes the full Updater interface", () => {
    const u = createUpdater(() => null);
    expect(typeof u.checkForUpdates).toBe("function");
    expect(typeof u.downloadUpdate).toBe("function");
    expect(typeof u.installUpdate).toBe("function");
    expect(typeof u.cancelUpdate).toBe("function");
    expect(typeof u.getState).toBe("function");
  });
});

describe("startAutoUpdateChecks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks once shortly after startup, then at most once per 24h", async () => {
    mockManifestResponse(manifest);
    startAutoUpdateChecks();
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    mockManifestResponse(manifest);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips the check while the user is idle and retries on a later tick", async () => {
    mockManifestResponse(manifest);
    startAutoUpdateChecks();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    powerMonitorMock.getSystemIdleTime.mockReturnValue(600);
    mockManifestResponse(manifest);
    await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    powerMonitorMock.getSystemIdleTime.mockReturnValue(0);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not schedule a startup toast for up-to-date results (no events)", async () => {
    mockManifestResponse({ ...manifest, version: "0.1.0" });
    startAutoUpdateChecks();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
  });
});
