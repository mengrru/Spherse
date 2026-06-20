import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillStore } from "../../store/skill.js";
import { createTempProject, cleanupDir, writeFile } from "../helpers.js";

describe("SkillStore (project-only, backward compat)", () => {
  let skillDir: string;
  let store: SkillStore;

  beforeEach(async () => {
    skillDir = await createTempProject();
    store = new SkillStore(skillDir);
  });

  afterEach(async () => {
    await cleanupDir(skillDir);
  });

  it("lists skills from subdirectories marked as project source", async () => {
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
    for (const s of skills) {
      expect(s.source).toBe("project");
    }
  });

  it("gets a single skill by name marked as project source", async () => {
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
    expect(skill!.source).toBe("project");
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

describe("SkillStore with builtin sources", () => {
  let skillDir: string;

  beforeEach(async () => {
    skillDir = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(skillDir);
  });

  const builtinFixture = [
    {
      dir: "x",
      files: [
        { relativePath: "SKILL.md", content: "---\nname: x\ndescription: X\n---\nBody." },
      ],
    },
  ] as const;

  it("lists builtin skills from in-memory sources", async () => {
    const store = new SkillStore(skillDir, builtinFixture);
    const skills = await store.list();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("x");
    expect(skills[0].source).toBe("builtin");
    expect(skills[0].filePath.startsWith("builtin://")).toBe(true);
  });

  it("returns empty list when both builtin and project sources are empty", async () => {
    const store = new SkillStore(skillDir, []);
    const skills = await store.list();
    expect(skills).toHaveLength(0);
  });

  it("merges sources with project overriding builtin of same name", async () => {
    await writeFile(
      skillDir,
      "x/SKILL.md",
      "---\nname: x\ndescription: Project X\n---\nProject body.",
    );
    const store = new SkillStore(skillDir, builtinFixture);
    const skills = await store.list();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("x");
    expect(skills[0].source).toBe("project");
    expect(skills[0].description).toBe("Project X");
  });

  it("get returns project-local when both sources have the name", async () => {
    await writeFile(
      skillDir,
      "x/SKILL.md",
      "---\nname: x\ndescription: Project X\n---\nProject body.",
    );
    const store = new SkillStore(skillDir, builtinFixture);
    const skill = await store.get("x");
    expect(skill).not.toBeNull();
    expect(skill!.source).toBe("project");
  });

  it("get returns builtin when only builtin has the name", async () => {
    const store = new SkillStore(skillDir, builtinFixture);
    const skill = await store.get("x");
    expect(skill).not.toBeNull();
    expect(skill!.source).toBe("builtin");
  });

  it("skips builtin sources missing required fields", async () => {
    const badFixture = [
      {
        dir: "bad",
        files: [
          { relativePath: "SKILL.md", content: "---\nname: only-name\n---\ncontent" },
        ],
      },
    ] as const;
    const store = new SkillStore(skillDir, badFixture);
    const skills = await store.list();
    expect(skills).toHaveLength(0);
  });

  it("skips builtin sources whose files have no SKILL.md entry", async () => {
    const noSkillMdFixture = [
      {
        dir: "no-skill-md",
        files: [{ relativePath: "README.md", content: "# readme" }],
      },
    ] as const;
    const store = new SkillStore(skillDir, noSkillMdFixture);
    const skills = await store.list();
    expect(skills).toHaveLength(0);
    expect(await store.get("no-skill-md")).toBeNull();
  });

  it("get falls back to builtin when project SKILL.md is malformed", async () => {
    await writeFile(
      skillDir,
      "x/SKILL.md",
      "---\nname: x\n---\nbody",
    );
    const store = new SkillStore(skillDir, [
      {
        dir: "x",
        files: [
          { relativePath: "SKILL.md", content: "---\nname: x\ndescription: Builtin X\n---\nBuiltin body." },
        ],
      },
    ]);
    const skill = await store.get("x");
    expect(skill).not.toBeNull();
    expect(skill!.source).toBe("builtin");
    expect(skill!.description).toBe("Builtin X");
  });
});
