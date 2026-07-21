import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("ProjectPanel structure", () => {
  it("is a static flex child of SidePanel without own sliding logic", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).not.toContain("useSidePanel");
    expect(source).not.toContain("-translate-x");
    expect(source).not.toContain("absolute");
    expect(source).toContain("data-project-panel");
  });
});
