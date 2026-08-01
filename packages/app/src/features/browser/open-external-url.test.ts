import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isLoopbackUrl, openExternalUrl } from "./open-external-url";
import { useBrowserStore } from "./store";

vi.mock("../../lib/feature-registry", () => ({
  isFeatureEnabled: () => true,
}));

describe("isLoopbackUrl", () => {
  it("matches localhost with and without ports/paths", () => {
    expect(isLoopbackUrl("http://localhost:3000")).toBe(true);
    expect(isLoopbackUrl("http://localhost:3000/dashboard?x=1")).toBe(true);
    expect(isLoopbackUrl("http://localhost")).toBe(true);
    expect(isLoopbackUrl("https://localhost:443/")).toBe(true);
  });

  it("matches 127.0.0.1 and ::1", () => {
    expect(isLoopbackUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:3000")).toBe(true);
  });

  it("rejects private LAN and public hosts", () => {
    expect(isLoopbackUrl("http://192.168.1.10:3000")).toBe(false);
    expect(isLoopbackUrl("http://10.0.0.2:3000")).toBe(false);
    expect(isLoopbackUrl("https://example.com")).toBe(false);
    expect(isLoopbackUrl("https://my.local.test")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isLoopbackUrl("not a url")).toBe(false);
    expect(isLoopbackUrl("")).toBe(false);
    expect(isLoopbackUrl("/relative/path")).toBe(false);
  });
});

describe("openExternalUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { innerWidth: 1920, innerHeight: 1080 });
    vi.stubGlobal("innerWidth", 1920);
    vi.stubGlobal("innerHeight", 1080);
    useBrowserStore.setState({ byProject: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes loopback urls to the in-app browser float", () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    openExternalUrl("http://localhost:3000", {
      projectId: "proj-1",
      hostKind: "electron",
      openExternal,
    });
    expect(useBrowserStore.getState().byProject["proj-1"]?.["http://localhost:3000"]).toBeDefined();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("falls back to openExternal for non-loopback urls", () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    openExternalUrl("https://example.com", {
      projectId: "proj-1",
      hostKind: "electron",
      openExternal,
    });
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
    expect(useBrowserStore.getState().byProject["proj-1"]).toBeUndefined();
  });
});
