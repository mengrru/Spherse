import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("ProjectRuntimeBridges structure", () => {
  it("only mounts bridges and managers without logic", () => {
    const source = readFileSync(join(currentDir, "ProjectRuntimeBridges.tsx"), "utf8");

    expect(source).not.toContain("useState");
    expect(source).not.toContain("useEffect");
    expect(source).not.toContain("useRef");
    expect(source).not.toContain("useBus");
  });

  it("returns a fragment without wrapper elements", () => {
    const source = readFileSync(join(currentDir, "ProjectRuntimeBridges.tsx"), "utf8");

    expect(source).toContain("<>");
    expect(source).toContain("</>");
    expect(source).not.toMatch(/<div/);
    expect(source).not.toMatch(/<span/);
  });

  it("mounts the full project runtime surface", () => {
    const source = readFileSync(join(currentDir, "ProjectRuntimeBridges.tsx"), "utf8");

    for (const mount of [
      "FloatingChatManager",
      "FloatingContentBrowserManager",
      "BrowserManager",
      "UiSdkBridge",
      "TriggerEventBridge",
      "ContentQueryBridge",
      "ThemeQueryBridge",
      "WelcomePageQueryBridge",
    ]) {
      expect(source).toContain(`<${mount} />`);
    }
  });
});
