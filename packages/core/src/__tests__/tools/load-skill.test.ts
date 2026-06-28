import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLoadSkillTool } from "../../tools/load-skill.js";
import { SkillStore } from "../../store/skill.js";
import { createTempProject, cleanupDir, writeFile } from "../helpers.js";

describe("createLoadSkillTool", () => {
  let skillDir: string;

  beforeEach(async () => {
    skillDir = await createTempProject();
    await writeFile(
      skillDir,
      "brainstorming/SKILL.md",
      "---\nname: brainstorming\ndescription: Brainstorm ideas\n---\n\nDo creative brainstorming here.",
    );
  });

  afterEach(async () => {
    await cleanupDir(skillDir);
  });

  it("loads an existing skill", async () => {
    const tool = createLoadSkillTool(skillDir, new SkillStore(skillDir));
    const result = await tool.execute("tc1", { skill_name: "brainstorming" }, undefined as any);
    expect(result.content[0].text).toContain("Skill: brainstorming");
    expect(result.content[0].text).toContain("Do creative brainstorming here.");
    expect(result.details).toEqual({ name: "brainstorming" });
  });

  it("returns error for non-existent skill", async () => {
    const tool = createLoadSkillTool(skillDir, new SkillStore(skillDir));
    const result = await tool.execute("tc1", { skill_name: "missing" }, undefined as any);
    expect(result.content[0].text).toContain('skill "missing" not found');
    expect(result.details).toBeUndefined();
  });

  it("returns error for skill without SKILL.md", async () => {
    await writeFile(skillDir, "empty-dir/placeholder.txt", "");
    const tool = createLoadSkillTool(skillDir, new SkillStore(skillDir));
    const result = await tool.execute("tc1", { skill_name: "empty-dir" }, undefined as any);
    expect(result.content[0].text).toContain("not found");
  });

  it("appends manifest for project skill with companion files", async () => {
    await writeFile(skillDir, "brainstorming/references/foo.md", "# Foo\n\nFoo content.");
    await writeFile(skillDir, "brainstorming/scripts/helper.js", "console.log('hi');");

    const tool = createLoadSkillTool(skillDir, new SkillStore(skillDir));
    const result = await tool.execute("tc1", { skill_name: "brainstorming" }, undefined as any);
    const text = result.content[0].text;
    expect(text).toContain("## Skill Files");
    expect(text).toContain("- brainstorming/references/foo.md");
    expect(text).toContain("- brainstorming/scripts/helper.js");
    expect(text).toContain("read_file tool");
  });

  it("does not append manifest for project skill without companion files", async () => {
    const tool = createLoadSkillTool(skillDir, new SkillStore(skillDir));
    const result = await tool.execute("tc1", { skill_name: "brainstorming" }, undefined as any);
    expect(result.content[0].text).not.toContain("## Skill Files");
  });
});
