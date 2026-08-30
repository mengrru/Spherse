import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("SidePanel structure", () => {
  it("physically combines ActivityBar and ProjectPanel as one sliding unit (desktop)", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).toContain("useSidePanel");
    expect(source).toContain("<ActivityBar");
    expect(source).toContain("<ProjectPanel");
    expect(source).toContain('pinToggle={{ pinned, onToggle: togglePin }}');
  });

  it("owns the single sliding transform replacing the old coordinated animation", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).toContain("-translate-x-full");
    expect(source).not.toContain("-translate-x-[calc(100%+3.5rem)]");
    expect(source).not.toContain("left-[52px]");
  });

  it("does not forward project data or callbacks to ActivityBar", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).not.toContain("projects=");
    expect(source).not.toContain("activeProjectId=");
    expect(source).not.toContain("onSelect=");
    expect(source).not.toContain("onAdd=");
    expect(source).not.toContain("onClose=");
    expect(source).not.toContain("onSettings=");
  });
});
