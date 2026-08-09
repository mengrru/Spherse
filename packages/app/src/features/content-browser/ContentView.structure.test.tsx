import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "ContentView.tsx"), "utf8");

describe("ContentView find structure", () => {
  it("computes a findEnabled gate covering all non-searchable views", () => {
    expect(source).toContain("const findEnabled =");
    expect(source).toContain("!isEditing");
    expect(source).toContain("!loading");
    expect(source).toContain("!error");
    expect(source).toContain("!binary");
    expect(source).toContain("content !== null");
    expect(source).toContain("!isImage");
    expect(source).toContain('htmlView === "preview"');
  });

  it("binds Cmd/Ctrl+F to open the find bar when enabled", () => {
    expect(source).toMatch(/metaKey \|\| event\.ctrlKey/);
    expect(source).toContain('event.key.toLowerCase() === "f"');
    expect(source).toContain("setFindOpen(true)");
  });

  it("mounts FindBar conditionally and passes only container/contentKey/onClose", () => {
    expect(source).toContain("{findOpen && (");
    expect(source).toContain("<FindBar");
    expect(source).toContain("containerRef={scrollRef}");
    expect(source).toContain("contentKey=");
    expect(source).toContain("onClose={() => setFindOpen(false)}");
  });

  it("merges the scroll-container ref so text-selection + find share the element", () => {
    expect(source).toContain("mergeRefs(contentRef, scrollRef)");
  });

  it("accepts optional parent-controlled findOpen props with an internal fallback", () => {
    expect(source).toContain("findOpen?: boolean");
    expect(source).toContain("onFindOpenChange?: (open: boolean) => void");
    expect(source).toContain("internalFindOpen");
  });

  it("closes find when the view becomes non-searchable", () => {
    expect(source).toMatch(/if \(!findEnabled\) setFindOpen\(false\)/);
  });
});
