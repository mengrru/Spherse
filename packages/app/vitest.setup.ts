import { vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = new Map<string, string>();

vi.stubGlobal("localStorage", {
  clear: () => {
    store.clear();
  },
  getItem: (key: string) => store.get(key) ?? null,
  key: (index: number) => Array.from(store.keys())[index] ?? null,
  removeItem: (key: string) => {
    store.delete(key);
  },
  setItem: (key: string, value: string) => {
    store.set(key, String(value));
  },
  get length() {
    return store.size;
  },
} as Storage);
