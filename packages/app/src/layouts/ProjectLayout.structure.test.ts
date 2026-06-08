import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("ProjectLayout structure", () => {
  it("does not own side panel interaction state", () => {
    const source = readFileSync(join(currentDir, "ProjectLayout.tsx"), "utf8");

    expect(source).not.toContain("useOutletContext");
    expect(source).not.toContain("sidePanel");
  });
});
