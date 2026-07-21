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

  it("branches into a mobile drawer path via useIsMobile", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).toContain("useIsMobile");
    expect(source).toContain("<Sheet");
    expect(source).toContain('side="left"');
    expect(source).toContain("showCloseButton={false}");
    expect(source).toContain("showMobile");
    expect(source).toContain("hideMobile");
  });

  it("renders a fixed bottom-start floating button on mobile", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).toContain("fixed bottom-4 start-4");
    expect(source).toContain("size-14");
    expect(source).toContain("PanelLeftIcon");
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain('aria-label={t("side-panel.openTooltip")}');
  });
});
