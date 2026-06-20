import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("ScheduleDialog import structure", () => {
  it("imports ScheduleDialog from the standalone agent-schedule feature", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).toContain("../agent-schedule");
  });

  it("marks the schedule menu item as beta with a Badge", () => {
    const source = readFileSync(join(currentDir, "AgentRow.tsx"), "utf8");

    expect(source).toContain("Badge");
    expect(source).toContain("Beta");
    expect(source).toContain('t("agent-schedule.menuItem")');
  });
});
