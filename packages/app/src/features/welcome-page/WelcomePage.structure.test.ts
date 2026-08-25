import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const componentSource = readFileSync(join(currentDir, "index.tsx"), "utf8");
const querySource = readFileSync(join(currentDir, "../../queries/welcome-page.ts"), "utf8");

describe("WelcomePage structure", () => {
  it("resolves the welcome page through the cached query instead of a manual fetch", () => {
    expect(componentSource).toContain("useWelcomePage(projectId, client)");
    expect(componentSource).not.toContain("getWelcomePageSettings");
    expect(componentSource).not.toContain("WELCOME_PAGE_SETTINGS_CHANGED_EVENT");
  });

  it("renders the fallback when the query errors or resolves no path", () => {
    expect(componentSource).toContain("const path = isError ? null : data?.path");
    expect(componentSource).toContain("if (path === null) return <>{fallback}</>");
  });

  it("subscribes to the fs-watch bus channel for live reload", () => {
    expect(componentSource).toContain('useBusSubscription(projectId, "fs-watch"');
  });

  it("keeps the latest path in a ref so the bus handler reads fresh values", () => {
    expect(componentSource).toContain("const pathRef = useRef(path)");
  });

  it("only reloads when the changed path matches the current welcome page path", () => {
    expect(componentSource).toContain("if (!current) return");
    expect(componentSource).toContain("if (changedPath !== normalizePath(current)) return");
  });

  it("debounces reload to coalesce rapid save bursts and clears prior load errors", () => {
    expect(componentSource).toContain("reloadTimerRef");
    expect(componentSource).toContain("setTimeout(() => {");
    expect(componentSource).toContain("setLoadError(false)");
    expect(componentSource).toContain("setReloadKey((k) => k + 1)");
    expect(componentSource).toContain("300");
  });

  it("clears the debounce timer on unmount", () => {
    expect(componentSource).toContain("if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)");
  });

  it("uses a cache-stable preview URL and forces reload via React key on iframe/img", () => {
    expect(componentSource).toContain("getPreviewUrl(path)");
    expect(componentSource).not.toContain("getPreviewUrl(path, reloadKey)");
    expect(componentSource).toContain("key={reloadKey}");
    expect(componentSource).toContain("const previewUrl = ");
    expect(componentSource).toContain("src={previewUrl}");
  });

  it("invalidates the cached resolution on bus reconnection", () => {
    expect(componentSource).toContain("void invalidateWelcomePage(projectId)");
  });

  it("normalizes backslashes so windows paths compare equal", () => {
    expect(componentSource).toContain("function normalizePath(p: string): string");
    expect(componentSource).toContain('.replace(/\\\\/g, "/")');
  });

  it("falls back to project root index.html in the query when no welcome page is configured", () => {
    expect(querySource).toContain('getPreviewUrl("index.html")');
  });
});
