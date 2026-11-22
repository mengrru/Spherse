import { describe, it, expect } from "vitest";

describe("browser test harness", () => {
  it("provides OPFS via navigator.storage", async () => {
    expect(typeof navigator.storage.getDirectory).toBe("function");
    const root = await navigator.storage.getDirectory();
    expect(root.kind).toBe("directory");
    const handle = await root.getDirectoryHandle(`smoke-${Date.now()}`, { create: true });
    const file = await handle.getFileHandle("probe.txt", { create: true });
    const writable = await file.createWritable();
    await writable.write("ok");
    await writable.close();
    const read = await file.getFile();
    expect(await read.text()).toBe("ok");
    await root.removeEntry(handle.name, { recursive: true });
  });

  it("provides IndexedDB", async () => {
    const name = `smoke-${Date.now()}`;
    const open = indexedDB.open(name, 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    expect(db.name).toBe(name);
    db.close();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
});
