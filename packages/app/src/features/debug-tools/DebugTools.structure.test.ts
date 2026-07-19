import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("DebugTools structure", () => {
  const entrySource = readFileSync(join(currentDir, "index.tsx"), "utf8");
  const menuSource = readFileSync(join(currentDir, "DebugMenu.tsx"), "utf8");

  it("does not reference window.electronAPI directly in the entry", () => {
    expect(entrySource).not.toContain("window.electronAPI");
  });

  it("does not reference window.electronAPI directly in the menu", () => {
    expect(menuSource).not.toContain("window.electronAPI");
  });

  it("reads isDev through the host bridge devTools api", () => {
    expect(entrySource).toContain("bridge.devTools");
    expect(entrySource).toContain("isDev");
  });

  it("wires debug actions through bridge.devTools", () => {
    expect(menuSource).toContain("bridge.devTools?.toggleDevTools()");
    expect(menuSource).toContain("bridge.devTools?.getElectronStoreData()");
    expect(menuSource).toContain("bridge.devTools?.reloadRenderer()");
    expect(menuSource).toContain("bridge.devTools?.resetAppData()");
  });
});
