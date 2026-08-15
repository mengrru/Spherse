import { describe, expect, it } from "vitest";
import { TOOL_GROUPS } from "./tool-registry";

describe("agent-dialog tool registry", () => {
  it("does not list ask_user (always enabled at runtime, not user-configurable)", () => {
    const toolIds = TOOL_GROUPS.flatMap((g) => g.toolIds);
    expect(toolIds).not.toContain("ask_user");
  });
});
