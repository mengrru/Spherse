import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { llmAccessPolicy } from "../../access/access-policy.js";
import { createEditFileTool } from "../../tools/edit-file.js";
import { FileWriteMutex } from "../../utils/file-write-mutex.js";
import { createTempProject, cleanupDir, writeFile, readFile, permissivePolicy } from "../helpers.js";

describe("createEditFileTool", () => {
  let projectRoot: string;
  let mutex: FileWriteMutex;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    mutex = new FileWriteMutex();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("replaces a single occurrence", async () => {
    await writeFile(projectRoot, "code.ts", "const x = 1;\nconst y = 2;");
    const tool = createEditFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    const result = await tool.execute(
      "tc1",
      { path: "code.ts", old_string: "const x = 1;", new_string: "const x = 10;" },
      undefined as any,
    );
    expect(result.content[0].text).toContain("Successfully edited");
    expect(result.details).toEqual({ path: "code.ts", replacements: 1 });
    const content = await readFile(projectRoot, "code.ts");
    expect(content).toBe("const x = 10;\nconst y = 2;");
  });

  it("deletes text by using empty new_string", async () => {
    await writeFile(projectRoot, "a.txt", "keep thisremove this");
    const tool = createEditFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    await tool.execute(
      "tc1",
      { path: "a.txt", old_string: "remove this", new_string: "" },
      undefined as any,
    );
    expect(await readFile(projectRoot, "a.txt")).toBe("keep this");
  });

  it("returns error when old_string not found", async () => {
    await writeFile(projectRoot, "a.txt", "hello");
    const tool = createEditFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    const result = await tool.execute(
      "tc1",
      { path: "a.txt", old_string: "not here", new_string: "x" },
      undefined as any,
    );
    expect(result.content[0].text).toContain("old_string not found");
    expect(result.details).toBeUndefined();
  });

  it("returns error when multiple matches without replace_all", async () => {
    await writeFile(projectRoot, "a.txt", "abc abc abc");
    const tool = createEditFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    const result = await tool.execute(
      "tc1",
      { path: "a.txt", old_string: "abc", new_string: "x" },
      undefined as any,
    );
    expect(result.content[0].text).toContain("matches 3 locations");
    expect(result.details).toBeUndefined();
  });

  it("replaces all occurrences when replace_all is true", async () => {
    await writeFile(projectRoot, "a.txt", "abc abc abc");
    const tool = createEditFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    const result = await tool.execute(
      "tc1",
      { path: "a.txt", old_string: "abc", new_string: "x", replace_all: true },
      undefined as any,
    );
    expect(result.content[0].text).toContain("replaced 3 occurrence(s)");
    expect(result.details).toEqual({ path: "a.txt", replacements: 3 });
    expect(await readFile(projectRoot, "a.txt")).toBe("x x x");
  });

  it("returns error for non-existent file", async () => {
    const tool = createEditFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    const result = await tool.execute(
      "tc1",
      { path: "nope.txt", old_string: "a", new_string: "b" },
      undefined as any,
    );
    expect(result.content[0].text).toContain("file not found");
    expect(result.details).toBeUndefined();
  });

  it("denies blocked paths because it reads before writing", async () => {
    await writeFile(projectRoot, "secrets/key.md", "old secret");
    const policy = () => llmAccessPolicy(projectRoot, ["secrets"]);
    const tool = createEditFileTool(projectRoot, mutex, policy);

    const result = await tool.execute(
      "tc1",
      { path: "secrets/key.md", old_string: "old", new_string: "new" },
      undefined as any,
    );

    expect(result.content[0].text).toContain("Access denied");
    expect(await readFile(projectRoot, "secrets/key.md")).toBe("old secret");
  });

  it("rejects path traversal", async () => {
    const tool = createEditFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    await expect(
      tool.execute("tc1", { path: "../etc/hosts", old_string: "a", new_string: "b" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });
});
