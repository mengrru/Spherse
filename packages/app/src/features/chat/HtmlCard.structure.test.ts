import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "HtmlCard.tsx"), "utf8");

describe("HtmlCard fullscreen overlay structure", () => {
  it("renders the expanded overlay through a portal to document.body", () => {
    expect(source).toMatch(/import\s*\{[^}]*\bcreatePortal\b[^}]*\}\s*from\s*["']react-dom["']/);
    expect(source).toMatch(/createPortal\(/);
    expect(source).toMatch(/,\s*document\.body\b/);
  });
});
