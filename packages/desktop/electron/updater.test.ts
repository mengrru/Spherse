import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const { appMock, events, autoUpdaterMock, autoUpdaterListeners, powerMonitorMock } = vi.hoisted(() => {
  const appMock = {
    isPackaged: false,
    getVersion: () => "0.1.0",
  };
  const events: Array<Record<string, unknown>> = [];
  const autoUpdaterListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const autoUpdaterMock = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    channel: null as string | null,
    allowDowngrade: false,
    on: vi.fn((name: string, handler: (...args: unknown[]) => void) => {
      const list = autoUpdaterListeners.get(name) ?? [];
      list.push(handler);
      autoUpdaterListeners.set(name, list);
    }),
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  };
  const powerMonitorMock = {
    getSystemIdleTime: vi.fn<() => number>(() => 0),
  };
  return { appMock, events, autoUpdaterMock, autoUpdaterListeners, powerMonitorMock };
});

vi.mock("electron", () => ({
  app: appMock,
  powerMonitor: powerMonitorMock,
}));
vi.mock("electron-updater", () => ({
  default: {
    autoUpdater: autoUpdaterMock,
    CancellationToken: class {
      cancel = vi.fn();
    },
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
  deriveFeedBaseUrl,
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
  autoUpdaterMock.setFeedURL.mockReset();
  autoUpdaterMock.channel = null;
  autoUpdaterMock.allowDowngrade = false;
  autoUpdaterListeners.clear();
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

/** 模拟 electron-updater 内部事件（绕过被测的转发裁剪逻辑直接触发监听器） */
function emitAutoUpdater(name: string, ...args: unknown[]): void {
  for (const handler of autoUpdaterListeners.get(name) ?? []) {
    handler(...args);
  }
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

/** 将主进程状态驱动到 downloading（走完真实 downloadUpdate 链路） */
async function driveToDownloading(u: Updater): Promise<void> {
  mockManifestResponse(manifest);
  autoUpdaterMock.checkForUpdates.mockResolvedValue({
    isUpdateAvailable: true,
    updateInfo: { version: "0.2.0" },
  });
  autoUpdaterMock.downloadUpdate.mockResolvedValue([]);
  await u.downloadUpdate();
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

describe("deriveFeedBaseUrl", () => {
  it("strips the installer filename and keeps the versioned directory", () => {
    expect(
      deriveFeedBaseUrl("https://oss/spherse/releases/0.2.0/Spherse-Setup-0.2.0-x64.exe"),
    ).toBe("https://oss/spherse/releases/0.2.0/");
  });

  it("drops query and hash from the download url", () => {
    expect(
      deriveFeedBaseUrl("https://oss/spherse/releases/0.2.0/x.exe?x=1#frag"),
    ).toBe("https://oss/spherse/releases/0.2.0/");
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

  it("darwin: newer manifest version emits update-available with OSS downloadUrl and inAppUpdate=false", async () => {
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
        inAppUpdate: false,
      },
    ]);
    expect(updater.getState()).toEqual({
      status: "available",
      version: "0.2.0",
      releaseNotes: "",
      downloadUrl: manifest.mac?.arm64,
      inAppUpdate: false,
    });
  });

  it("win32 x64: emits update-available with x64 installer URL and inAppUpdate=true", async () => {
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
        inAppUpdate: true,
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

  it("non-200 manifest response emits update-error (check phase)", async () => {
    mockManifestResponse(null, false, 503);
    await updater.checkForUpdates({ silent: false });
    expect(events).toEqual([
      { type: "update-error", message: "OSS manifest responded 503", phase: "check" },
    ]);
    expect(updater.getState()).toEqual({
      status: "error",
      errorMessage: "OSS manifest responded 503",
      errorPhase: "check",
    });
  });

  it("invalid JSON emits update-error (check phase)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("Unexpected token <")),
    });
    await updater.checkForUpdates({ silent: false });
    expect(events).toEqual([
      { type: "update-error", message: "Unexpected token <", phase: "check" },
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
        inAppUpdate: false,
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

  it("silent check suppresses update-available while downloading or downloaded", async () => {
    await withProcess("win32", "x64", async () => {
      const { u, localEvents } = createTestUpdater();
      await driveToDownloading(u);
      emitAutoUpdater("download-progress", { percent: 42.3 });
      expect(u.getState().status).toBe("downloading");
      localEvents.length = 0;

      mockManifestResponse(manifest);
      await u.checkForUpdates({ silent: true });
      expect(localEvents).toEqual([]);
      expect(u.getState().status).toBe("downloading");

      emitAutoUpdater("update-downloaded");
      expect(u.getState().status).toBe("downloaded");
      localEvents.length = 0;

      mockManifestResponse(manifest);
      await u.checkForUpdates({ silent: true });
      expect(localEvents).toEqual([]);
      expect(u.getState().status).toBe("downloaded");
    });
  });

  it("OSS check never touches electron-updater (regression guard)", async () => {
    mockManifestResponse(manifest);
    await updater.checkForUpdates({ silent: false });
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled();
  });
});

describe("manual external update changelog", () => {
  const changelogUrl = "https://mengru-open-source.oss-cn-beijing.aliyuncs.com/spherse/changelog.json";

  it.each(["darwin", "linux", "win32"] as const)("%s manual check selects only the exact target version and keeps download metadata", async (platform) => {
    await withProcess(platform, platform === "darwin" ? "arm64" : "x64", async () => {
      const { u, localEvents } = createTestUpdater();
      mockManifestResponse(manifest);
      mockManifestResponse({ releases: [
        { version: "0.3.0", notes: [{ text: "Wrong release" }] },
        { version: " v0.2.0 ", notes: [{ type: "feat", text: "New feature" }, { type: null, text: "  Fixed\n issue  " }] },
      ] });
      await u.checkForUpdates({ silent: false });
      const releaseNotes = "- New feature\n- Fixed issue";
      const expectedUrl =
        platform === "darwin" ? manifest.mac?.arm64
          : platform === "linux" ? manifest.linux?.x64
            : manifest.win?.x64;
      expect(u.getState()).toMatchObject({ status: "available", version: "0.2.0", releaseNotes,
        downloadUrl: expectedUrl });
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

  it.each(["silent", "current"])("does not fetch changelog for %s checks", async (mode) => {
    await withProcess("darwin", "x64", async () => {
      const { u } = createTestUpdater();
      mockManifestResponse({ ...manifest, version: mode === "current" ? "0.1.0" : "0.2.0" });
      await u.checkForUpdates({ silent: mode === "silent" });
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
      expect(u.getState()).toEqual({ status: "upToDate" });
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

describe("updater.downloadUpdate (Windows in-app)", () => {
  it("darwin/linux still no-op (browser-download flow unchanged)", async () => {
    const { u } = createTestUpdater();
    for (const platform of ["darwin", "linux"] as const) {
      await withProcess(platform, "x64", async () => {
        mockManifestResponse(manifest);
        await u.downloadUpdate();
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled();
    expect(u.getState()).toEqual({ status: "idle" });
  });

  it("dev mode no-op (avoid dev-app-update.yml resolution errors)", async () => {
    appMock.isPackaged = false;
    const { u } = createTestUpdater();
    await withProcess("win32", "x64", async () => {
      await u.downloadUpdate();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled();
  });

  it("x64: derives generic feed base from manifest URL and downloads", async () => {
    await withProcess("win32", "x64", async () => {
      const { u, localEvents } = createTestUpdater();
      await driveToDownloading(u);
      expect(fetchMock).toHaveBeenCalledWith(MANIFEST_URL);
      expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith({
        provider: "generic",
        url: "https://oss/spherse/releases/0.2.0/",
      });
      expect(autoUpdaterMock.channel).toBeNull();
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
      expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1);
      expect(u.getState()).toEqual({
        status: "downloading",
        version: "0.2.0",
        downloadUrl: manifest.win?.x64,
        inAppUpdate: true,
      });
      expect(localEvents).toEqual([]);
    });
  });

  it("arm64: switches channel to latest-arm64 and resets allowDowngrade", async () => {
    await withProcess("win32", "arm64", async () => {
      const { u } = createTestUpdater();
      await driveToDownloading(u);
      expect(autoUpdaterMock.channel).toBe("latest-arm64");
      expect(autoUpdaterMock.allowDowngrade).toBe(false);
      expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith({
        provider: "generic",
        url: "https://oss/spherse/releases/0.2.0/",
      });
      expect(u.getState()).toMatchObject({
        status: "downloading",
        downloadUrl: manifest.win?.arm64,
        inAppUpdate: true,
      });
    });
  });

  it("arm64 without win.arm64 key falls back to x64 URL for the feed base", async () => {
    await withProcess("win32", "arm64", async () => {
      const { u } = createTestUpdater();
      mockManifestResponse({ ...manifest, win: { x64: manifest.win?.x64 } });
      autoUpdaterMock.checkForUpdates.mockResolvedValue({
        isUpdateAvailable: true,
        updateInfo: { version: "0.2.0" },
      });
      autoUpdaterMock.downloadUpdate.mockResolvedValue([]);
      await u.downloadUpdate();
      expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith({
        provider: "generic",
        url: "https://oss/spherse/releases/0.2.0/",
      });
    });
  });

  it("reports a readable download error when manifest fetch fails", async () => {
    await withProcess("win32", "x64", async () => {
      const { u, localEvents } = createTestUpdater();
      mockManifestResponse(null, false, 500);
      await u.downloadUpdate();
      expect(u.getState()).toEqual({
        status: "error",
        errorMessage: "OSS manifest responded 500",
        errorPhase: "download",
      });
      expect(localEvents).toEqual([
        { type: "update-error", message: "OSS manifest responded 500", phase: "download" },
      ]);
      expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
    });
  });

  it("reports a download error when manifest no longer offers a newer version", async () => {
    await withProcess("win32", "x64", async () => {
      const { u } = createTestUpdater();
      mockManifestResponse({ ...manifest, version: "0.1.0" });
      await u.downloadUpdate();
      expect(u.getState()).toMatchObject({
        status: "error",
        errorPhase: "download",
        errorMessage: expect.stringContaining("no newer update"),
      });
      expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled();
    });
  });

  it("reports a download error when the feed has no newer version", async () => {
    await withProcess("win32", "x64", async () => {
      const { u } = createTestUpdater();
      mockManifestResponse(manifest);
      autoUpdaterMock.checkForUpdates.mockResolvedValue({
        isUpdateAvailable: false,
        updateInfo: { version: "0.1.0" },
      });
      await u.downloadUpdate();
      expect(u.getState()).toMatchObject({
        status: "error",
        errorPhase: "download",
        errorMessage: expect.stringContaining("no newer version"),
      });
      expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
    });
  });

  it("reports a download error on feed/manifest version mismatch (partial upload guard)", async () => {
    await withProcess("win32", "x64", async () => {
      const { u } = createTestUpdater();
      mockManifestResponse(manifest);
      autoUpdaterMock.checkForUpdates.mockResolvedValue({
        isUpdateAvailable: true,
        updateInfo: { version: "0.1.9" },
      });
      await u.downloadUpdate();
      expect(u.getState()).toMatchObject({
        status: "error",
        errorPhase: "download",
        errorMessage: expect.stringContaining("does not match"),
      });
      expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
    });
  });

  it("swallows library errors from checkForUpdates (already dispatched as error events)", async () => {
    await withProcess("win32", "x64", async () => {
      const { u, localEvents } = createTestUpdater();
      mockManifestResponse(manifest);
      autoUpdaterMock.checkForUpdates.mockRejectedValue(
        new Error("ERR_UPDATER_CHANNEL_FILE_NOT_FOUND"),
      );
      await u.downloadUpdate();
      expect(u.getState()).toEqual({ status: "idle" });
      expect(localEvents).toEqual([]);
    });
  });

  it("no-ops when already downloading or downloaded", async () => {
    await withProcess("win32", "x64", async () => {
      const { u } = createTestUpdater();
      await driveToDownloading(u);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await u.downloadUpdate();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      emitAutoUpdater("update-downloaded");
      await u.downloadUpdate();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(u.getState().status).toBe("downloaded");
    });
  });
});

describe("electron-updater event forwarding", () => {
  it("does not forward update-available from the internal feed check", async () => {
    const { u, localEvents } = createTestUpdater();
    emitAutoUpdater("update-available", { version: "9.9.9", releaseNotes: "" });
    expect(localEvents).toEqual([]);
    expect(u.getState()).toEqual({ status: "idle" });
  });

  it("does not forward update-not-available from the internal feed check", async () => {
    const { u, localEvents } = createTestUpdater();
    emitAutoUpdater("update-not-available", { version: "0.1.0" });
    expect(localEvents).toEqual([]);
    expect(u.getState()).toEqual({ status: "idle" });
  });

  it("forwards download-progress and rounds percent", async () => {
    const { u, localEvents } = createTestUpdater();
    emitAutoUpdater("download-progress", { percent: 42.6 });
    expect(u.getState()).toEqual({ status: "downloading", percent: 43 });
    expect(localEvents).toEqual([{ type: "download-progress", percent: 43 }]);
  });

  it("forwards update-downloaded preserving version metadata", async () => {
    await withProcess("win32", "x64", async () => {
      const { u, localEvents } = createTestUpdater();
      mockManifestResponse(manifest);
      mockManifestResponse({ releases: [{ version: "0.2.0", notes: [{ text: "Note" }] }] });
      await u.checkForUpdates({ silent: false });
      await driveToDownloading(u);
      emitAutoUpdater("download-progress", { percent: 10 });
      emitAutoUpdater("update-downloaded");
      expect(u.getState()).toEqual({
        status: "downloaded",
        version: "0.2.0",
        releaseNotes: "- Note",
        downloadUrl: manifest.win?.x64,
        inAppUpdate: true,
      });
      expect(localEvents).toContainEqual({ type: "update-downloaded" });
    });
  });

  it("forwards error events as download-phase errors", async () => {
    const { u, localEvents } = createTestUpdater();
    emitAutoUpdater("error", new Error("sha512 checksum mismatch"));
    expect(u.getState()).toEqual({
      status: "error",
      errorMessage: "sha512 checksum mismatch",
      errorPhase: "download",
    });
    expect(localEvents).toEqual([
      { type: "update-error", message: "sha512 checksum mismatch", phase: "download" },
    ]);
  });
});

describe("updater.installUpdate / cancelUpdate (Windows in-app)", () => {
  it("installUpdate no-ops unless state is downloaded", async () => {
    await withProcess("win32", "x64", async () => {
      const { u } = createTestUpdater();
      await u.installUpdate();
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();

      emitAutoUpdater("update-downloaded");
      await u.installUpdate();
      expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledWith(true, true);
    });
  });

  it("installUpdate no-ops on non-win32 platforms", async () => {
    await withProcess("darwin", "arm64", async () => {
      const { u } = createTestUpdater();
      emitAutoUpdater("update-downloaded");
      await u.installUpdate();
    });
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
  });

  it("cancelUpdate cancels the active token and returns to available with metadata", async () => {
    await withProcess("win32", "x64", async () => {
      const { u } = createTestUpdater();
      await driveToDownloading(u);
      emitAutoUpdater("download-progress", { percent: 50 });
      const token = autoUpdaterMock.downloadUpdate.mock.calls[0][0] as { cancel: () => void };

      await u.cancelUpdate();
      expect(token.cancel).toHaveBeenCalled();
      expect(u.getState()).toEqual({
        status: "available",
        version: "0.2.0",
        downloadUrl: manifest.win?.x64,
        inAppUpdate: true,
      });
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
