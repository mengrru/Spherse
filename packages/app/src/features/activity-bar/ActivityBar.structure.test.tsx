import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("ActivityBar structure", () => {
  it("shows the project panel toggle icon for the next action", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).toContain("pinned ? <PanelLeftCloseIcon /> : <PinIcon />");
  });

  it("uses an opaque background while the project panel is floating", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).toContain('pinned ? "bg-muted/30" : "bg-muted"');
  });
});
