import { describe, expect, it, vi, beforeEach } from "vitest";

const mobileStore: { enabled: boolean; token?: string; mode?: "quick" | "manual"; publicDomain?: string } = {
  enabled: false,
};

let tunnelState = {
  status: "stopped" as "stopped" | "starting" | "running" | "error",
  publicUrl: null as string | null,
  startedAt: null as string | null,
  error: null as string | null,
};
const tunnelListeners = new Set<() => void>();
const tunnelMock = {
  getState: () => ({ ...tunnelState }),
  onStateChange: (fn: () => void) => {
    tunnelListeners.add(fn);
    return () => tunnelListeners.delete(fn);
  },
  start: vi.fn(async () => {
    tunnelState = { status: "running", publicUrl: "https://abc.trycloudflare.com", startedAt: "2026-01-01T00:00:00.000Z", error: null };
    for (const fn of tunnelListeners) fn();
  }),
  stop: vi.fn(async () => {
    tunnelState = { status: "stopped", publicUrl: null, startedAt: null, error: null };
    for (const fn of tunnelListeners) fn();
  }),
  restart: vi.fn(async () => {
    tunnelState = { status: "running", publicUrl: "https://abc.trycloudflare.com", startedAt: "2026-01-01T00:00:00.000Z", error: null };
    for (const fn of tunnelListeners) fn();
  }),
};

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }),
  },
  BrowserWindow: {},
}));

vi.mock("../tunnel/manager.js", () => ({
  getTunnelManager: () => tunnelMock,
}));

vi.mock("../settings.js", () => ({
  getMobileAccess: () => ({ ...mobileStore, mode: mobileStore.mode ?? "quick" }),
  setMobileAccess: (patch: Partial<typeof mobileStore>) => {
    Object.assign(mobileStore, patch);
    return { ...mobileStore, mode: mobileStore.mode ?? "quick" };
  },
  generateAccessToken: () => "generated-token",
}));

const { ensureServer, restartServerWithAuth } = vi.hoisted(() => ({
  ensureServer: vi.fn(async () => undefined),
  restartServerWithAuth: vi.fn(async () => undefined),
}));

vi.mock("../server.js", () => ({
  ensureServer,
  restartServerWithAuth,
  getServerPort: () => 7654,
}));

import { normalizeDomain, buildState, registerMobileAccessIpc } from "./mobile.js";

registerMobileAccessIpc(() => null);

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return Promise.resolve(fn(undefined, ...args));
}

describe("normalizeDomain", () => {
  it("returns empty string for blank input", () => {
    expect(normalizeDomain("")).toBe("");
    expect(normalizeDomain("   ")).toBe("");
    expect(normalizeDomain(undefined)).toBe("");
  });

  it("prepends https:// when scheme missing", () => {
    expect(normalizeDomain("spherse.example.com")).toBe("https://spherse.example.com");
  });

  it("preserves explicit https scheme", () => {
    expect(normalizeDomain("https://spherse.example.com")).toBe("https://spherse.example.com");
  });

  it("preserves explicit http scheme", () => {
    expect(normalizeDomain("http://192.168.1.5:8080")).toBe("http://192.168.1.5:8080");
  });

  it("preserves non-http protocols without double-prepending", () => {
    expect(normalizeDomain("ftp://example.com")).toBe("ftp://example.com");
    expect(normalizeDomain("ws://example.com")).toBe("ws://example.com");
  });

  it("strips trailing slashes", () => {
    expect(normalizeDomain("https://spherse.example.com/")).toBe("https://spherse.example.com");
    expect(normalizeDomain("spherse.example.com///")).toBe("https://spherse.example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDomain("  spherse.example.com  ")).toBe("https://spherse.example.com");
  });
});

describe("buildState", () => {
  beforeEach(() => {
    mobileStore.enabled = false;
    mobileStore.token = undefined;
    mobileStore.mode = "quick";
    mobileStore.publicDomain = undefined;
    tunnelState = { status: "stopped", publicUrl: null, startedAt: null, error: null };
  });

  it("reports quick mode with tunnel manager state", () => {
    mobileStore.enabled = true;
    mobileStore.mode = "quick";
    tunnelState = { status: "running", publicUrl: "https://abc.trycloudflare.com", startedAt: "2026-01-01T00:00:00.000Z", error: null };

    const state = buildState();
    expect(state.mode).toBe("quick");
    expect(state.serverPort).toBe(7654);
    expect(state.tunnel).toEqual({
      status: "running",
      publicUrl: "https://abc.trycloudflare.com",
      startedAt: "2026-01-01T00:00:00.000Z",
      error: null,
    });
    expect(state.manualDomain).toBeNull();
  });

  it("reports manual mode with stopped status and domain as publicUrl", () => {
    mobileStore.enabled = true;
    mobileStore.mode = "manual";
    mobileStore.publicDomain = "spherse.example.com";

    const state = buildState();
    expect(state.mode).toBe("manual");
    expect(state.serverPort).toBe(7654);
    expect(state.manualDomain).toBe("https://spherse.example.com");
    expect(state.tunnel).toEqual({
      status: "stopped",
      publicUrl: "https://spherse.example.com",
      startedAt: null,
      error: null,
    });
  });

  it("manual mode with empty domain yields null publicUrl", () => {
    mobileStore.enabled = true;
    mobileStore.mode = "manual";
    mobileStore.publicDomain = "";

    const state = buildState();
    expect(state.manualDomain).toBeNull();
    expect(state.tunnel.publicUrl).toBeNull();
  });

  it("manual mode always returns publicUrl regardless of enabled", () => {
    mobileStore.enabled = false;
    mobileStore.mode = "manual";
    mobileStore.publicDomain = "https://x.com";

    const state = buildState();
    expect(state.tunnel.status).toBe("stopped");
    expect(state.tunnel.publicUrl).toBe("https://x.com");
  });

  it("defaults mode to quick when unset", () => {
    mobileStore.mode = undefined;
    const state = buildState();
    expect(state.mode).toBe("quick");
  });
});

describe("IPC handlers", () => {
  beforeEach(() => {
    mobileStore.enabled = false;
    mobileStore.token = undefined;
    mobileStore.mode = "quick";
    mobileStore.publicDomain = undefined;
    tunnelState = { status: "stopped", publicUrl: null, startedAt: null, error: null };
    tunnelMock.start.mockClear();
    tunnelMock.stop.mockClear();
    tunnelMock.restart.mockClear();
    ensureServer.mockClear();
    restartServerWithAuth.mockClear();
  });

  it("enable in quick mode starts tunnel manager", async () => {
    const state = await invoke("mobile-access:enable", { mode: "quick" }) as { enabled: boolean; mode: string };
    expect(mobileStore.enabled).toBe(true);
    expect(mobileStore.mode).toBe("quick");
    expect(tunnelMock.start).toHaveBeenCalledWith(7654);
    expect(state.enabled).toBe(true);
    expect(state.mode).toBe("quick");
  });

  it("enable in manual mode does not start tunnel manager and stops it", async () => {
    const state = await invoke("mobile-access:enable", { mode: "manual", publicDomain: "spherse.example.com" }) as { mode: string; manualDomain: string };
    expect(mobileStore.enabled).toBe(true);
    expect(mobileStore.mode).toBe("manual");
    expect(mobileStore.publicDomain).toBe("https://spherse.example.com");
    expect(tunnelMock.start).not.toHaveBeenCalled();
    expect(tunnelMock.stop).toHaveBeenCalled();
    expect(state.manualDomain).toBe("https://spherse.example.com");
  });

  it("disable stops tunnel but does NOT clear auth", async () => {
    mobileStore.enabled = true;
    mobileStore.token = "existing-token";
    mobileStore.mode = "quick";
    await invoke("mobile-access:disable");
    expect(mobileStore.enabled).toBe(false);
    expect(mobileStore.token).toBe("existing-token");
    expect(tunnelMock.stop).toHaveBeenCalled();
    expect(restartServerWithAuth).not.toHaveBeenCalled();
    expect(ensureServer).not.toHaveBeenCalled();
  });

  it("regenerate-token restarts server with new token even when disabled", async () => {
    mobileStore.enabled = false;
    mobileStore.token = "old-token";
    await invoke("mobile-access:regenerate-token");
    expect(mobileStore.token).toBe("generated-token");
    expect(restartServerWithAuth).toHaveBeenCalledWith("generated-token");
    expect(ensureServer).toHaveBeenCalled();
    expect(tunnelMock.restart).not.toHaveBeenCalled();
  });

  it("regenerate-token restarts tunnel in quick mode when enabled", async () => {
    mobileStore.enabled = true;
    mobileStore.token = "old-token";
    mobileStore.mode = "quick";
    await invoke("mobile-access:regenerate-token");
    expect(tunnelMock.restart).toHaveBeenCalledWith(7654);
  });

  it("set-public-domain normalizes and persists the domain", async () => {
    mobileStore.enabled = true;
    mobileStore.mode = "manual";
    const state = await invoke("mobile-access:set-public-domain", "my.domain.com") as { manualDomain: string };
    expect(mobileStore.publicDomain).toBe("https://my.domain.com");
    expect(state.manualDomain).toBe("https://my.domain.com");
  });

  it("set-mode to manual stops tunnel and auto-generates token if none", async () => {
    mobileStore.enabled = true;
    mobileStore.token = undefined;
    mobileStore.mode = "quick";
    await invoke("mobile-access:set-mode", "manual");
    expect(mobileStore.mode).toBe("manual");
    expect(mobileStore.token).toBe("generated-token");
    expect(tunnelMock.stop).toHaveBeenCalled();
    expect(restartServerWithAuth).toHaveBeenCalledWith("generated-token");
  });

  it("set-mode to manual keeps existing token", async () => {
    mobileStore.enabled = true;
    mobileStore.token = "existing-token";
    mobileStore.mode = "quick";
    await invoke("mobile-access:set-mode", "manual");
    expect(mobileStore.token).toBe("existing-token");
    expect(restartServerWithAuth).not.toHaveBeenCalled();
  });

  it("set-mode to quick while enabled starts tunnel", async () => {
    mobileStore.enabled = true;
    mobileStore.mode = "manual";
    await invoke("mobile-access:set-mode", "quick");
    expect(mobileStore.mode).toBe("quick");
    expect(tunnelMock.start).toHaveBeenCalledWith(7654);
  });

  it("restart-tunnel is a no-op in manual mode", async () => {
    mobileStore.enabled = true;
    mobileStore.mode = "manual";
    await invoke("mobile-access:restart-tunnel");
    expect(tunnelMock.restart).not.toHaveBeenCalled();
  });

  it("restart-tunnel restarts in quick mode", async () => {
    mobileStore.enabled = true;
    mobileStore.mode = "quick";
    await invoke("mobile-access:restart-tunnel");
    expect(tunnelMock.restart).toHaveBeenCalledWith(7654);
  });
});
