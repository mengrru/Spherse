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

const file = (path: string) => ({ kind: "file" as const, path });

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
    useSplitPaneStore.getState().openSplit("p1", file("docs/a.md"));
    expect(useSplitPaneStore.getState().byProject.p1).toEqual({ target: file("docs/a.md"), ratio: 0.5 });
    expect(persisted(storage)).toEqual({ p1: { target: file("docs/a.md"), ratio: 0.5 } });
  });

  it("replaces the file while keeping the ratio", async () => {
    const { useSplitPaneStore } = await loadStore();
    const s = useSplitPaneStore.getState();
    s.openSplit("p1", file("a.md"));
    s.setRatio("p1", 0.3);
    s.openSplit("p1", file("b.md"));
    expect(useSplitPaneStore.getState().byProject.p1).toEqual({ target: file("b.md"), ratio: 0.3 });
  });

  it("normalizes file paths", async () => {
    const { useSplitPaneStore } = await loadStore();
    useSplitPaneStore.getState().openSplit("p1", file("./docs\\a.md"));
    expect(useSplitPaneStore.getState().byProject.p1.target).toEqual(file("docs/a.md"));
  });

  it("isolates projects", async () => {
    const { useSplitPaneStore } = await loadStore();
    const s = useSplitPaneStore.getState();
    s.openSplit("p1", file("a.md"));
    s.openSplit("p2", file("b.md"));
    s.closeSplit("p1");
    expect(useSplitPaneStore.getState().byProject).toEqual({ p2: { target: file("b.md"), ratio: 0.5 } });
  });

  it("closes the split when the file or one of its parents is deleted", async () => {
    const { useSplitPaneStore } = await loadStore();
    const s = useSplitPaneStore.getState();
    s.openSplit("p1", file("docs/sub/a.md"));
    s.closeDeletedSplit("p1", "docs/other");
    expect(useSplitPaneStore.getState().byProject.p1).toBeDefined();
    s.closeDeletedSplit("p1", "docs");
    expect(useSplitPaneStore.getState().byProject.p1).toBeUndefined();

    s.openSplit("p1", file("a.md"));
    s.closeDeletedSplit("p1", "a.md");
    expect(useSplitPaneStore.getState().byProject.p1).toBeUndefined();
  });

  it("ignores invalid ratios and ratios without a split", async () => {
    const { useSplitPaneStore } = await loadStore();
    const s = useSplitPaneStore.getState();
    s.setRatio("p1", 0.4);
    expect(useSplitPaneStore.getState().byProject.p1).toBeUndefined();
    s.openSplit("p1", file("a.md"));
    s.setRatio("p1", 1.2);
    s.setRatio("p1", Number.NaN);
    expect(useSplitPaneStore.getState().byProject.p1.ratio).toBe(0.5);
  });

  it("restores valid entries and drops invalid ones on load", async () => {
    const { useSplitPaneStore } = await loadStore({
      [KEY]: JSON.stringify({
        ok: { target: file("a.md"), ratio: 0.4 },
        emptyPath: { target: file(""), ratio: 0.4 },
        badRatio: { target: file("b.md"), ratio: 1 },
        unsupported: { target: { kind: "chat", sessionId: "s1" }, ratio: 0.4 },
        wrong: "x",
      }),
    });
    expect(useSplitPaneStore.getState().byProject).toEqual({ ok: { target: file("a.md"), ratio: 0.4 } });
  });

  it("migrates legacy filePath entries", async () => {
    const { useSplitPaneStore } = await loadStore({
      [KEY]: JSON.stringify({ p1: { filePath: "./docs/a.md", ratio: 0.4 } }),
    });
    expect(useSplitPaneStore.getState().byProject).toEqual({ p1: { target: file("docs/a.md"), ratio: 0.4 } });
  });

  it("rejects target kinds the split pane cannot show yet", async () => {
    const { useSplitPaneStore } = await loadStore();
    useSplitPaneStore.getState().openSplit("p1", { kind: "browser", url: "http://localhost:3000/" });
    expect(useSplitPaneStore.getState().byProject.p1).toBeUndefined();
  });

  it("ignores malformed storage", async () => {
    const { useSplitPaneStore } = await loadStore({ [KEY]: "{not json" });
    expect(useSplitPaneStore.getState().byProject).toEqual({});
  });

  it("clears a project", async () => {
    const { useSplitPaneStore, storage } = await loadStore();
    const s = useSplitPaneStore.getState();
    s.openSplit("p1", file("a.md"));
    s.clearProject("p1");
    expect(useSplitPaneStore.getState().byProject).toEqual({});
    expect(persisted(storage)).toEqual({});
  });
});
