import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLastRoute, setLastRoute, clearLastRoute } from "./last-route";

describe("last-route", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    storage.clear();
  });

  it("returns null when no route is stored", () => {
    expect(getLastRoute("project-a")).toBeNull();
  });

  it("sets and reads a route per project", () => {
    setLastRoute("project-a", "/chat/session-1");

    expect(getLastRoute("project-a")).toBe("/chat/session-1");
  });

  it("keeps routes isolated per project", () => {
    setLastRoute("project-a", "/chat/session-1");
    setLastRoute("project-b", "/content?path=foo.md");

    expect(getLastRoute("project-a")).toBe("/chat/session-1");
    expect(getLastRoute("project-b")).toBe("/content?path=foo.md");
  });

  it("clears one project while keeping others", () => {
    setLastRoute("project-a", "/chat/session-1");
    setLastRoute("project-b", "/content?path=foo.md");

    clearLastRoute("project-a");

    expect(getLastRoute("project-a")).toBeNull();
    expect(getLastRoute("project-b")).toBe("/content?path=foo.md");
  });
});
