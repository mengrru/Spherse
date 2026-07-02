import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("Toaster structure", () => {
  it("exposes data-toast-root for project theme CSS targeting", () => {
    const source = readFileSync(join(currentDir, "sonner.tsx"), "utf8");

    expect(source).toContain("data-toast-root");
  });
});
