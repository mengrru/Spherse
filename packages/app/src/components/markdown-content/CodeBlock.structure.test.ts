import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("CodeBlock structure", () => {
  it("keeps the data-md-code theme hook on the inner pre, not the wrapper div", () => {
    const source = readFileSync(join(currentDir, "CodeBlock.tsx"), "utf8");

    expect(source).toContain("<pre data-md-code className={className} {...props}>");
  });

  it("guards against a missing navigator.clipboard before writing", () => {
    const source = readFileSync(join(currentDir, "CodeBlock.tsx"), "utf8");

    expect(source).toContain("if (!navigator.clipboard) return;");
  });
});
