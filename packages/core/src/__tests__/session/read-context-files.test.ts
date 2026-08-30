import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CONTEXT_TOTAL_SIZE_LIMIT_BYTES } from "@spherse/presets";
import { llmAccessPolicy } from "../../access/access-policy.js";
import { readContextFiles } from "../../session/read-context-files.js";
import type { Logger } from "../../logger.js";
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

  it("skips files with non plain-text extensions", async () => {
    await writeFile(projectRoot, "cover.png", "fake binary");
    const result = await readContextFiles(projectRoot, ["cover.png"]);
    expect(result).toEqual([]);
  });

  it("skips files that push the total over the size limit, keeping later smaller files", async () => {
    const limit = CONTEXT_TOTAL_SIZE_LIMIT_BYTES;
    await writeFile(projectRoot, "big.txt", "a".repeat(limit - 10));
    await writeFile(projectRoot, "over.txt", "b".repeat(100));
    await writeFile(projectRoot, "small.txt", "small");

    const result = await readContextFiles(projectRoot, ["big.txt", "over.txt", "small.txt"]);

    expect(result.map((f) => f.path)).toEqual(["big.txt", "small.txt"]);
  });

  it("loads files exactly up to the limit", async () => {
    const limit = CONTEXT_TOTAL_SIZE_LIMIT_BYTES;
    await writeFile(projectRoot, "half1.txt", "a".repeat(limit / 2));
    await writeFile(projectRoot, "half2.txt", "b".repeat(limit / 2));

    const result = await readContextFiles(projectRoot, ["half1.txt", "half2.txt"]);

    expect(result).toHaveLength(2);
  });

  it("warns via logger when skipping disallowed or oversized files", async () => {
    await writeFile(projectRoot, "cover.png", "fake binary");
    await writeFile(projectRoot, "big.txt", "a".repeat(CONTEXT_TOTAL_SIZE_LIMIT_BYTES + 1));
    const warnings: string[] = [];
    const logger = {
      warn: (_obj: unknown, msg: string) => warnings.push(msg),
    } as unknown as Logger;

    await readContextFiles(projectRoot, ["cover.png", "big.txt"], undefined, logger);

    expect(warnings).toEqual([
      "context file skipped: not a plain-text file",
      "context file skipped: total size limit exceeded",
    ]);
  });
});
