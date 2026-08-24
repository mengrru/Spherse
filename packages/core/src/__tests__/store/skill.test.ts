import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import AdmZip from "adm-zip";
import { nanoid } from "nanoid";
import { SkillStore } from "../../store/skill.js";
import { ConflictError, ValidationError } from "../../errors.js";
import { createTempProject, cleanupDir, writeFile, pathExists } from "../helpers.js";

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
      expect(s.files).toEqual([]);
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
    expect(skill!.files).toEqual([]);
  });

  it("returns null for non-existent skill", async () => {
    expect(await store.get("missing")).toBeNull();
  });

  it("enumerates companion files in a skill directory", async () => {
    await writeFile(
      skillDir,
      "companion/SKILL.md",
      "---\nname: companion\ndescription: Has files\n---\n\nBody.",
    );
    await writeFile(skillDir, "companion/references/foo.md", "# foo");
    await writeFile(skillDir, "companion/scripts/helper.js", "export {}");
    await writeFile(skillDir, "companion/.hidden", "secret");
    await writeFile(skillDir, "companion/assets/logo.txt", "logo");
    const skill = await store.get("companion");
    expect(skill).not.toBeNull();
    expect([...skill!.files].sort()).toEqual([
      "assets/logo.txt",
      "references/foo.md",
      "scripts/helper.js",
    ]);
    expect(skill!.files).not.toContain("SKILL.md");
    expect(skill!.files).not.toContain(".hidden");
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
    expect(skills[0].files).toEqual([]);
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
    expect(skill!.files).toEqual([]);
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
    expect(skill!.files).toEqual([]);
  });
});

interface ZipEntrySpec {
  entryName: string;
  content?: string;
}

function buildZip(specs: ZipEntrySpec[]): string {
  const zip = new AdmZip();
  for (const spec of specs) {
    if (spec.entryName.endsWith("/")) {
      zip.addFile(spec.entryName, Buffer.alloc(0));
    } else {
      zip.addFile(spec.entryName, Buffer.from(spec.content ?? "", "utf-8"));
    }
  }
  const zipPath = path.join(os.tmpdir(), `skill-test-${nanoid()}.zip`);
  zip.writeZip(zipPath);
  return zipPath;
}

function skillMd(name: string, description = "A test skill", body = "Do the thing."): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

describe("SkillStore createSkill", () => {
  let skillDir: string;
  let store: SkillStore;

  beforeEach(async () => {
    skillDir = await createTempProject();
    store = new SkillStore(skillDir);
  });

  afterEach(async () => {
    await cleanupDir(skillDir);
  });

  it("creates a skill directory with valid frontmatter and body", async () => {
    const skill = await store.createSkill("world-builder", "Builds worlds", "You build worlds.");

    expect(skill.name).toBe("world-builder");
    expect(skill.description).toBe("Builds worlds");
    expect(skill.instructions).toBe("You build worlds.");
    expect(skill.source).toBe("project");
    expect(skill.filePath).toBe(path.join(skillDir, "world-builder", "SKILL.md"));

    expect(pathExists(skillDir, "world-builder/SKILL.md")).toBe(true);

    const skills = await store.list();
    expect(skills.some((s) => s.name === "world-builder")).toBe(true);
  });

  it("throws ConflictError when the skill already exists", async () => {
    await store.createSkill("dup", "First", "body");
    await expect(store.createSkill("dup", "Second", "body")).rejects.toBeInstanceOf(ConflictError);
  });

  it.each(["a/b", "a\\b", "a:b", ".hidden", "  ", ""])(
    "rejects invalid name %j with ValidationError",
    async (badName) => {
      await expect(store.createSkill(badName, "desc", "body")).rejects.toBeInstanceOf(ValidationError);
    },
  );

  it("rejects an empty description", async () => {
    await expect(store.createSkill("ok", "   ", "body")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("SkillStore installSkill", () => {
  let skillDir: string;
  let store: SkillStore;

  beforeEach(async () => {
    skillDir = await createTempProject();
    store = new SkillStore(skillDir);
  });

  afterEach(async () => {
    await cleanupDir(skillDir);
  });

  it("installs a valid skill zip and exposes it via list", async () => {
    const zipPath = buildZip([
      { entryName: "myskill/" },
      { entryName: "myskill/SKILL.md", content: skillMd("myskill") },
    ]);

    const skill = await store.installSkill(zipPath);

    expect(skill.name).toBe("myskill");
    expect(skill.description).toBe("A test skill");
    expect(skill.instructions).toBe("Do the thing.");
    expect(skill.source).toBe("project");
    expect(pathExists(skillDir, "myskill/SKILL.md")).toBe(true);

    const skills = await store.list();
    expect(skills.some((s) => s.name === "myskill")).toBe(true);
  });

  it("throws ConflictError when the skill folder already exists", async () => {
    const zipPath = buildZip([
      { entryName: "myskill/" },
      { entryName: "myskill/SKILL.md", content: skillMd("myskill") },
    ]);
    await store.createSkill("myskill", "Existing", "body");

    await expect(store.installSkill(zipPath)).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects a zip missing SKILL.md without creating the skill dir", async () => {
    const zipPath = buildZip([
      { entryName: "myskill/" },
      { entryName: "myskill/other.md", content: "nope" },
    ]);

    await expect(store.installSkill(zipPath)).rejects.toBeInstanceOf(ValidationError);
    expect(pathExists(skillDir, "myskill")).toBe(false);
  });

  it("rejects SKILL.md missing the name frontmatter", async () => {
    const zipPath = buildZip([
      { entryName: "myskill/" },
      { entryName: "myskill/SKILL.md", content: "---\ndescription: d\n---\nbody" },
    ]);

    await expect(store.installSkill(zipPath)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects SKILL.md missing the description frontmatter", async () => {
    const zipPath = buildZip([
      { entryName: "myskill/" },
      { entryName: "myskill/SKILL.md", content: "---\nname: myskill\n---\nbody" },
    ]);

    await expect(store.installSkill(zipPath)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects when frontmatter name does not match the folder name", async () => {
    const zipPath = buildZip([
      { entryName: "myskill/" },
      { entryName: "myskill/SKILL.md", content: skillMd("other-name") },
    ]);

    await expect(store.installSkill(zipPath)).rejects.toBeInstanceOf(ValidationError);
    expect(pathExists(skillDir, "myskill")).toBe(false);
  });

  it("rejects a zip with more than one top-level folder", async () => {
    const zipPath = buildZip([
      { entryName: "a/", content: undefined },
      { entryName: "a/SKILL.md", content: skillMd("a") },
      { entryName: "b/extra.txt", content: "x" },
    ]);

    await expect(store.installSkill(zipPath)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a zip with a loose top-level file", async () => {
    const zipPath = buildZip([{ entryName: "SKILL.md", content: skillMd("x") }]);

    await expect(store.installSkill(zipPath)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a zip-slip entry without extracting anything", async () => {
    const zipPath = buildZip([
      { entryName: "myskill/" },
      { entryName: "myskill/SKILL.md", content: skillMd("myskill") },
      { entryName: "myskill/../../../escape.txt", content: "evil" },
    ]);

    await expect(store.installSkill(zipPath)).rejects.toBeInstanceOf(ValidationError);
    expect(pathExists(skillDir, "myskill")).toBe(false);
  });

  it("does not leave a half-installed skill on validation failure", async () => {
    const zipPath = buildZip([
      { entryName: "myskill/" },
      { entryName: "myskill/SKILL.md", content: "---\ndescription: d\n---\nbody" },
    ]);

    await expect(store.installSkill(zipPath)).rejects.toBeInstanceOf(ValidationError);
    expect(pathExists(skillDir, "myskill")).toBe(false);
  });

  it.each([".hidden", "foo:bar", "foo\\bar"])(
    "rejects install zip with invalid folder name %j without creating the skill dir",
    async (folder) => {
      const zipPath = buildZip([
        { entryName: `${folder}/` },
        { entryName: `${folder}/SKILL.md`, content: skillMd(folder) },
      ]);

      await expect(store.installSkill(zipPath)).rejects.toBeInstanceOf(ValidationError);
      expect(pathExists(skillDir, folder)).toBe(false);
    },
  );

  it("parses version frontmatter when present", async () => {
    await writeFile(
      skillDir,
      "versioned/SKILL.md",
      "---\nname: versioned\ndescription: Versioned\nversion: 1.2.0\n---\nBody.",
    );
    const skill = await store.get("versioned");
    expect(skill).not.toBeNull();
    expect(skill!.version).toBe("1.2.0");
  });

  it("omits version when frontmatter has none or a blank value", async () => {
    await writeFile(
      skillDir,
      "plain/SKILL.md",
      "---\nname: plain\ndescription: Plain\n---\nBody.",
    );
    await writeFile(
      skillDir,
      "blank/SKILL.md",
      "---\nname: blank\ndescription: Blank\nversion: '  '\n---\nBody.",
    );
    expect((await store.get("plain"))!.version).toBeUndefined();
    expect((await store.get("blank"))!.version).toBeUndefined();
  });
});

describe("SkillStore installSkill overwrite", () => {
  let skillDir: string;
  let store: SkillStore;

  beforeEach(async () => {
    skillDir = await createTempProject();
    store = new SkillStore(skillDir);
  });

  afterEach(async () => {
    await cleanupDir(skillDir);
  });

  it("replaces an existing skill when overwrite is true", async () => {
    await store.createSkill("myskill", "Old", "Old body");
    const zipPath = buildZip([
      { entryName: "myskill/" },
      {
        entryName: "myskill/SKILL.md",
        content: "---\nname: myskill\ndescription: New\nversion: 2.0.0\n---\nNew body.",
      },
    ]);

    const skill = await store.installSkill(zipPath, { overwrite: true });

    expect(skill.description).toBe("New");
    expect(skill.version).toBe("2.0.0");
    const refreshed = await store.get("myskill");
    expect(refreshed!.description).toBe("New");
    expect(refreshed!.instructions).toBe("New body.");
  });

  it("removes stale files from the previous version on overwrite", async () => {
    await writeFile(
      skillDir,
      "myskill/SKILL.md",
      "---\nname: myskill\ndescription: Old\n---\nOld body.",
    );
    await writeFile(skillDir, "myskill/references/old.md", "# old");
    const zipPath = buildZip([
      { entryName: "myskill/" },
      { entryName: "myskill/SKILL.md", content: skillMd("myskill") },
      { entryName: "myskill/references/new.md", content: "# new" },
    ]);

    await store.installSkill(zipPath, { overwrite: true });

    expect(pathExists(skillDir, "myskill/references/new.md")).toBe(true);
    expect(pathExists(skillDir, "myskill/references/old.md")).toBe(false);
    const refreshed = await store.get("myskill");
    expect(refreshed!.files).toEqual(["references/new.md"]);
  });

  it("still throws ConflictError when overwrite is not requested", async () => {
    await store.createSkill("myskill", "Existing", "body");
    const zipPath = buildZip([
      { entryName: "myskill/" },
      { entryName: "myskill/SKILL.md", content: skillMd("myskill") },
    ]);

    await expect(store.installSkill(zipPath)).rejects.toBeInstanceOf(ConflictError);
  });

  it("leaves the existing skill untouched when the replacement zip is invalid", async () => {
    await writeFile(
      skillDir,
      "myskill/SKILL.md",
      "---\nname: myskill\ndescription: Old\n---\nOld body.",
    );
    const zipPath = buildZip([
      { entryName: "myskill/" },
      { entryName: "myskill/SKILL.md", content: "---\ndescription: no name\n---\nbody" },
    ]);

    await expect(store.installSkill(zipPath, { overwrite: true })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const refreshed = await store.get("myskill");
    expect(refreshed!.description).toBe("Old");
    expect(refreshed!.instructions).toBe("Old body.");
  });

  it("treats overwrite of a missing skill as a fresh install", async () => {
    const zipPath = buildZip([
      { entryName: "fresh/" },
      { entryName: "fresh/SKILL.md", content: skillMd("fresh") },
    ]);

    const skill = await store.installSkill(zipPath, { overwrite: true });

    expect(skill.name).toBe("fresh");
    expect(pathExists(skillDir, "fresh/SKILL.md")).toBe(true);
  });
});
