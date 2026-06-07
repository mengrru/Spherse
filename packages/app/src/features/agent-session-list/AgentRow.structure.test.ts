import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("AgentRow structure", () => {
  it("uses CollapsibleTrigger so agent and file tree rows share expanded-state behavior", () => {
    const source = readFileSync(join(currentDir, "AgentRow.tsx"), "utf8");

    expect(source).toContain("CollapsibleTrigger");
    expect(source).toContain("group-data-[panel-open]:rotate-90");
  });
});
