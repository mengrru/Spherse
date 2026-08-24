import { describe, expect, it } from "vitest";
import { deriveSkillCardState } from "./marketplace-state";

describe("deriveSkillCardState", () => {
  it("returns install when the skill is not installed locally", () => {
    expect(deriveSkillCardState(undefined, "1.0.0")).toBe("install");
  });

  it("returns update when the local version is older than the market version", () => {
    expect(deriveSkillCardState({ version: "1.0.0" }, "1.2.0")).toBe("update");
    expect(deriveSkillCardState({ version: "1.0.0-alpha" }, "1.0.0")).toBe("update");
  });

  it("returns installed when the local version matches or exceeds the market version", () => {
    expect(deriveSkillCardState({ version: "1.2.0" }, "1.2.0")).toBe("installed");
    expect(deriveSkillCardState({ version: "2.0.0" }, "1.2.0")).toBe("installed");
  });

  it("returns installed without guessing when the local skill has no version", () => {
    expect(deriveSkillCardState({}, "1.2.0")).toBe("installed");
    expect(deriveSkillCardState({ version: undefined }, "1.2.0")).toBe("installed");
  });

  it("returns installed when either version is not valid semver", () => {
    expect(deriveSkillCardState({ version: "latest" }, "1.2.0")).toBe("installed");
    expect(deriveSkillCardState({ version: "1.0.0" }, "latest")).toBe("installed");
  });
});
