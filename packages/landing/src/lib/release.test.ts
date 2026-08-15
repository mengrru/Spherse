import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MANIFEST_URL = "https://mirror.example.com/spherse/latest.json";
const FALLBACK_URL = "https://github.com/mengrru/Spherse/releases/latest";

const fullManifest = {
  version: "1.2.3",
  mac: { arm64: "https://m/mac-arm64.dmg", intel: "https://m/mac-intel.dmg" },
  win: { setup: "https://m/win-x64.exe", arm64: "https://m/win-arm64.exe" },
};

function stubManifest(manifest: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => manifest })),
  );
}

function stubManifestHttpError() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
  );
}

function stubManifestNetworkError() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
}

let originalUserAgentData: PropertyDescriptor | undefined;

function stubUserAgentData(value: unknown) {
  originalUserAgentData = Object.getOwnPropertyDescriptor(
    window.navigator,
    "userAgentData",
  );
  Object.defineProperty(window.navigator, "userAgentData", {
    value,
    configurable: true,
  });
}

function stubWinArch(architecture: string) {
  stubUserAgentData({
    getHighEntropyValues: async () => ({ architecture }),
  });
}

function stubWinArchProbeFailure() {
  stubUserAgentData({
    getHighEntropyValues: async () => {
      throw new Error("insecure context");
    },
  });
}

async function loadReleaseModule() {
  vi.stubEnv("VITE_OSS_MANIFEST_URL", MANIFEST_URL);
  return import("./release");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (originalUserAgentData) {
    Object.defineProperty(
      window.navigator,
      "userAgentData",
      originalUserAgentData,
    );
  } else {
    Reflect.deleteProperty(window.navigator, "userAgentData");
  }
  originalUserAgentData = undefined;
});

describe("resolveDownloadUrl (windows arch selection)", () => {
  it("returns win.arm64 url for ARM64 devices when manifest provides it", async () => {
    stubManifest(fullManifest);
    stubWinArch("arm");
    const { resolveDownloadUrl } = await loadReleaseModule();
    await expect(resolveDownloadUrl("win")).resolves.toBe("https://m/win-arm64.exe");
  });

  it("falls back to win.setup on ARM64 devices when manifest lacks arm64 (legacy manifest)", async () => {
    stubManifest({ ...fullManifest, win: { setup: "https://m/win-x64.exe" } });
    stubWinArch("arm");
    const { resolveDownloadUrl } = await loadReleaseModule();
    await expect(resolveDownloadUrl("win")).resolves.toBe("https://m/win-x64.exe");
  });

  it("returns win.setup for x64 devices even when manifest has arm64", async () => {
    stubManifest(fullManifest);
    stubWinArch("x86");
    const { resolveDownloadUrl } = await loadReleaseModule();
    await expect(resolveDownloadUrl("win")).resolves.toBe("https://m/win-x64.exe");
  });

  it("defaults to win.setup when userAgentData is unavailable (non-Chromium browsers)", async () => {
    stubManifest(fullManifest);
    stubUserAgentData(undefined);
    const { resolveDownloadUrl } = await loadReleaseModule();
    await expect(resolveDownloadUrl("win")).resolves.toBe("https://m/win-x64.exe");
  });

  it("defaults to win.setup when the architecture probe rejects", async () => {
    stubManifest(fullManifest);
    stubWinArchProbeFailure();
    const { resolveDownloadUrl } = await loadReleaseModule();
    await expect(resolveDownloadUrl("win")).resolves.toBe("https://m/win-x64.exe");
  });

  it("falls back to the GitHub releases page when manifest win object has no usable url", async () => {
    stubManifest({ ...fullManifest, win: {} });
    stubWinArch("arm");
    const { resolveDownloadUrl } = await loadReleaseModule();
    await expect(resolveDownloadUrl("win")).resolves.toBe(FALLBACK_URL);
  });
});

describe("resolveDownloadUrl (fallbacks)", () => {
  it("returns the GitHub releases fallback when the manifest fetch fails", async () => {
    stubManifestHttpError();
    stubWinArch("x86");
    const { resolveDownloadUrl } = await loadReleaseModule();
    await expect(resolveDownloadUrl("win")).resolves.toBe(FALLBACK_URL);
  });

  it("returns the GitHub releases fallback when the fetch rejects (network error)", async () => {
    stubManifestNetworkError();
    stubWinArch("x86");
    const { resolveDownloadUrl } = await loadReleaseModule();
    await expect(resolveDownloadUrl("win")).resolves.toBe(FALLBACK_URL);
  });

  it("resolves mac downloads to the arm64 dmg when WebGL detection is unavailable", async () => {
    stubManifest(fullManifest);
    const { resolveDownloadUrl } = await loadReleaseModule();
    await expect(resolveDownloadUrl("mac")).resolves.toBe("https://m/mac-arm64.dmg");
  });
});
