import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("combobox ui component structure", () => {
  it("keeps the input at fixed height when the popup content overflows", () => {
    const source = readFileSync(join(currentDir, "combobox.tsx"), "utf8");
    const inputClassMatch = source.match(/ComboboxInput[\s\S]*?className=\{cn\(\s*"([^"]+)"/);

    expect(inputClassMatch).not.toBeNull();
    expect(inputClassMatch![1]).toContain("h-7");
    expect(inputClassMatch![1]).toContain("shrink-0");
  });
});
