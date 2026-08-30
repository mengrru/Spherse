import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CONTEXT_TOTAL_SIZE_LIMIT_BYTES } from "@spherse/presets";
import {
  inspectContextFiles,
  assertContextFilesWithinPolicy,
} from "../../session/context-file-policy.js";
import { ValidationError } from "../../errors.js";
import { createTempProject, cleanupDir, writeFile } from "../helpers.js";

describe("inspectContextFiles", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("reports exists, size and allowed for existing text files", async () => {
    await writeFile(projectRoot, "world/magic.md", "hello world");
    const stats = await inspectContextFiles(projectRoot, ["world/magic.md"]);
    expect(stats).toEqual([
      { path: "world/magic.md", exists: true, sizeBytes: 11, allowed: true },
    ]);
  });

  it("reports missing files as not existing with zero size", async () => {
    const stats = await inspectContextFiles(projectRoot, ["missing.md"]);
    expect(stats).toEqual([{ path: "missing.md", exists: false, sizeBytes: 0, allowed: true }]);
  });

  it("reports disallowed extensions as not allowed", async () => {
    await writeFile(projectRoot, "cover.png", "fakepng");
    const stats = await inspectContextFiles(projectRoot, ["cover.png"]);
    expect(stats[0]).toMatchObject({ exists: true, allowed: false });
  });

  it("reports traversal attempts as not existing", async () => {
    const stats = await inspectContextFiles(projectRoot, ["../../../etc/passwd"]);
    expect(stats).toEqual([
      { path: "../../../etc/passwd", exists: false, sizeBytes: 0, allowed: false },
    ]);
  });

  it("reports directories as not existing", async () => {
    const stats = await inspectContextFiles(projectRoot, ["."]);
    expect(stats[0]).toMatchObject({ exists: false });
  });

  it("returns a 1:1 list for empty input", async () => {
    expect(await inspectContextFiles(projectRoot, [])).toEqual([]);
  });
});

describe("assertContextFilesWithinPolicy", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("passes for undefined, empty or non-array context", async () => {
    await expect(assertContextFilesWithinPolicy(projectRoot, undefined)).resolves.toBeUndefined();
    await expect(assertContextFilesWithinPolicy(projectRoot, [])).resolves.toBeUndefined();
    await expect(assertContextFilesWithinPolicy(projectRoot, "not-array")).resolves.toBeUndefined();
  });

  it("skips validation for arrays containing non-strings", async () => {
    await expect(
      assertContextFilesWithinPolicy(projectRoot, ["a.md", 42]),
    ).resolves.toBeUndefined();
  });

  it("rejects non plain-text files", async () => {
    await expect(
      assertContextFilesWithinPolicy(projectRoot, ["notes.md", "cover.png"]),
    ).rejects.toThrow(ValidationError);
    await expect(
      assertContextFilesWithinPolicy(projectRoot, ["notes.md", "cover.png"]),
    ).rejects.toThrow(/cover\.png/);
  });

  it("rejects when total size exceeds the limit and lists file sizes", async () => {
    const half = "a".repeat(CONTEXT_TOTAL_SIZE_LIMIT_BYTES / 2 + 1);
    await writeFile(projectRoot, "big1.txt", half);
    await writeFile(projectRoot, "big2.txt", half);
    await expect(
      assertContextFilesWithinPolicy(projectRoot, ["big1.txt", "big2.txt"]),
    ).rejects.toThrow(/exceeds the 512\.0 kB limit/);
  });

  it("passes when total size equals the limit exactly", async () => {
    await writeFile(projectRoot, "exact.txt", "a".repeat(CONTEXT_TOTAL_SIZE_LIMIT_BYTES));
    await expect(
      assertContextFilesWithinPolicy(projectRoot, ["exact.txt"]),
    ).resolves.toBeUndefined();
  });

  it("counts only existing files towards the total", async () => {
    await writeFile(projectRoot, "small.txt", "a".repeat(1024));
    await expect(
      assertContextFilesWithinPolicy(projectRoot, ["small.txt", "missing-giant.txt"]),
    ).resolves.toBeUndefined();
  });
});
