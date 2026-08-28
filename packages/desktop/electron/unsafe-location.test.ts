import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

const { appMock } = vi.hoisted(() => ({
  appMock: {
    isPackaged: true,
  },
}));

vi.mock("electron", () => ({
  app: appMock,
}));

import { getUnsafeZoneRoot, isInsideUnsafeZone } from "./unsafe-location.js";

const origPlatform = process.platform;
const origExecPath = process.execPath;

function withProcess<T>(platform: string, execPath: string, fn: () => T): T {
  Object.defineProperty(process, "platform", { value: platform });
  Object.defineProperty(process, "execPath", { value: execPath });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", { value: origPlatform });
    Object.defineProperty(process, "execPath", { value: origExecPath });
  }
}

beforeEach(() => {
  appMock.isPackaged = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getUnsafeZoneRoot", () => {
  it("returns null when not packaged (dev)", () => {
    appMock.isPackaged = false;
    expect(getUnsafeZoneRoot()).toBeNull();
  });

  it("win32: zone is the NSIS install directory (lexical win32 semantics)", () => {
    withProcess("win32", "C:\\Program Files\\Spherse\\Spherse.exe", () => {
      expect(getUnsafeZoneRoot()).toBe(path.win32.dirname("C:\\Program Files\\Spherse\\Spherse.exe"));
    });
  });

  it("darwin: zone is the .app bundle directory", () => {
    withProcess("darwin", "/Applications/Spherse.app/Contents/MacOS/Spherse", () => {
      expect(getUnsafeZoneRoot()).toBe("/Applications/Spherse.app");
    });
  });

  it("darwin: returns null when execPath has no .app ancestor (defensive)", () => {
    withProcess("darwin", "/usr/local/bin/spherse", () => {
      expect(getUnsafeZoneRoot()).toBeNull();
    });
  });

  it("linux: returns null (no product target)", () => {
    withProcess("linux", "/opt/spherse/spherse", () => {
      expect(getUnsafeZoneRoot()).toBeNull();
    });
  });
});

describe("isInsideUnsafeZone (POSIX path semantics)", () => {
  const inside = (p: string, target: string): boolean =>
    withProcess("darwin", p, () => isInsideUnsafeZone(target));

  it("returns false when not packaged", () => {
    appMock.isPackaged = false;
    expect(isInsideUnsafeZone("/Applications/Spherse.app/Contents/proj")).toBe(false);
  });

  it("hits paths inside the bundle", () => {
    expect(inside("/Applications/Spherse.app/Contents/MacOS/Spherse", "/Applications/Spherse.app/Contents/Resources/proj")).toBe(true);
  });

  it("hits the bundle directory itself (boundary)", () => {
    expect(inside("/Applications/Spherse.app/Contents/MacOS/Spherse", "/Applications/Spherse.app")).toBe(true);
  });

  it("misses paths outside the bundle", () => {
    expect(inside("/Applications/Spherse.app/Contents/MacOS/Spherse", "/Users/me/proj")).toBe(false);
  });

  it("misses sibling directories with similar names", () => {
    expect(inside("/Applications/Spherse.app/Contents/MacOS/Spherse", "/Applications/Spherse.app.bak/proj")).toBe(false);
  });

  it("returns false when zone cannot be determined", () => {
    expect(inside("/usr/local/bin/spherse", "/usr/local/bin/proj")).toBe(false);
  });
});
