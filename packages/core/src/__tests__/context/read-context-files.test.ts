import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { llmAccessPolicy } from "../../access/access-policy.js";
import { readContextFiles } from "../../context/read-context-files.js";
import { createTempProject, cleanupDir, writeFile } from "../helpers.js";

describe("readContextFiles", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("returns empty array when context is empty", async () => {
    const result = await readContextFiles(projectRoot, []);
    expect(result).toEqual([]);
  });

  it("returns empty array when context is undefined", async () => {
    const result = await readContextFiles(projectRoot, undefined);
    expect(result).toEqual([]);
  });

  it("injects single context file", async () => {
    await writeFile(projectRoot, "world/magic.md", "Magic system content");
    const result = await readContextFiles(projectRoot, ["world/magic.md"]);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("world/magic.md");
    expect(result[0].content).toBe("Magic system content");
  });

  it("injects multiple context files", async () => {
    await writeFile(projectRoot, "world/magic.md", "Magic content");
    await writeFile(projectRoot, "world/factions.md", "Factions content");
    const result = await readContextFiles(projectRoot, [
      "world/magic.md",
      "world/factions.md",
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe("world/magic.md");
    expect(result[0].content).toBe("Magic content");
    expect(result[1].path).toBe("world/factions.md");
    expect(result[1].content).toBe("Factions content");
  });

  it("skips non-existent files", async () => {
    await writeFile(projectRoot, "world/exists.md", "Exists");
    const result = await readContextFiles(projectRoot, [
      "world/exists.md",
      "world/missing.md",
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("world/exists.md");
    expect(result[0].content).toBe("Exists");
  });

  it("returns empty array when all files are missing", async () => {
    const result = await readContextFiles(projectRoot, [
      "nope.md",
      "also-nope.md",
    ]);
    expect(result).toEqual([]);
  });

  it("skips path traversal attempts", async () => {
    const result = await readContextFiles(projectRoot, [
      "../../../etc/passwd",
    ]);
    expect(result).toEqual([]);
  });

  it("skips blocked context files", async () => {
    await writeFile(projectRoot, "secrets/key.md", "secret context");
    const policy = () => llmAccessPolicy(projectRoot, ["secrets"]);

    const result = await readContextFiles(projectRoot, ["secrets/key.md"], policy);

    expect(result).toEqual([]);
  });
});
