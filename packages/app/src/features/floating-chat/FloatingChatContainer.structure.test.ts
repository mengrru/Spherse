import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("FloatingChatContainer structure", () => {
  const source = readFileSync(join(currentDir, "FloatingChatContainer.tsx"), "utf8");

  it("remounts Chat per floating session swap via key to isolate composer draft state", () => {
    expect(source).toMatch(/<Chat\s+[^>]*key=\{floatingChat\.sessionId\}/);
  });
});
