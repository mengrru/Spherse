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

function stubWinArch(architecture: string | undefined) {
  Object.defineProperty(window.navigator, "userAgentData", {
    value:
      architecture === undefined
        ? undefined
        : { getHighEntropyValues: async () => ({ architecture }) },
    configurable: true,
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
    stubWinArch(undefined);
    const { resolveDownloadUrl } = await loadReleaseModule();
    await expect(resolveDownloadUrl("win")).resolves.toBe("https://m/win-x64.exe");
  });
});

describe("resolveDownloadUrl (fallbacks)", () => {
  it("returns the GitHub releases fallback when the manifest fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
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
