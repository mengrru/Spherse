import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("ProjectPanel structure", () => {
  it("owns its side panel floating and hidden layout", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).toContain("useAppStore");
    expect(source).toContain("-translate-x-[calc(100%+3.5rem)]");
  });
});
