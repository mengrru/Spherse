import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { createShutdownCoordinator, type ShutdownCoordinator } from "./lifecycle.js";

const { appMock, events, autoUpdaterMock, powerMonitorMock } = vi.hoisted(() => {
  const appMock = {
    isPackaged: false,
    getVersion: () => "0.1.0",
  };
  const events: Array<Record<string, unknown>> = [];
  const autoUpdaterMock = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    disableDifferentialDownload: false,
    on: vi.fn(),
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    installerPath: "installer.exe" as string | null,
  };
  const powerMonitorMock = {
    getSystemIdleTime: vi.fn<() => number>(() => 0),
  };
  return { appMock, events, autoUpdaterMock, powerMonitorMock };
});

const { accessMock } = vi.hoisted(() => ({ accessMock: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  accessSync: accessMock,
}));

vi.mock("electron", () => ({
  app: appMock,
  powerMonitor: powerMonitorMock,
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: (_type: string, event: Record<string, unknown>) => { events.push(event); } } }],
  },
}));
vi.mock("electron-updater", () => ({
  default: {
    autoUpdater: autoUpdaterMock,
    CancellationToken: class { cancel = vi.fn(); },
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
  linux: {
    x64: "https://oss/spherse/releases/0.2.0/Spherse-0.2.0-x64.AppImage",
  },
};

const fetchMock = vi.fn();

beforeEach(() => {
  events.length = 0;
  appMock.isPackaged = true;
  appMock.getVersion = () => "0.1.0";
  autoUpdaterMock.checkForUpdates.mockReset();
  autoUpdaterMock.downloadUpdate.mockReset();
  autoUpdaterMock.quitAndInstall.mockReset();
  autoUpdaterMock.installerPath = "installer.exe";
  accessMock.mockReset();
  autoUpdaterMock.on.mockClear();
  autoUpdaterMock.setFeedURL.mockClear();
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

function createTestUpdater(coordinator?: ShutdownCoordinator): {
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
  return { u: createUpdater(() => fakeWindow, () => coordinator), localEvents };
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

  it("linux x64 selects linux.x64 and returns undefined when section is missing (legacy manifest)", () => {
    expect(
      resolveDownloadUrlFromManifest(manifest, "linux", "x64"),
    ).toBe(manifest.linux?.x64);
    expect(
      resolveDownloadUrlFromManifest({ version: "0.2.0" }, "linux", "x64"),
    ).toBeUndefined();
  });

  it("returns undefined on unknown platform", () => {
    expect(
      resolveDownloadUrlFromManifest(manifest, "freebsd", "x64"),
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
    expect(u.getState()).toEqual({ status: "upToDate", updateMode: "external" });
  });

  it("dev mode silent check emits nothing and leaves state untouched", async () => {
    appMock.isPackaged = false;
    const { u, localEvents } = createTestUpdater();
    await u.checkForUpdates({ silent: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localEvents).toEqual([]);
    expect(u.getState()).toEqual({ status: "idle", updateMode: "external" });
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
        updateMode: "external",
      },
    ]);
    expect(updater.getState()).toEqual({
      status: "available",
      version: "0.2.0",
      releaseNotes: "",
      downloadUrl: manifest.mac?.arm64,
      updateMode: "external",
    });
  });

  it("equal or older manifest version emits update-not-available", async () => {
    mockManifestResponse({ ...manifest, version: "0.1.0" });
    await updater.checkForUpdates({ silent: false });
    expect(events).toEqual([{ type: "update-not-available" }]);
    expect(updater.getState()).toEqual({ status: "upToDate", updateMode: "external" });
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
      errorPhase: "check",
      updateMode: "external",
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
        updateMode: "external",
      },
    ]);
    expect(u.getState()).toEqual({ status: "idle", updateMode: "external" });

    localEvents.length = 0;
    mockManifestResponse({ ...manifest, version: "0.1.0" });
    await u.checkForUpdates({ silent: true });
    expect(localEvents).toEqual([]);
    expect(u.getState()).toEqual({ status: "idle", updateMode: "external" });

    mockManifestResponse(null, false, 500);
    await u.checkForUpdates({ silent: true });
    expect(localEvents).toEqual([]);
    expect(u.getState()).toEqual({ status: "idle", updateMode: "external" });
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

  it("Linux preserves external manifest downloads without configuring electron-updater", async () => {
    await withProcess("linux", "x64", async () => {
      const { u, localEvents } = createTestUpdater();
      mockManifestResponse(manifest);
      await u.checkForUpdates({ silent: false });
      expect(u.getState()).toMatchObject({ status: "available", updateMode: "external", downloadUrl: manifest.linux?.x64 });
      expect(localEvents).toEqual([{ type: "update-available", version: "0.2.0", releaseNotes: "", downloadUrl: manifest.linux?.x64, updateMode: "external", silent: false }]);
      expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled();
      expect(autoUpdaterMock.on).not.toHaveBeenCalled();
      await u.downloadUpdate();
      await u.installUpdate();
      expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
    });
  });
});

describe("manual external update changelog", () => {
  const changelogUrl = "https://mengru-open-source.oss-cn-beijing.aliyuncs.com/spherse/changelog.json";

  it.each(["darwin", "linux"] as const)("%s selects only the exact target version and keeps download metadata", async (platform) => {
    await withProcess(platform, "x64", async () => {
      const { u, localEvents } = createTestUpdater();
      mockManifestResponse(manifest);
      mockManifestResponse({ releases: [
        { version: "0.3.0", notes: [{ text: "Wrong release" }] },
        { version: " v0.2.0 ", notes: [{ type: "feat", text: "New feature" }, { type: null, text: "  Fixed\n issue  " }] },
      ] });
      await u.checkForUpdates({ silent: false });
      const releaseNotes = "- New feature\n- Fixed issue";
      expect(u.getState()).toMatchObject({ status: "available", version: "0.2.0", releaseNotes,
        downloadUrl: platform === "darwin" ? manifest.mac?.intel : manifest.linux?.x64 });
      expect(localEvents).toEqual([expect.objectContaining({ type: "update-available", releaseNotes, silent: false })]);
      expect(fetchMock).toHaveBeenLastCalledWith(changelogUrl, { signal: expect.any(AbortSignal) });
    });
  });

  it("escapes explicit Markdown and HTML while preserving plain text", async () => {
    await withProcess("darwin", "arm64", async () => {
      const { u } = createTestUpdater();
      mockManifestResponse({ ...manifest, version: "v0.2.0" });
      mockManifestResponse({ releases: [{ version: "0.2.0", notes: [
        { text: "![image](https://example.com) <b>hi</b> **bold** user@example.com" },
      ] }] });
      await u.checkForUpdates({ silent: false });
      expect(u.getState().releaseNotes).toBe(String.raw`- \!\[image\]\(https\:\/\/example\.com\) \<b\>hi\<\/b\> \*\*bold\*\* user\@example\.com`);
    });
  });

  it.each([
    null, {}, { releases: null }, { releases: [null, {}] },
    { releases: [{ version: "0.2.0-beta", notes: [{ text: "Wrong version" }] }] },
    { releases: [{ version: "0.2.0", notes: [] }] },
    { releases: [{ version: "0.2.0", notes: [{ text: " " }] }] },
    { releases: [{ version: "0.2.0", notes: [{ text: 42 }] }] },
  ])("keeps the update downloadable when changelog has no valid target notes (%j)", async (data) => {
    await withProcess("linux", "x64", async () => {
      const { u, localEvents } = createTestUpdater();
      mockManifestResponse(manifest);
      mockManifestResponse(data);
      await u.checkForUpdates({ silent: false });
      expect(u.getState()).toMatchObject({ status: "available", releaseNotes: "", downloadUrl: manifest.linux?.x64 });
      expect(localEvents).toHaveLength(1);
      expect(localEvents[0].type).toBe("update-available");
    });
  });

  it.each(["http", "network", "json"])("ignores optional changelog %s failures", async (failure) => {
    await withProcess("darwin", "arm64", async () => {
      const { u } = createTestUpdater();
      mockManifestResponse(manifest);
      if (failure === "network") fetchMock.mockRejectedValueOnce(new Error("offline"));
      else if (failure === "json") fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error("bad JSON"); } });
      else mockManifestResponse(null, false, 503);
      await u.checkForUpdates({ silent: false });
      expect(u.getState()).toMatchObject({ status: "available", releaseNotes: "", downloadUrl: manifest.mac?.arm64 });
    });
  });

  it.each(["headers", "body"])("bounds changelog %s waiting to three seconds", async (phase) => {
    vi.useFakeTimers();
    try {
      await withProcess("darwin", "arm64", async () => {
        const { u } = createTestUpdater();
        mockManifestResponse(manifest);
        fetchMock.mockImplementationOnce((_url, { signal }: { signal: AbortSignal }) => {
          const stalled = new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
          return phase === "headers" ? stalled : Promise.resolve({ ok: true, json: () => stalled });
        });
        const task = u.checkForUpdates({ silent: false });
        await vi.advanceTimersByTimeAsync(2_999);
        expect(u.getState().status).toBe("checking");
        await vi.advanceTimersByTimeAsync(1);
        await task;
        expect(u.getState()).toMatchObject({ status: "available", releaseNotes: "" });
        expect(vi.getTimerCount()).toBe(0);
      });
    } finally { vi.useRealTimers(); }
  });

  it.each(["silent", "windows", "current"])("does not fetch changelog for %s checks", async (mode) => {
    await withProcess(mode === "windows" ? "win32" : "darwin", "x64", async () => {
      const { u } = createTestUpdater();
      mockManifestResponse({ ...manifest, version: mode === "current" ? "0.1.0" : "0.2.0" });
      await u.checkForUpdates({ silent: mode === "silent" });
      if (mode === "windows") {
        expect(fetchMock).not.toHaveBeenCalled();
        expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
        return;
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(MANIFEST_URL);
    });
  });

  it("does not let delayed notes overwrite a newer manual check", async () => {
    await withProcess("darwin", "arm64", async () => {
      const { u, localEvents } = createTestUpdater();
      let resolveNotes!: (value: unknown) => void;
      mockManifestResponse(manifest);
      fetchMock.mockResolvedValueOnce({ ok: true, json: () => new Promise((resolve) => { resolveNotes = resolve; }) });
      const first = u.checkForUpdates({ silent: false });
      await vi.waitFor(() => expect(resolveNotes).toBeDefined());
      mockManifestResponse({ ...manifest, version: "0.1.0" });
      await u.checkForUpdates({ silent: false });
      resolveNotes({ releases: [{ version: "0.2.0", notes: [{ text: "Too late" }] }] });
      await first;
      expect(u.getState()).toEqual({ status: "upToDate", updateMode: "external" });
      expect(localEvents).toEqual([{ type: "update-not-available" }]);
    });
  });

  it("keeps pending manual notes valid when a silent check completes", async () => {
    await withProcess("darwin", "arm64", async () => {
      const { u, localEvents } = createTestUpdater();
      let resolveNotes!: (value: unknown) => void;
      mockManifestResponse(manifest);
      fetchMock.mockResolvedValueOnce({ ok: true, json: () => new Promise((resolve) => { resolveNotes = resolve; }) });
      const manual = u.checkForUpdates({ silent: false });
      await vi.waitFor(() => expect(resolveNotes).toBeDefined());
      mockManifestResponse(manifest);
      await u.checkForUpdates({ silent: true });
      resolveNotes({ releases: [{ version: "0.2.0", notes: [{ text: "Manual notes" }] }] });
      await manual;
      expect(u.getState()).toMatchObject({ status: "available", releaseNotes: "- Manual notes" });
      expect(localEvents).toEqual([
        expect.objectContaining({ silent: true, releaseNotes: "" }),
        expect.objectContaining({ silent: false, releaseNotes: "- Manual notes" }),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  it.each(["current", "error"])("ignores an older manifest %s result after a newer check", async (result) => {
    await withProcess("linux", "x64", async () => {
      const { u, localEvents } = createTestUpdater();
      let resolveManifest!: (value: unknown) => void;
      let rejectManifest!: (error: Error) => void;
      fetchMock.mockImplementationOnce(() => new Promise((resolve, reject) => {
        resolveManifest = resolve;
        rejectManifest = reject;
      }));
      const first = u.checkForUpdates({ silent: false });
      mockManifestResponse(manifest);
      mockManifestResponse({ releases: [{ version: "0.2.0", notes: [{ text: "Current notes" }] }] });
      await u.checkForUpdates({ silent: false });
      if (result === "error") rejectManifest(new Error("Old request failed"));
      else resolveManifest({ ok: true, json: async () => ({ ...manifest, version: "0.1.0" }) });
      await first;
      expect(u.getState()).toMatchObject({ status: "available", releaseNotes: "- Current notes" });
      expect(localEvents).toHaveLength(1);
      expect(localEvents[0].type).toBe("update-available");
    });
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

  it("linux 与 darwin 一样对 in-app 下载/安装 no-op（不走已废弃的 electron-updater feed）", async () => {
    const { u } = createTestUpdater();
    await withProcess("linux", "x64", async () => {
      await expect(u.downloadUpdate()).resolves.toBeUndefined();
      await expect(u.installUpdate()).resolves.toBeUndefined();
      await expect(u.cancelUpdate()).resolves.toBeUndefined();
    });
    expect(u.getState()).toEqual({ status: "idle", updateMode: "external" });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function emit(type: string, value: unknown): void {
  for (const [name, listener] of autoUpdaterMock.on.mock.calls) {
    if (name === type) listener(value);
  }
}

const availableResult = {
  isUpdateAvailable: true,
  updateInfo: { version: "0.2.0", releaseNotes: "New release" },
};

describe("Windows in-app updates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    autoUpdaterMock.checkForUpdates.mockResolvedValue(availableResult);
    autoUpdaterMock.downloadUpdate.mockResolvedValue(["installer.exe"]);
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it.each(["x64", "arm64"])("configures the %s generic feed and disables automatic/differential installation", async (arch) => {
    await withProcess("win32", arch, async () => {
      const { u, localEvents } = createTestUpdater();
      expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledExactlyOnceWith({
        provider: "generic", url: `https://mengru-open-source.oss-cn-beijing.aliyuncs.com/spherse/win/${arch}/`,
      });
      expect(autoUpdaterMock.autoDownload).toBe(false);
      expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false);
      expect(autoUpdaterMock.disableDifferentialDownload).toBe(true);
      await u.checkForUpdates({ silent: true });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(u.getState()).toEqual({ status: "available", updateMode: "inApp", version: "0.2.0", releaseNotes: "New release" });
      expect(localEvents).toEqual([
        { type: "update-state", state: u.getState() },
        { type: "update-available", version: "0.2.0", releaseNotes: "New release", updateMode: "inApp", silent: true },
      ]);
    });
  });

  it.each(["available", "current", "error"])("promotes an overlapping silent check to manual (%s)", async (result) => {
    await withProcess("win32", "x64", async () => {
      const pending = deferred<unknown>();
      autoUpdaterMock.checkForUpdates.mockReturnValue(pending.promise);
      const { u, localEvents } = createTestUpdater();
      const silent = u.checkForUpdates({ silent: true });
      const manual = u.checkForUpdates({ silent: false });
      expect(manual).toBe(silent);
      expect(u.getState().status).toBe("checking");
      await Promise.resolve();
      if (result === "error") {
        emit("error", new Error("offline"));
        pending.reject(new Error("offline"));
      } else pending.resolve(result === "available" ? availableResult : { isUpdateAvailable: false });
      await Promise.all([manual, silent]);
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
      expect(u.getState().status).toBe(result === "available" ? "available" : result === "error" ? "error" : "upToDate");
      if (result === "available") expect(localEvents.at(-1)).toMatchObject({ type: "update-available", silent: false });
      if (result === "error") {
        expect(u.getState()).toMatchObject({ errorPhase: "check", errorMessage: "offline", updateMode: "inApp" });
        expect(localEvents.filter((e) => (e.state as { status?: string })?.status === "error")).toHaveLength(1);
      }
      expect(localEvents.every((e) => ["update-state", "update-available"].includes(e.type as string))).toBe(true);
    });
  });

  it("silent no-update/error results leave state and notifications untouched", async () => {
    await withProcess("win32", "x64", async () => {
      const { u, localEvents } = createTestUpdater();
      autoUpdaterMock.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: false });
      await u.checkForUpdates({ silent: true });
      autoUpdaterMock.checkForUpdates.mockImplementationOnce(async () => {
        emit("error", new Error("offline"));
        throw new Error("offline");
      });
      await u.checkForUpdates({ silent: true });
      expect(localEvents).toEqual([]);
      expect(u.getState()).toEqual({ status: "idle", updateMode: "inApp" });
    });
  });

  it("a silent overlap never demotes a manual check", async () => {
    await withProcess("win32", "x64", async () => {
      const pending = deferred<unknown>();
      autoUpdaterMock.checkForUpdates.mockReturnValue(pending.promise);
      const { u, localEvents } = createTestUpdater();
      const manual = u.checkForUpdates({ silent: false });
      expect(u.checkForUpdates({ silent: true })).toBe(manual);
      pending.resolve(availableResult);
      await manual;
      expect(localEvents.at(-1)).toMatchObject({ type: "update-available", silent: false });
    });
  });

  it("cancellation before the deferred download starts avoids the network entirely", async () => {
    await withProcess("win32", "x64", async () => {
      const { u } = createTestUpdater();
      await u.checkForUpdates({ silent: true });
      const task = u.downloadUpdate();
      await u.cancelUpdate();
      await task;
      expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
      expect(u.getState().status).toBe("available");
    });
  });

  it("broadcasts immediately to every window and completes cached downloads without progress", async () => {
    await withProcess("win32", "x64", async () => {
      const sends = [vi.fn(), vi.fn()];
      const u = createUpdater(() => sends.map((send) => ({ webContents: { send } }) as unknown as BrowserWindow));
      await u.checkForUpdates({ silent: false });
      const task = u.downloadUpdate();
      expect(u.downloadUpdate()).toBe(task);
      for (const send of sends) expect(send).toHaveBeenLastCalledWith("update-state", { type: "update-state", state: {
        status: "downloading", percent: 0, version: "0.2.0", releaseNotes: "New release", updateMode: "inApp",
      } });
      await task;
      expect(u.getState()).toEqual({ status: "downloaded", version: "0.2.0", releaseNotes: "New release", updateMode: "inApp" });
      const snapshot = u.getState();
      snapshot.status = "idle";
      await u.checkForUpdates({ silent: false });
      await u.downloadUpdate();
      await u.cancelUpdate();
      expect(u.getState().status).toBe("downloaded");
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
      expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1);
    });
  });

  it.each(["resolve", "reject"])("waits for cancellation to settle, ignores late events and permits retry (%s)", async (completion) => {
    await withProcess("win32", "x64", async () => {
      const { u, localEvents } = createTestUpdater();
      await u.checkForUpdates({ silent: false });
      const pending = deferred<string[]>();
      autoUpdaterMock.downloadUpdate.mockReturnValueOnce(pending.promise);
      const task = u.downloadUpdate();
      await Promise.resolve();
      emit("download-progress", { percent: 23.8 });
      expect(u.getState().percent).toBe(24);
      const cancel = u.cancelUpdate();
      expect(autoUpdaterMock.downloadUpdate.mock.calls[0][0].cancel).toHaveBeenCalledTimes(1);
      expect(u.downloadUpdate()).toBe(task);
      await u.checkForUpdates({ silent: false });
      const state = u.getState();
      emit("download-progress", { percent: 100 });
      emit("update-downloaded", {});
      emit("error", new Error("cancelled"));
      expect(u.getState()).toEqual(state);
      if (completion === "resolve") pending.resolve(["installer.exe"]);
      else pending.reject(new Error("cancelled"));
      await Promise.all([cancel, task]);
      expect(u.getState()).toEqual({ status: "available", version: "0.2.0", releaseNotes: "New release", updateMode: "inApp" });
      expect(localEvents.some((e) => (e.state as { status?: string })?.status === "error")).toBe(false);
      emit("download-progress", { percent: 90 });
      emit("update-downloaded", {});
      expect(u.getState().status).toBe("available");
      await u.downloadUpdate();
      expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(2);
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
      expect(u.getState().status).toBe("downloaded");
    });
  });

  it("turns emitted error plus rejection into one metadata-preserving download error and retries", async () => {
    await withProcess("win32", "x64", async () => {
      const { u, localEvents } = createTestUpdater();
      await u.checkForUpdates({ silent: false });
      autoUpdaterMock.downloadUpdate.mockImplementationOnce(async () => {
        emit("error", new Error("network"));
        throw new Error("network");
      });
      await expect(u.downloadUpdate()).resolves.toBeUndefined();
      expect(u.getState()).toMatchObject({ status: "error", version: "0.2.0", releaseNotes: "New release", updateMode: "inApp", errorPhase: "download", errorMessage: "network" });
      expect(localEvents.filter((e) => (e.state as { status?: string })?.status === "error")).toHaveLength(1);
      expect(localEvents.every((e) => ["update-state", "update-available"].includes(e.type as string))).toBe(true);
      await u.downloadUpdate();
      expect(u.getState()).toEqual({ status: "downloaded", version: "0.2.0", releaseNotes: "New release", updateMode: "inApp" });
    });
  });

  it("rejects downloads in idle, checking, and check-error states", async () => {
    await withProcess("win32", "x64", async () => {
      const { u } = createTestUpdater();
      await u.downloadUpdate();
      autoUpdaterMock.checkForUpdates.mockRejectedValue(new Error("check"));
      const check = u.checkForUpdates({ silent: false });
      await u.downloadUpdate();
      await check;
      await u.downloadUpdate();
      await u.installUpdate();
      expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
    });
  });

  it.each(["missing", "unreadable", "no-path", "readable"])("checks the current installer after cleanup and recovers on failure (%s)", async (result) => {
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
    await withProcess("win32", "x64", async () => {
      const pending = deferred<void>();
      const actions = { cleanup: vi.fn(() => pending.promise), quit: vi.fn(), relaunch: vi.fn(), exit: vi.fn() };
      const coordinator = createShutdownCoordinator(actions);
      const { u, localEvents } = createTestUpdater(coordinator);
      await u.checkForUpdates({ silent: true });
      await u.downloadUpdate();
      const task = u.installUpdate();
      await Promise.resolve();
      expect(actions.cleanup).toHaveBeenCalledTimes(1);
      expect(accessMock).not.toHaveBeenCalled();
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
      const path = fileURLToPath(import.meta.url) + (result === "missing" ? ".missing-installer.exe" : "");
      autoUpdaterMock.installerPath = result === "no-path" ? null : path;
      accessMock.mockImplementation((file, mode) => {
        if (result === "unreadable") throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
        fs.accessSync(file, mode);
      });
      autoUpdaterMock.quitAndInstall.mockImplementation(() => {
        expect(accessMock).toHaveBeenCalledExactlyOnceWith(path, constants.R_OK);
      });
      pending.resolve();
      await task;
      if (result === "readable") {
        expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true);
        expect(actions.relaunch).not.toHaveBeenCalled();
        return;
      }
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
      expect(u.getState()).toMatchObject({ status: "error", errorPhase: "install", updateMode: "inApp", version: "0.2.0" });
      expect(u.getState().errorMessage).toContain(result === "missing" ? "ENOENT" : result === "unreadable" ? "EACCES" : "unavailable");
      expect(localEvents.filter((e) => (e.state as { status?: string })?.status === "error")).toHaveLength(1);
      expect(actions.relaunch).toHaveBeenCalledTimes(1);
      expect(actions.quit).toHaveBeenCalledTimes(1);
      expect(coordinator.canExit()).toBe(true);
    });
  });

  it.each(["success", "throw", "event", "late-event", "cleanup", "quit-first"])("coordinates install and shutdown (%s)", async (result) => {
    await withProcess("win32", "x64", async () => {
      const pending = deferred<void>();
      const actions = { cleanup: vi.fn(() => pending.promise), quit: vi.fn(), relaunch: vi.fn(), exit: vi.fn() };
      const coordinator = createShutdownCoordinator(actions);
      const { u, localEvents } = createTestUpdater(coordinator);
      await u.checkForUpdates({ silent: false });
      await u.downloadUpdate();
      autoUpdaterMock.quitAndInstall.mockImplementation(() => {
        if (result === "throw") throw new Error("install");
        if (result === "event") emit("error", new Error("install"));
      });
      if (result === "quit-first") void coordinator.quit();
      const install = u.installUpdate();
      const quit = coordinator.quit();
      await u.installUpdate();
      await u.downloadUpdate();
      await u.checkForUpdates({ silent: false });
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
      expect(coordinator.canExit()).toBe(false);
      if (result === "cleanup") pending.reject(new Error("install"));
      else pending.resolve();
      await Promise.all([install, quit]);
      expect(actions.cleanup).toHaveBeenCalledTimes(1);
      if (result === "quit-first" || result === "cleanup") expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
      else expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true);
      if (result === "late-event") emit("error", new Error("install"));
      if (["throw", "event", "late-event", "cleanup"].includes(result)) {
        expect(u.getState()).toMatchObject({ status: "error", errorPhase: "install", errorMessage: "install", version: "0.2.0", updateMode: "inApp" });
        expect(actions.relaunch).toHaveBeenCalledTimes(1);
        expect(actions.quit).toHaveBeenCalledTimes(1);
        expect(localEvents.filter((e) => (e.state as { status?: string })?.status === "error")).toHaveLength(1);
      } else if (result === "success") {
        expect(u.getState().status).toBe("installing");
        expect(actions.quit).not.toHaveBeenCalled();
      }
    });
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
