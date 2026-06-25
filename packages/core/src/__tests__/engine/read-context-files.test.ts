import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { llmAccessPolicy } from "../../access/access-policy.js";
import { readContextFiles } from "../../engine/read-context-files.js";
import { createTempProject, cleanupDir, writeFile } from "../helpers.js";

describe("readContextFiles", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("returns empty string when context is empty", async () => {
    const result = await readContextFiles(projectRoot, []);
    expect(result).toBe("");
  });

  it("returns empty string when context is undefined", async () => {
    const result = await readContextFiles(projectRoot, undefined);
    expect(result).toBe("");
  });

  it("injects single context file", async () => {
    await writeFile(projectRoot, "world/magic.md", "Magic system content");
    const result = await readContextFiles(projectRoot, ["world/magic.md"]);
    expect(result).toContain("## Pre-loaded Context");
    expect(result).toContain('<context-file path="world/magic.md">');
    expect(result).toContain("Magic system content");
    expect(result).toContain("</context-file>");
  });

  it("injects multiple context files", async () => {
    await writeFile(projectRoot, "world/magic.md", "Magic content");
    await writeFile(projectRoot, "world/factions.md", "Factions content");
    const result = await readContextFiles(projectRoot, [
      "world/magic.md",
      "world/factions.md",
    ]);
    expect(result).toContain('<context-file path="world/magic.md">');
    expect(result).toContain("Magic content");
    expect(result).toContain('<context-file path="world/factions.md">');
    expect(result).toContain("Factions content");
  });

  it("skips non-existent files", async () => {
    await writeFile(projectRoot, "world/exists.md", "Exists");
    const result = await readContextFiles(projectRoot, [
      "world/exists.md",
      "world/missing.md",
    ]);
    expect(result).toContain('<context-file path="world/exists.md">');
    expect(result).toContain("Exists");
    expect(result).not.toContain("world/missing.md");
  });

  it("returns empty string when all files are missing", async () => {
    const result = await readContextFiles(projectRoot, [
      "nope.md",
      "also-nope.md",
    ]);
    expect(result).toBe("");
  });

  it("skips path traversal attempts", async () => {
    const result = await readContextFiles(projectRoot, [
      "../../../etc/passwd",
    ]);
    expect(result).toBe("");
  });

  it("skips blocked context files", async () => {
    await writeFile(projectRoot, "secrets/key.md", "secret context");
    const policy = () => llmAccessPolicy(projectRoot, ["secrets"]);

    const result = await readContextFiles(projectRoot, ["secrets/key.md"], policy);

    expect(result).toBe("");
  });
});
