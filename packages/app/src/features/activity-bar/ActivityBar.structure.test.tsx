import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("ActivityBar structure", () => {
  it("is a fully autonomous feature root — reads stores and hooks internally", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).toContain("useAppStore");
    expect(source).toContain("useProjectActions");
    expect(source).toContain("useAppUiStore");
  });

  it("does not receive project data or callbacks via props", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).not.toContain("projects:");
    expect(source).not.toContain("activeProjectId:");
    expect(source).not.toContain("onSelect");
    expect(source).not.toContain("onAdd");
    expect(source).not.toContain("onClose");
    expect(source).not.toContain("onOpenProjectFolder");
    expect(source).not.toContain("onSettings");
  });

  it("renders the pin toggle only when pinToggle prop is provided", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).toContain("pinToggle?: PinToggle");
    expect(source).toContain("pinToggle && (");
  });

  it("does not own side-panel sliding logic", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).not.toContain("useSidePanel");
    expect(source).not.toContain("useSidePanelStore");
    expect(source).not.toContain("-translate-x");
  });
});
