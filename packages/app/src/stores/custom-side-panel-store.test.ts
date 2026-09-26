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

  it("is inactive by default", () => {
    expect(useCustomSidePanelStore.getState().isActive("p1")).toBe(false);
  });

  it("activates per project and persists to localStorage", () => {
    useCustomSidePanelStore.getState().setActive("p1", true);

    expect(useCustomSidePanelStore.getState().isActive("p1")).toBe(true);
    expect(localStorage.getItem("spherse:custom-side-panel:active-by-project")).toBe(
      JSON.stringify({ p1: true }),
    );
  });

  it("keeps projects isolated", () => {
    useCustomSidePanelStore.getState().setActive("p1", true);

    useCustomSidePanelStore.getState().setActive("p2", true);
    expect(useCustomSidePanelStore.getState().isActive("p1")).toBe(true);
    expect(useCustomSidePanelStore.getState().isActive("p2")).toBe(true);

    useCustomSidePanelStore.getState().setActive("p1", false);
    expect(useCustomSidePanelStore.getState().isActive("p1")).toBe(false);
    expect(useCustomSidePanelStore.getState().isActive("p2")).toBe(true);
  });

  it("toggle flips the active state", () => {
    useCustomSidePanelStore.getState().toggle("p1");
    expect(useCustomSidePanelStore.getState().isActive("p1")).toBe(true);

    useCustomSidePanelStore.getState().toggle("p1");
    expect(useCustomSidePanelStore.getState().isActive("p1")).toBe(false);
  });

  it("clearProject removes the entry", () => {
    useCustomSidePanelStore.getState().setActive("p1", true);

    useCustomSidePanelStore.getState().clearProject("p1");
    expect(useCustomSidePanelStore.getState().isActive("p1")).toBe(false);
    expect(localStorage.getItem("spherse:custom-side-panel:active-by-project")).toBe("{}");
  });

  it("reads back persisted state on module init", async () => {
    localStorage.setItem(
      "spherse:custom-side-panel:active-by-project",
      JSON.stringify({ p1: true, bad: "not-a-boolean" }),
    );

    vi.resetModules();
    const reloaded: typeof import("./custom-side-panel-store") = await import(
      "./custom-side-panel-store"
    );
    expect(reloaded.useCustomSidePanelStore.getState().isActive("p1")).toBe(true);
    expect(reloaded.useCustomSidePanelStore.getState().isActive("bad")).toBe(false);
  });

  it("ignores corrupted persisted state", async () => {
    localStorage.setItem("spherse:custom-side-panel:active-by-project", "{broken");

    vi.resetModules();
    const reloaded: typeof import("./custom-side-panel-store") = await import(
      "./custom-side-panel-store"
    );
    expect(reloaded.useCustomSidePanelStore.getState().activeByProject).toEqual({});
  });
});
