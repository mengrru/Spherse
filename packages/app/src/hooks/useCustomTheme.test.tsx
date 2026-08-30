import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCustomTheme } from "./useCustomTheme";
import { bumpBusResumedAt, connectMockBus, emitBusEvent, stubMockBusSocket, teardownMockBus } from "../test/bus";

beforeEach(() => {
  document.getElementById("custom-theme-link")?.remove();
  stubMockBusSocket();
});

afterEach(() => {
  teardownMockBus();
});

function currentLink(): HTMLLinkElement | null {
  return document.getElementById("custom-theme-link") as HTMLLinkElement | null;
}

describe("useCustomTheme", () => {
  it("mounts a theme stylesheet link for the active project", () => {
    renderHook(() => useCustomTheme("/tmp/p1", "http://localhost:5173", "p1", null));
    const link = currentLink();
    expect(link).not.toBeNull();
    expect(link?.rel).toBe("stylesheet");
    expect(link?.href).toContain("/api/projects/p1/preview/.spherse/theme.css");
  });

  it("no-ops without project context", () => {
    renderHook(() => useCustomTheme(undefined, "http://localhost:5173", "p1", null));
    expect(currentLink()).toBeNull();
  });

  it("replaces the link when fs-watch reports theme.css changed", async () => {
    renderHook(() => useCustomTheme("/tmp/p1", "http://localhost:5173", "p1", null));
    await connectMockBus();
    const firstLink = currentLink();
    expect(firstLink).toBeTruthy();

    emitBusEvent({
      channel: "fs-watch",
      projectId: "p1",
      type: "change",
      payload: { eventType: "change", path: ".spherse/theme.css" },
    });

    const secondLink = currentLink();
    expect(secondLink).toBeTruthy();
    expect(secondLink).not.toBe(firstLink);
    expect(secondLink?.href).toContain("/api/projects/p1/preview/.spherse/theme.css");
  });

  it("ignores fs-watch events for other paths", async () => {
    renderHook(() => useCustomTheme("/tmp/p1", "http://localhost:5173", "p1", null));
    await connectMockBus();
    const firstLink = currentLink();

    emitBusEvent({
      channel: "fs-watch",
      projectId: "p1",
      type: "change",
      payload: { eventType: "change", path: "README.md" },
    });

    expect(currentLink()).toBe(firstLink);
  });

  it("remounts the link after a reconnect (resume compensation)", async () => {
    renderHook(() => useCustomTheme("/tmp/p1", "http://localhost:5173", "p1", null));
    await connectMockBus();
    const firstLink = currentLink();
    expect(firstLink).toBeTruthy();

    bumpBusResumedAt();

    const secondLink = currentLink();
    expect(secondLink).toBeTruthy();
    expect(secondLink).not.toBe(firstLink);
    expect(secondLink?.href).toContain("/api/projects/p1/preview/.spherse/theme.css");
  });
});
