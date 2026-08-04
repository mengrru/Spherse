import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("ProjectScope structure", () => {
  it("does not own local UI state", () => {
    const source = readFileSync(join(currentDir, "ProjectScope.tsx"), "utf8");

    expect(source).not.toContain("useState");
    expect(source).not.toContain("useSpherseMessageListener");
    expect(source).not.toContain("useEventBridge");
    expect(source).toContain("useSidePanel");
    expect(source).toContain("<UiSdkBridge />");
    expect(source).toContain("Outlet");
  });
});
