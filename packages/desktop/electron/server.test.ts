import { beforeEach, describe, expect, it, vi } from "vitest";

const mobileStore: { enabled: boolean; mode?: "quick" | "manual"; publicDomain?: string; token?: string } = {
  enabled: false,
};

let tunnelState = {
  status: "stopped" as "stopped" | "starting" | "running" | "error",
  publicUrl: null as string | null,
  startedAt: null as string | null,
  error: null as string | null,
};

const addedHosts: string[] = [];
const removedHosts: string[] = [];
let currentHosts = new Set<string>();

vi.mock("electron", () => ({
  app: { getVersion: () => "0.0.0-test" },
}));

vi.mock("@spherse/server", () => ({
  createMultiProjectServer: vi.fn(async () => {
    addedHosts.length = 0;
    removedHosts.length = 0;
    currentHosts = new Set<string>();
    return {
      fastify: { server: { address: () => ({ port: 1 }) }, close: async () => undefined },
      registry: { register: async () => ({}), listInfo: () => [], removeAll: async () => undefined },
      logger: { info: () => undefined, warn: () => undefined },
      addAllowedHosts: (hosts: string[]) => {
        addedHosts.push(...hosts);
        for (const host of hosts) currentHosts.add(host);
      },
      removeAllowedHosts: (hosts: string[]) => {
        removedHosts.push(...hosts);
        for (const host of hosts) currentHosts.delete(host);
      },
    };
  }),
}));

vi.mock("./settings.js", () => ({
  getSettings: () => undefined,
  getServerToken: () => "server-token",
  getMobileAccess: () => ({ ...mobileStore, mode: mobileStore.mode ?? "quick" }),
}));

vi.mock("./model-catalog.js", () => ({
  getAppModelCatalog: () => ({}),
}));

vi.mock("./tunnel/manager.js", () => ({
  getTunnelManager: () => ({ getState: () => ({ ...tunnelState }) }),
}));

import { ensureServer, restartServer, syncAllowedHosts, getServerPort } from "./server.js";

function currentDynamicHosts(): string[] {
  return [...currentHosts];
}

describe("syncAllowedHosts", () => {
  beforeEach(async () => {
    mobileStore.enabled = false;
    mobileStore.mode = "quick";
    mobileStore.publicDomain = undefined;
    mobileStore.token = undefined;
    tunnelState = { status: "stopped", publicUrl: null, startedAt: null, error: null };
    await restartServer();
    await ensureServer();
    addedHosts.length = 0;
    removedHosts.length = 0;
  });

  it("registers nothing when mobile access is disabled", () => {
    tunnelState = { status: "running", publicUrl: "https://abc.trycloudflare.com", startedAt: null, error: null };
    mobileStore.enabled = false;
    mobileStore.mode = "quick";
    syncAllowedHosts();
    expect(addedHosts).toEqual([]);
    expect(removedHosts).toEqual([]);
  });

  it("registers tunnel publicUrl in quick mode when enabled", () => {
    tunnelState = { status: "running", publicUrl: "https://abc.trycloudflare.com", startedAt: null, error: null };
    mobileStore.enabled = true;
    mobileStore.mode = "quick";
    syncAllowedHosts();
    expect(addedHosts).toEqual(["https://abc.trycloudflare.com"]);
  });

  it("registers publicDomain in manual mode when enabled", () => {
    mobileStore.enabled = true;
    mobileStore.mode = "manual";
    mobileStore.publicDomain = "https://spherse.example.com";
    syncAllowedHosts();
    expect(addedHosts).toEqual(["https://spherse.example.com"]);
  });

  it("replaces previous hosts when tunnel url changes", () => {
    tunnelState = { status: "running", publicUrl: "https://old.trycloudflare.com", startedAt: null, error: null };
    mobileStore.enabled = true;
    mobileStore.mode = "quick";
    syncAllowedHosts();
    tunnelState = { status: "running", publicUrl: "https://new.trycloudflare.com", startedAt: null, error: null };
    syncAllowedHosts();
    expect(removedHosts).toEqual(["https://old.trycloudflare.com"]);
    expect(currentDynamicHosts()).toEqual(["https://new.trycloudflare.com"]);
  });

  it("removes hosts when disabled", () => {
    tunnelState = { status: "running", publicUrl: "https://abc.trycloudflare.com", startedAt: null, error: null };
    mobileStore.enabled = true;
    mobileStore.mode = "quick";
    syncAllowedHosts();
    mobileStore.enabled = false;
    syncAllowedHosts();
    expect(currentDynamicHosts()).toEqual([]);
  });

  it("replays desired hosts on a fresh server instance after restart (manual regenerate path)", async () => {
    mobileStore.enabled = true;
    mobileStore.mode = "manual";
    mobileStore.publicDomain = "https://spherse.example.com";
    await restartServer();
    await ensureServer();
    expect(currentDynamicHosts()).toEqual(["https://spherse.example.com"]);

    await restartServer();
    await ensureServer();
    expect(currentDynamicHosts()).toEqual(["https://spherse.example.com"]);
    expect(getServerPort()).toBe(1);
  });
});
