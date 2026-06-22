import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("useBusSubscription structure", () => {
  const source = readFileSync(join(currentDir, "useBusSubscription.ts"), "utf8");

  it("holds the latest handler in a ref so handler changes do not re-subscribe", () => {
    expect(source).toContain("const handlerRef = useRef(handler)");
  });

  it("uses [projectId, channel] as the effect dependency array and excludes handler", () => {
    expect(source).toContain("}, [projectId, channel]);");
    expect(source).not.toContain("[projectId, channel, handler]");
  });

  it("registers the handler on mount and removes it on cleanup", () => {
    expect(source).toContain("store.addHandler(projectId, channel, stable)");
    expect(source).toContain("store.removeHandler(projectId, channel, stable)");
  });

  it("delegates dispatched events through the stable wrapper to the ref", () => {
    expect(source).toContain(
      "(type, payload) => handlerRef.current(type, payload)",
    );
  });
});
