import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("WelcomePage structure", () => {
  const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

  it("subscribes to the fs-watch bus channel for live reload", () => {
    expect(source).toContain('useBusSubscription(projectId, "fs-watch"');
  });

  it("keeps the latest path in a ref so the bus handler reads fresh values", () => {
    expect(source).toContain("const pathRef = useRef(path)");
  });

  it("only reloads when the changed path matches the current welcome page path", () => {
    expect(source).toContain("if (!current) return");
    expect(source).toContain("if (changedPath !== normalizePath(current)) return");
  });

  it("debounces reload to coalesce rapid save bursts and clears prior load errors", () => {
    expect(source).toContain("reloadTimerRef");
    expect(source).toContain("setTimeout(() => {");
    expect(source).toContain("setLoadError(false)");
    expect(source).toContain("setReloadKey((k) => k + 1)");
    expect(source).toContain("300");
  });

  it("clears the debounce timer on unmount", () => {
    expect(source).toContain("if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)");
  });

  it("appends a cache-busting query to the preview url so the iframe/img reload", () => {
    expect(source).toContain("?t=${reloadKey}");
    expect(source).toContain("const previewUrl = ");
    expect(source).toContain("src={previewUrl}");
  });

  it("normalizes backslashes so windows paths compare equal", () => {
    expect(source).toContain("function normalizePath(p: string): string");
    expect(source).toContain('.replace(/\\\\/g, "/")');
  });
});
