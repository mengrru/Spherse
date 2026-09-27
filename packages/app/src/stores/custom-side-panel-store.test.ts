import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomSidePanelStore } from "./custom-side-panel-store";

describe("useCustomSidePanelStore", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    storage.clear();
    useCustomSidePanelStore.setState({ activeByProject: {} });
  });

  it("is active by default when no explicit preference is stored", () => {
    expect(useCustomSidePanelStore.getState().isActive("p1")).toBe(true);
    expect(localStorage.getItem("spherse:custom-side-panel:active-by-project")).toBe(null);
  });

  it("stores an explicit opt-out and follows it", () => {
    useCustomSidePanelStore.getState().setActive("p1", false);

    expect(useCustomSidePanelStore.getState().isActive("p1")).toBe(false);
    expect(localStorage.getItem("spherse:custom-side-panel:active-by-project")).toBe(
      JSON.stringify({ p1: false }),
    );
  });

  it("re-activating drops the entry back to the default instead of storing explicit true", () => {
    useCustomSidePanelStore.getState().setActive("p1", false);
    useCustomSidePanelStore.getState().setActive("p1", true);

    expect(useCustomSidePanelStore.getState().isActive("p1")).toBe(true);
    expect(localStorage.getItem("spherse:custom-side-panel:active-by-project")).toBe("{}");
  });

  it("keeps projects isolated", () => {
    useCustomSidePanelStore.getState().setActive("p1", false);

    expect(useCustomSidePanelStore.getState().isActive("p1")).toBe(false);
    expect(useCustomSidePanelStore.getState().isActive("p2")).toBe(true);
  });

  it("toggle flips between default-active and explicit opt-out", () => {
    useCustomSidePanelStore.getState().toggle("p1");
    expect(useCustomSidePanelStore.getState().isActive("p1")).toBe(false);

    useCustomSidePanelStore.getState().toggle("p1");
    expect(useCustomSidePanelStore.getState().isActive("p1")).toBe(true);
    expect(useCustomSidePanelStore.getState().activeByProject.p1).toBeUndefined();
  });

  it("clearProject removes the entry", () => {
    useCustomSidePanelStore.getState().setActive("p1", false);

    useCustomSidePanelStore.getState().clearProject("p1");
    expect(useCustomSidePanelStore.getState().activeByProject.p1).toBeUndefined();
    expect(localStorage.getItem("spherse:custom-side-panel:active-by-project")).toBe("{}");
  });

  it("reads back persisted state on module init", async () => {
    localStorage.setItem(
      "spherse:custom-side-panel:active-by-project",
      JSON.stringify({ p1: false, bad: "not-a-boolean" }),
    );

    vi.resetModules();
    const reloaded: typeof import("./custom-side-panel-store") = await import(
      "./custom-side-panel-store"
    );
    expect(reloaded.useCustomSidePanelStore.getState().isActive("p1")).toBe(false);
    expect(reloaded.useCustomSidePanelStore.getState().isActive("bad")).toBe(true);
  });

  it("ignores corrupted persisted state", async () => {
    localStorage.setItem("spherse:custom-side-panel:active-by-project", "{broken");

    vi.resetModules();
    const reloaded: typeof import("./custom-side-panel-store") = await import(
      "./custom-side-panel-store"
    );
    expect(reloaded.useCustomSidePanelStore.getState().activeByProject).toEqual({});
    expect(reloaded.useCustomSidePanelStore.getState().isActive("p1")).toBe(true);
  });
});
