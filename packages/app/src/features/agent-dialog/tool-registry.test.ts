import { describe, expect, it } from "vitest";
import { ADVANCED_TOOL_IDS, TOOL_GROUPS } from "./tool-registry";

const MANAGE_TOOL_IDS = ["manage_agent", "manage_trigger", "manage_project_config"];

describe("tool-registry manage tools merge", () => {
  it("exposes the three manage tools as a single advanced group", () => {
    const matches = TOOL_GROUPS.filter((g) => g.toolIds.some((id) => MANAGE_TOOL_IDS.includes(id)));
    expect(matches).toHaveLength(1);
    const group = matches[0];
    expect(group.advanced).toBe(true);
    expect(group.label).toBe("tool.manage_project");
    expect([...group.toolIds].sort()).toEqual([...MANAGE_TOOL_IDS].sort());
  });

  it("keeps run_command as its own advanced group", () => {
    const runCommand = TOOL_GROUPS.filter((g) => g.toolIds.includes("run_command"));
    expect(runCommand).toHaveLength(1);
    expect(runCommand[0].toolIds).toEqual(["run_command"]);
  });

  it("derives ADVANCED_TOOL_IDS from advanced groups only", () => {
    expect([...ADVANCED_TOOL_IDS].sort()).toEqual(
      [...MANAGE_TOOL_IDS, "run_command"].sort(),
    );
  });
});
