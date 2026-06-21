import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("MessageItem structure", () => {
  it("renders error messages after the tool call section", () => {
    const source = readFileSync(join(currentDir, "MessageItem.tsx"), "utf8");

    expect(source.indexOf("<ToolCallSection")).toBeGreaterThan(-1);
    expect(source.indexOf("<ErrorMessageSection")).toBeGreaterThan(source.indexOf("<ToolCallSection"));
  });

  it("renders FileViewerCard after ToolCallSection for run changes", () => {
    const source = readFileSync(join(currentDir, "MessageItem.tsx"), "utf8");

    expect(source.indexOf("<FileViewerCard")).toBeGreaterThan(-1);
    expect(source.indexOf("<FileViewerCard")).toBeGreaterThan(source.indexOf("<ToolCallSection"));
  });
});
