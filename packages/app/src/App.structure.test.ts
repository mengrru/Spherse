import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("App structure", () => {
  it("does not own side panel interaction state", () => {
    const source = readFileSync(join(currentDir, "App.tsx"), "utf8");

    expect(source).not.toContain("sidePanel");
    expect(source).not.toContain("useRef");
  });
});
