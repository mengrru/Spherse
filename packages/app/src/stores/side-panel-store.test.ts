import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSidePanelStore } from "./side-panel-store";

describe("useSidePanelStore", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    storage.clear();
    useSidePanelStore.setState({ pinned: true, hovered: false, mobileOpen: false });
  });

  it("persists the pinned preference in localStorage", () => {
    useSidePanelStore.getState().setPinned(false);

    expect(useSidePanelStore.getState().pinned).toBe(false);
    expect(localStorage.getItem("spherse:side-panel:pinned")).toBe("false");
  });

  it("coordinates hover visibility", () => {
    vi.useFakeTimers();
    useSidePanelStore.getState().setPinned(false);

    useSidePanelStore.getState().show();
    expect(useSidePanelStore.getState().hovered).toBe(true);

    useSidePanelStore.getState().hide();
    vi.advanceTimersByTime(119);
    expect(useSidePanelStore.getState().hovered).toBe(true);

    vi.advanceTimersByTime(1);
    expect(useSidePanelStore.getState().hovered).toBe(false);
    vi.useRealTimers();
  });

  it("does not hide when pinned", () => {
    vi.useFakeTimers();
    useSidePanelStore.getState().setPinned(true);
    useSidePanelStore.getState().show();
    useSidePanelStore.getState().hide();
    vi.advanceTimersByTime(200);
    expect(useSidePanelStore.getState().hovered).toBe(true);
    vi.useRealTimers();
  });

  it("controls mobile open state independently from desktop pinned/hovered", () => {
    useSidePanelStore.getState().setPinned(false);
    useSidePanelStore.getState().show();
    expect(useSidePanelStore.getState().hovered).toBe(true);

    useSidePanelStore.getState().showMobile();
    expect(useSidePanelStore.getState().mobileOpen).toBe(true);
    expect(useSidePanelStore.getState().hovered).toBe(true);

    useSidePanelStore.getState().hideMobile();
    expect(useSidePanelStore.getState().mobileOpen).toBe(false);
    expect(useSidePanelStore.getState().hovered).toBe(true);

    useSidePanelStore.getState().showMobile();
    expect(useSidePanelStore.getState().mobileOpen).toBe(true);
  });
});
