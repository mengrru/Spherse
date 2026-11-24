import { describe, expect, it, afterEach, vi } from "vitest";
import type { RpcTransport } from "@spherse/rpc";
import {
  resolveResourcePath,
  setLocalRuntimeTransportFactory,
} from "./shared";

const fakeTransport = {} as RpcTransport;

describe("resolveResourcePath", () => {
  afterEach(() => {
    setLocalRuntimeTransportFactory(null);
    vi.unstubAllEnvs();
  });

  it("joins subpath base without double slashes", () => {
    setLocalRuntimeTransportFactory(() => fakeTransport);
    vi.stubEnv("BASE_URL", "/dev/browser/");
    expect(resolveResourcePath(window.location.origin, "/api/projects/p1/preview/a.css")).toBe(
      "/dev/browser/api/projects/p1/preview/a.css",
    );
  });

  it("keeps root base paths untouched", () => {
    setLocalRuntimeTransportFactory(() => fakeTransport);
    vi.stubEnv("BASE_URL", "/");
    expect(resolveResourcePath(window.location.origin, "/api/x")).toBe("/api/x");
  });

  it("passes through remote base urls", () => {
    expect(resolveResourcePath("http://localhost:53972", "/api/x")).toBe("http://localhost:53972/api/x");
  });
});
