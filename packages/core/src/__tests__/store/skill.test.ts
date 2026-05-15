import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillStore } from "../../store/skill.js";
import { createTempProject, cleanupDir, writeFile } from "../helpers.js";

describe("SkillStore", () => {
  let skillDir: string;
  let store: SkillStore;

  beforeEach(async () => {
    skillDir = await createTempProject();
    store = new SkillStore(skillDir);
  });

  afterEach(async () => {
    await cleanupDir(skillDir);
  });

  it("lists skills from subdirectories", async () => {
    await writeFile(
      skillDir,
      "brainstorming/SKILL.md",
      "---\nname: brainstorming\ndescription: Brainstorm ideas\n---\n\nDo creative work.",
    );
    await writeFile(
      skillDir,
      "debugging/SKILL.md",
      "---\nname: debugging\ndescription: Debug issues\n---\n\nFind bugs.",
    );
    const skills = await store.list();
    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["brainstorming", "debugging"]);
  });

  it("gets a single skill by name", async () => {
    await writeFile(
      skillDir,
      "my-skill/SKILL.md",
      "---\nname: my-skill\ndescription: My skill\n---\n\nInstructions here.",
    );
    const skill = await store.get("my-skill");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("my-skill");
    expect(skill!.description).toBe("My skill");
    expect(skill!.instructions).toContain("Instructions here.");
  });

  it("returns null for non-existent skill", async () => {
    expect(await store.get("missing")).toBeNull();
  });

  it("skips directories without SKILL.md", async () => {
    await writeFile(skillDir, "empty/README.md", "not a skill");
    const skills = await store.list();
    expect(skills).toHaveLength(0);
  });

  it("skips SKILL.md without required fields", async () => {
    await writeFile(skillDir, "bad/SKILL.md", "---\nname: only-name\n---\ncontent");
    const skills = await store.list();
    expect(skills).toHaveLength(0);
  });

  it("returns empty list for non-existent directory", async () => {
    const emptyStore = new SkillStore(skillDir + "/nope");
    const skills = await emptyStore.list();
    expect(skills).toHaveLength(0);
  });
});
