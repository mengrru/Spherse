import { beforeEach, describe, expect, it, vi } from "vitest";

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

async function loadStore(initial: Record<string, string> = {}) {
  const storage = createLocalStorageMock(initial);
  vi.stubGlobal("localStorage", storage);
  vi.resetModules();
  const { useTabsStore } = await import("./store");
  return { useTabsStore, storage };
}

const chat = (sessionId: string) => ({ kind: "chat" as const, sessionId });
const file = (path: string) => ({ kind: "file" as const, path });
const browser = (url: string) => ({ kind: "browser" as const, url });

describe("useTabsStore", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens tabs idempotently and appends new ones at the end", async () => {
    const { useTabsStore } = await loadStore();
    const { openTab } = useTabsStore.getState();
    openTab("p1", chat("s1"));
    openTab("p1", file("a.md"));
    openTab("p1", chat("s1"));
    openTab("p1", file("./a.md"));

    expect(useTabsStore.getState().byProject.p1).toEqual([chat("s1"), file("a.md")]);
  });

  it("isolates projects", async () => {
    const { useTabsStore } = await loadStore();
    useTabsStore.getState().openTab("p1", chat("s1"));
    useTabsStore.getState().openTab("p2", chat("s2"));

    expect(useTabsStore.getState().byProject.p1).toEqual([chat("s1")]);
    expect(useTabsStore.getState().byProject.p2).toEqual([chat("s2")]);
  });

  it("replaces a tab in place, or drops it when the target already has a tab", async () => {
    const { useTabsStore } = await loadStore();
    const s = useTabsStore.getState();
    s.openTab("p1", browser("http://localhost:1/"));
    s.openTab("p1", chat("s1"));
    s.replaceTab("p1", "browser:http://localhost:1/", browser("http://localhost:2/"));
    expect(useTabsStore.getState().byProject.p1).toEqual([browser("http://localhost:2/"), chat("s1")]);

    s.openTab("p1", browser("http://localhost:3/"));
    s.replaceTab("p1", "browser:http://localhost:3/", browser("http://localhost:2/"));
    expect(useTabsStore.getState().byProject.p1).toEqual([browser("http://localhost:2/"), chat("s1")]);
  });

  it("replaceTab appends when the old tab is gone", async () => {
    const { useTabsStore } = await loadStore();
    useTabsStore.getState().replaceTab("p1", "browser:missing", browser("http://localhost:2/"));
    expect(useTabsStore.getState().byProject.p1).toEqual([browser("http://localhost:2/")]);
  });

  it("closes tabs and removes empty projects", async () => {
    const { useTabsStore } = await loadStore();
    useTabsStore.getState().openTab("p1", chat("s1"));
    useTabsStore.getState().closeTab("p1", "chat:s1");
    expect(useTabsStore.getState().byProject.p1).toBeUndefined();
  });

  it("closes file tabs at or under a deleted path", async () => {
    const { useTabsStore } = await loadStore();
    const s = useTabsStore.getState();
    s.openTab("p1", file("notes/a.md"));
    s.openTab("p1", file("notes/sub/b.md"));
    s.openTab("p1", file("notes-old/c.md"));
    s.openTab("p1", chat("notes"));
    s.closeFileTabs("p1", "notes");

    expect(useTabsStore.getState().byProject.p1).toEqual([file("notes-old/c.md"), chat("notes")]);
  });

  it("moves tabs", async () => {
    const { useTabsStore } = await loadStore();
    const s = useTabsStore.getState();
    s.openTab("p1", chat("a"));
    s.openTab("p1", chat("b"));
    s.openTab("p1", chat("c"));
    s.moveTab("p1", "chat:c", "chat:a");
    expect(useTabsStore.getState().byProject.p1).toEqual([chat("c"), chat("a"), chat("b")]);
    s.moveTab("p1", "chat:c", "chat:b");
    expect(useTabsStore.getState().byProject.p1).toEqual([chat("a"), chat("b"), chat("c")]);
  });

  it("persists to localStorage and restores valid entries only", async () => {
    const first = await loadStore();
    first.useTabsStore.getState().openTab("p1", chat("s1"));
    first.useTabsStore.getState().openTab("p1", file("a.md"));
    const raw = first.storage.setItem.mock.calls.at(-1)?.[1] as string;
    expect(JSON.parse(raw)).toEqual({ p1: [chat("s1"), file("a.md")] });

    const corrupted = JSON.stringify({
      p1: [chat("s1"), { kind: "chat", sessionId: "" }, { kind: "x" }, chat("s1"), file("b.md")],
      p2: "nope",
      p3: [],
    });
    const second = await loadStore({ "spherse:tabs": corrupted });
    expect(second.useTabsStore.getState().byProject).toEqual({ p1: [chat("s1"), file("b.md")] });
  });

  it("tolerates malformed storage", async () => {
    const { useTabsStore } = await loadStore({ "spherse:tabs": "{not json" });
    expect(useTabsStore.getState().byProject).toEqual({});
  });

  it("clearProject removes and persists", async () => {
    const { useTabsStore, storage } = await loadStore();
    useTabsStore.getState().openTab("p1", chat("s1"));
    useTabsStore.getState().openTab("p2", chat("s2"));
    useTabsStore.getState().clearProject("p1");

    expect(useTabsStore.getState().byProject).toEqual({ p2: [chat("s2")] });
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)?.[1] as string)).toEqual({ p2: [chat("s2")] });
  });
});
