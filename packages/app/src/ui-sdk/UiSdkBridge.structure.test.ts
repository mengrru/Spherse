import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("UiSdkBridge structure", () => {
  it("owns UI SDK project integration", () => {
    const source = readFileSync(join(currentDir, "UiSdkBridge.tsx"), "utf8");

    expect(source).toContain("useProjectCtx");
    expect(source).toContain("useApiClient");
    expect(source).toContain("useSpherseMessageListener");
    expect(source).toContain("useEventBridge");
    expect(source).toContain("return null");
  });
});
