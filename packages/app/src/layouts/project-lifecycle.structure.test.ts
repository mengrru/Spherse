import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(currentDir, "..");
const cascadeSource = readFileSync(join(currentDir, "project-lifecycle.ts"), "utf8");

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(full));
      continue;
    }
    if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx") || entry.endsWith(".d.ts")) continue;
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) files.push(full);
  }
  return files;
}

function findProjectScopedStores(): string[] {
  const stores: string[] = [];
  for (const file of collectSourceFiles(srcRoot)) {
    const source = readFileSync(file, "utf8");
    const match = source.match(/export const (use\w+Store)\s*=\s*create</);
    if (!match) continue;
    if (!/(^|\W)clearProject(Data)?\s*[:(]/.test(source)) continue;
    stores.push(match[1]);
  }
  return stores;
}

describe("closeProjectCascade structure", () => {
  it("clears every store that defines a clearProject action", () => {
    const stores = findProjectScopedStores();

    expect(stores).toEqual(expect.arrayContaining([
      "useProjectDataStore",
      "useAgentSessionListUiStore",
      "useTriggerStore",
      "useFloatingChatStore",
      "useFloatingContentBrowserStore",
      "useBrowserStore",
    ]));

    for (const store of stores) {
      expect(cascadeSource).toContain(store);
    }
  });

  it("covers non-store cleanup surfaces", () => {
    expect(cascadeSource).toContain("disconnectProject");
    expect(cascadeSource).toContain("clearProjectQueries");
    expect(cascadeSource).toContain("clearProjectNavHistory");
    expect(cascadeSource).toContain("clearLastRoute");
  });
});
