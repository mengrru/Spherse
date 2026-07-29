import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFloatingContentBrowserStore } from "./store";

const { FLOAT_DEFAULT_WIDTH, FLOAT_DEFAULT_HEIGHT, CASCADE_STEP } = await import("./defaults");

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    get length() {
      return store.size;
    },
  };
}

describe("useFloatingContentBrowserStore", () => {
  let originalLocalStorage: typeof globalThis.localStorage;

  beforeEach(() => {
    originalLocalStorage = globalThis.localStorage;
    vi.stubGlobal("localStorage", createLocalStorageMock());
    vi.stubGlobal("window", { innerWidth: 1920, innerHeight: 1080 });
    vi.stubGlobal("innerWidth", 1920);
    vi.stubGlobal("innerHeight", 1080);
    useFloatingContentBrowserStore.setState({ byProject: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalLocalStorage !== undefined) {
      globalThis.localStorage = originalLocalStorage;
    }
  });

  it("opens a float for a file and records it", () => {
    useFloatingContentBrowserStore.getState().openFloat("project-1", "notes.md");

    const win = useFloatingContentBrowserStore.getState().byProject["project-1"]?.["notes.md"];
    expect(win).toBeDefined();
    expect(win?.filePath).toBe("notes.md");
    expect(win?.size).toEqual({ width: FLOAT_DEFAULT_WIDTH, height: FLOAT_DEFAULT_HEIGHT });
  });

  it("is a no-op when opening a file that is already floated", () => {
    useFloatingContentBrowserStore.getState().openFloat("project-1", "notes.md");
    const first = useFloatingContentBrowserStore.getState().byProject["project-1"]["notes.md"];

    useFloatingContentBrowserStore.getState().openFloat("project-1", "notes.md");
    const second = useFloatingContentBrowserStore.getState().byProject["project-1"]["notes.md"];

    expect(second).toBe(first);
  });

  it("cascade-offsets successive windows", () => {
    useFloatingContentBrowserStore.getState().openFloat("project-1", "a.md");
    useFloatingContentBrowserStore.getState().openFloat("project-1", "b.md");

    const a = useFloatingContentBrowserStore.getState().byProject["project-1"]["a.md"];
    const b = useFloatingContentBrowserStore.getState().byProject["project-1"]["b.md"];

    const expectedOffset = CASCADE_STEP;
    expect(a.position.x - b.position.x).toBe(expectedOffset);
    expect(a.position.y - b.position.y).toBe(expectedOffset);
  });

  it("closes a specific file's float", () => {
    useFloatingContentBrowserStore.getState().openFloat("project-1", "a.md");
    useFloatingContentBrowserStore.getState().openFloat("project-1", "b.md");

    useFloatingContentBrowserStore.getState().closeFloat("project-1", "a.md");

    const project = useFloatingContentBrowserStore.getState().byProject["project-1"];
    expect(project?.["a.md"]).toBeUndefined();
    expect(project?.["b.md"]).toBeDefined();
  });

  it("removes the project entry when its last window closes", () => {
    useFloatingContentBrowserStore.getState().openFloat("project-1", "a.md");
    useFloatingContentBrowserStore.getState().closeFloat("project-1", "a.md");

    expect(useFloatingContentBrowserStore.getState().byProject["project-1"]).toBeUndefined();
  });

  it("updates position and size independently", () => {
    useFloatingContentBrowserStore.getState().openFloat("project-1", "a.md");
    useFloatingContentBrowserStore.getState().setPosition("project-1", "a.md", { x: 10, y: 20 });

    let win = useFloatingContentBrowserStore.getState().byProject["project-1"]["a.md"];
    expect(win?.position).toEqual({ x: 10, y: 20 });

    useFloatingContentBrowserStore.getState().setSize("project-1", "a.md", { width: 500, height: 700 }, { x: 1, y: 2 });
    win = useFloatingContentBrowserStore.getState().byProject["project-1"]["a.md"];
    expect(win?.size).toEqual({ width: 500, height: 700 });
    expect(win?.position).toEqual({ x: 1, y: 2 });
  });

  it("clears one project while keeping others", () => {
    useFloatingContentBrowserStore.getState().openFloat("project-1", "a.md");
    useFloatingContentBrowserStore.getState().openFloat("project-2", "b.md");
    useFloatingContentBrowserStore.getState().clearProject("project-1");

    expect(useFloatingContentBrowserStore.getState().byProject["project-1"]).toBeUndefined();
    expect(useFloatingContentBrowserStore.getState().byProject["project-2"]).toBeDefined();
  });

  it("persists state to localStorage", () => {
    useFloatingContentBrowserStore.getState().openFloat("project-1", "notes.md");
    const raw = globalThis.localStorage.getItem("spherse:floating-content-browser");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)["project-1"]["notes.md"]).toBeDefined();
  });

  it("does not throw when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {
        throw new Error("unavailable");
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    });
    useFloatingContentBrowserStore.setState({ byProject: {} });

    expect(() => useFloatingContentBrowserStore.getState().openFloat("project-1", "x.md")).not.toThrow();
    expect(useFloatingContentBrowserStore.getState().byProject["project-1"]?.["x.md"]).toBeDefined();
  });
});
