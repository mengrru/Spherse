import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserStore } from "./store";

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

describe("useBrowserStore", () => {
  let originalLocalStorage: typeof globalThis.localStorage;

  beforeEach(() => {
    originalLocalStorage = globalThis.localStorage;
    vi.stubGlobal("localStorage", createLocalStorageMock());
    vi.stubGlobal("window", { innerWidth: 1920, innerHeight: 1080 });
    vi.stubGlobal("innerWidth", 1920);
    vi.stubGlobal("innerHeight", 1080);
    useBrowserStore.setState({ byProject: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalLocalStorage !== undefined) {
      globalThis.localStorage = originalLocalStorage;
    }
  });

  it("opens a float for a url and records it", () => {
    useBrowserStore.getState().openFloat("project-1", "http://localhost:3000");

    const win = useBrowserStore.getState().byProject["project-1"]?.["http://localhost:3000"];
    expect(win).toBeDefined();
    expect(win?.url).toBe("http://localhost:3000");
    expect(win?.size).toEqual({ width: FLOAT_DEFAULT_WIDTH, height: FLOAT_DEFAULT_HEIGHT });
  });

  it("is a no-op when opening a url that is already floated", () => {
    useBrowserStore.getState().openFloat("project-1", "http://localhost:3000");
    const first = useBrowserStore.getState().byProject["project-1"]["http://localhost:3000"];

    useBrowserStore.getState().openFloat("project-1", "http://localhost:3000");
    const second = useBrowserStore.getState().byProject["project-1"]["http://localhost:3000"];

    expect(second).toBe(first);
  });

  it("treats distinct urls as separate windows", () => {
    useBrowserStore.getState().openFloat("project-1", "http://localhost:3000");
    useBrowserStore.getState().openFloat("project-1", "http://127.0.0.1:8080");

    const project = useBrowserStore.getState().byProject["project-1"];
    expect(project?.["http://localhost:3000"]).toBeDefined();
    expect(project?.["http://127.0.0.1:8080"]).toBeDefined();
  });

  it("cascade-offsets successive windows", () => {
    useBrowserStore.getState().openFloat("project-1", "http://localhost:3000");
    useBrowserStore.getState().openFloat("project-1", "http://localhost:3001");

    const a = useBrowserStore.getState().byProject["project-1"]["http://localhost:3000"];
    const b = useBrowserStore.getState().byProject["project-1"]["http://localhost:3001"];

    const expectedOffset = CASCADE_STEP;
    expect(a.position.x - b.position.x).toBe(expectedOffset);
    expect(a.position.y - b.position.y).toBe(expectedOffset);
  });

  it("closes a specific url's float", () => {
    useBrowserStore.getState().openFloat("project-1", "http://localhost:3000");
    useBrowserStore.getState().openFloat("project-1", "http://localhost:3001");

    useBrowserStore.getState().closeFloat("project-1", "http://localhost:3000");

    const project = useBrowserStore.getState().byProject["project-1"];
    expect(project?.["http://localhost:3000"]).toBeUndefined();
    expect(project?.["http://localhost:3001"]).toBeDefined();
  });

  it("removes the project entry when its last window closes", () => {
    useBrowserStore.getState().openFloat("project-1", "http://localhost:3000");
    useBrowserStore.getState().closeFloat("project-1", "http://localhost:3000");

    expect(useBrowserStore.getState().byProject["project-1"]).toBeUndefined();
  });

  it("updates position and size independently", () => {
    useBrowserStore.getState().openFloat("project-1", "http://localhost:3000");
    useBrowserStore.getState().setPosition("project-1", "http://localhost:3000", { x: 10, y: 20 });

    let win = useBrowserStore.getState().byProject["project-1"]["http://localhost:3000"];
    expect(win?.position).toEqual({ x: 10, y: 20 });

    useBrowserStore.getState().setSize("project-1", "http://localhost:3000", { width: 500, height: 700 }, { x: 1, y: 2 });
    win = useBrowserStore.getState().byProject["project-1"]["http://localhost:3000"];
    expect(win?.size).toEqual({ width: 500, height: 700 });
    expect(win?.position).toEqual({ x: 1, y: 2 });
  });

  it("clears one project while keeping others", () => {
    useBrowserStore.getState().openFloat("project-1", "http://localhost:3000");
    useBrowserStore.getState().openFloat("project-2", "http://localhost:3001");
    useBrowserStore.getState().clearProject("project-1");

    expect(useBrowserStore.getState().byProject["project-1"]).toBeUndefined();
    expect(useBrowserStore.getState().byProject["project-2"]).toBeDefined();
  });

  it("navigateFloat re-keys a window preserving position/size", () => {
    useBrowserStore.getState().openFloat("project-1", "http://localhost:3000");
    useBrowserStore.getState().setPosition("project-1", "http://localhost:3000", { x: 100, y: 200 });

    useBrowserStore.getState().navigateFloat("project-1", "http://localhost:3000", "http://localhost:4000");

    const project = useBrowserStore.getState().byProject["project-1"];
    expect(project?.["http://localhost:3000"]).toBeUndefined();
    expect(project?.["http://localhost:4000"]).toBeDefined();
    expect(project?.["http://localhost:4000"]?.position).toEqual({ x: 100, y: 200 });
  });

  it("navigateFloat is a no-op when old and new url are equal", () => {
    useBrowserStore.getState().openFloat("project-1", "http://localhost:3000");
    const before = useBrowserStore.getState().byProject["project-1"]["http://localhost:3000"];

    useBrowserStore.getState().navigateFloat("project-1", "http://localhost:3000", "http://localhost:3000");

    expect(useBrowserStore.getState().byProject["project-1"]["http://localhost:3000"]).toBe(before);
  });

  it("persists state to localStorage", () => {
    useBrowserStore.getState().openFloat("project-1", "http://localhost:3000");
    const raw = (globalThis.localStorage.getItem as ReturnType<typeof vi.fn>)("spherse:floating-browser");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)["project-1"]["http://localhost:3000"]).toBeDefined();
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
    useBrowserStore.setState({ byProject: {} });

    expect(() => useBrowserStore.getState().openFloat("project-1", "http://localhost:3000")).not.toThrow();
    expect(useBrowserStore.getState().byProject["project-1"]?.["http://localhost:3000"]).toBeDefined();
  });
});
