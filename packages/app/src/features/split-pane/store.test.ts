import { describe, expect, it, vi } from "vitest";

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
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

const KEY = "spherse:content-split";

async function loadStore(initial: Record<string, string> = {}) {
  const storage = createLocalStorageMock(initial);
  vi.stubGlobal("localStorage", storage);
  vi.resetModules();
  const { useSplitPaneStore } = await import("./store");
  return { useSplitPaneStore, storage };
}

function persisted(storage: ReturnType<typeof createLocalStorageMock>) {
  return JSON.parse(storage.getItem(KEY) ?? "null");
}

describe("useSplitPaneStore", () => {
  it("opens a split with the default ratio and persists it", async () => {
    const { useSplitPaneStore, storage } = await loadStore();
    useSplitPaneStore.getState().openSplit("p1", "docs/a.md");
    expect(useSplitPaneStore.getState().byProject.p1).toEqual({ filePath: "docs/a.md", ratio: 0.5 });
    expect(persisted(storage)).toEqual({ p1: { filePath: "docs/a.md", ratio: 0.5 } });
  });

  it("replaces the file while keeping the ratio", async () => {
    const { useSplitPaneStore } = await loadStore();
    const s = useSplitPaneStore.getState();
    s.openSplit("p1", "a.md");
    s.setRatio("p1", 0.3);
    s.openSplit("p1", "b.md");
    expect(useSplitPaneStore.getState().byProject.p1).toEqual({ filePath: "b.md", ratio: 0.3 });
  });

  it("normalizes file paths", async () => {
    const { useSplitPaneStore } = await loadStore();
    useSplitPaneStore.getState().openSplit("p1", "./docs\\a.md");
    expect(useSplitPaneStore.getState().byProject.p1.filePath).toBe("docs/a.md");
  });

  it("isolates projects", async () => {
    const { useSplitPaneStore } = await loadStore();
    const s = useSplitPaneStore.getState();
    s.openSplit("p1", "a.md");
    s.openSplit("p2", "b.md");
    s.closeSplit("p1");
    expect(useSplitPaneStore.getState().byProject).toEqual({ p2: { filePath: "b.md", ratio: 0.5 } });
  });

  it("closes the split when the file or one of its parents is deleted", async () => {
    const { useSplitPaneStore } = await loadStore();
    const s = useSplitPaneStore.getState();
    s.openSplit("p1", "docs/sub/a.md");
    s.closeDeletedSplit("p1", "docs/other");
    expect(useSplitPaneStore.getState().byProject.p1).toBeDefined();
    s.closeDeletedSplit("p1", "docs");
    expect(useSplitPaneStore.getState().byProject.p1).toBeUndefined();

    s.openSplit("p1", "a.md");
    s.closeDeletedSplit("p1", "a.md");
    expect(useSplitPaneStore.getState().byProject.p1).toBeUndefined();
  });

  it("ignores invalid ratios and ratios without a split", async () => {
    const { useSplitPaneStore } = await loadStore();
    const s = useSplitPaneStore.getState();
    s.setRatio("p1", 0.4);
    expect(useSplitPaneStore.getState().byProject.p1).toBeUndefined();
    s.openSplit("p1", "a.md");
    s.setRatio("p1", 1.2);
    s.setRatio("p1", Number.NaN);
    expect(useSplitPaneStore.getState().byProject.p1.ratio).toBe(0.5);
  });

  it("restores valid entries and drops invalid ones on load", async () => {
    const { useSplitPaneStore } = await loadStore({
      [KEY]: JSON.stringify({
        ok: { filePath: "a.md", ratio: 0.4 },
        emptyPath: { filePath: "", ratio: 0.4 },
        badRatio: { filePath: "b.md", ratio: 1 },
        wrong: "x",
      }),
    });
    expect(useSplitPaneStore.getState().byProject).toEqual({ ok: { filePath: "a.md", ratio: 0.4 } });
  });

  it("ignores malformed storage", async () => {
    const { useSplitPaneStore } = await loadStore({ [KEY]: "{not json" });
    expect(useSplitPaneStore.getState().byProject).toEqual({});
  });

  it("clears a project", async () => {
    const { useSplitPaneStore, storage } = await loadStore();
    const s = useSplitPaneStore.getState();
    s.openSplit("p1", "a.md");
    s.clearProject("p1");
    expect(useSplitPaneStore.getState().byProject).toEqual({});
    expect(persisted(storage)).toEqual({});
  });
});
