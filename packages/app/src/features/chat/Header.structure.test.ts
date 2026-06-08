import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("Chat Header structure", () => {
  it("exposes data-chat-header for agent theme CSS targeting", () => {
    const source = readFileSync(join(currentDir, "Header.tsx"), "utf8");

    expect(source).toContain("data-chat-header");
  });
});
