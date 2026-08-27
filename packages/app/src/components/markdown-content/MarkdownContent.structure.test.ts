import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("MarkdownContent structure", () => {
  it("exposes a linkClassName prop for context-specific link color overrides", () => {
    const source = readFileSync(join(currentDir, "MarkdownContent.tsx"), "utf8");

    expect(source).toContain("linkClassName?: string");
  });

  it("applies the link override when either onLinkClick or linkClassName is provided", () => {
    const source = readFileSync(join(currentDir, "MarkdownContent.tsx"), "utf8");

    expect(source).toContain("onLinkClick || linkClassName");
  });

  it("merges linkClassName after the text-primary baseline so twMerge lets it win", () => {
    const source = readFileSync(join(currentDir, "MarkdownContent.tsx"), "utf8");

    expect(source).toContain('cn("text-primary underline underline-offset-4", linkClassName');
  });
});
