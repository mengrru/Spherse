# packages/core 单元测试实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `packages/core` 建立完整的单元测试体系，覆盖全部 7 个 tools、4 个 stores，使用 Vitest 作为测试框架。

**Architecture:** 采用分层测试策略：先搭 Vitest 基础设施，然后按 tool → store 顺序逐个添加测试。每个 tool 使用 `os.tmpdir()` 创建临时项目目录进行隔离测试。Store 测试同样基于临时目录（SessionStore 用 `:memory:` SQLite）。

**Tech Stack:** Vitest（原生 ESM + TypeScript 支持）、better-sqlite3（已有依赖）、Node.js `fs`/`os` 模块

---

## File Structure

```
packages/core/
├── vitest.config.ts                    # Vitest 配置
├── package.json                        # 新增 vitest + @types/node devDeps + test script
├── src/
│   ├── tools/                          # 被测源码（不修改）
│   ├── store/                          # 被测源码（不修改）
│   └── __tests__/
│       ├── helpers.ts                  # 共享测试工具：创建临时项目目录、清理
│       ├── tools/
│       │   ├── read-file.test.ts
│       │   ├── write-file.test.ts
│       │   ├── edit-file.test.ts
│       │   ├── list-files.test.ts
│       │   ├── search-content.test.ts
│       │   ├── append-changelog.test.ts
│       │   └── load-skill.test.ts
│       └── store/
│           ├── project.test.ts
│           ├── session.test.ts
│           ├── agent-profile.test.ts
│           └── skill.test.ts
```

---

## Task 1: Vitest 基础设施搭建

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/__tests__/helpers.ts`

- [ ] **Step 1: 安装 vitest 依赖**

```bash
npm install -D vitest @types/node --workspace=packages/core
```

- [ ] **Step 2: 在 `packages/core/package.json` 中添加 test script**

在 `scripts` 中添加：

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: 创建 `packages/core/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    testTimeout: 10000,
  },
});
```

- [ ] **Step 4: 创建 `packages/core/src/__tests__/helpers.ts`**

```typescript
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

export async function createTempProject(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wb-test-"));
  return tmpDir;
}

export async function cleanupDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

export async function writeFile(dir: string, relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(dir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

export async function readFile(dir: string, relativePath: string): Promise<string> {
  return fs.readFile(path.join(dir, relativePath), "utf-8");
}

export async function ensureDir(dir: string, relativePath: string): Promise<void> {
  await fs.mkdir(path.join(dir, relativePath), { recursive: true });
}

export function pathExists(dir: string, relativePath: string): boolean {
  return fsSync.existsSync(path.join(dir, relativePath));
}
```

- [ ] **Step 5: 验证基础设施**

```bash
npx vitest run --workspace=packages/core
```

预期输出：`No test files found` 或类似提示（因为还没有测试文件），但不应有配置错误。

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/package-lock.json packages/core/vitest.config.ts packages/core/src/__tests__/helpers.ts
git commit -m "chore: add vitest infrastructure for packages/core"
```

---

## Task 2: read_file tool 测试

**Files:**
- Create: `packages/core/src/__tests__/tools/read-file.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createReadFileTool } from "../../tools/read-file.js";
import { createTempProject, cleanupDir, writeFile } from "../helpers.js";

describe("createReadFileTool", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("reads an existing file", async () => {
    await writeFile(projectRoot, "hello.txt", "hello world");
    const tool = createReadFileTool(projectRoot);
    const result = await tool.execute("tc1", { path: "hello.txt" }, undefined as any);
    expect(result.content[0].text).toBe("hello world");
    expect(result.details).toEqual({ path: "hello.txt", size: 11 });
  });

  it("reads a nested file", async () => {
    await writeFile(projectRoot, "docs/notes.md", "# Notes");
    const tool = createReadFileTool(projectRoot);
    const result = await tool.execute("tc1", { path: "docs/notes.md" }, undefined as any);
    expect(result.content[0].text).toBe("# Notes");
  });

  it("returns error for non-existent file", async () => {
    const tool = createReadFileTool(projectRoot);
    const result = await tool.execute("tc1", { path: "missing.txt" }, undefined as any);
    expect(result.content[0].text).toContain("Error");
    expect(result.details).toBeUndefined();
  });

  it("rejects path traversal with ../", async () => {
    const tool = createReadFileTool(projectRoot);
    await expect(
      tool.execute("tc1", { path: "../../../etc/passwd" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });

  it("rejects path traversal with absolute path outside root", async () => {
    const tool = createReadFileTool(projectRoot);
    await expect(
      tool.execute("tc1", { path: "/etc/passwd" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });
});
```

- [ ] **Step 2: 运行测试验证通过**

```bash
npx vitest run src/__tests__/tools/read-file.test.ts --workspace=packages/core
```

预期：5 个测试全部通过

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/tools/read-file.test.ts
git commit -m "test: add read_file tool tests"
```

---

## Task 3: write_file tool 测试

**Files:**
- Create: `packages/core/src/__tests__/tools/write-file.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createWriteFileTool } from "../../tools/write-file.js";
import { createTempProject, cleanupDir, readFile, pathExists } from "../helpers.js";

describe("createWriteFileTool", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("writes a new file", async () => {
    const tool = createWriteFileTool(projectRoot);
    const result = await tool.execute("tc1", { path: "out.txt", content: "hello" }, undefined as any);
    expect(result.content[0].text).toContain("Successfully wrote");
    expect(result.details).toEqual({ path: "out.txt", size: 5 });
    const content = await readFile(projectRoot, "out.txt");
    expect(content).toBe("hello");
  });

  it("overwrites an existing file", async () => {
    const tool = createWriteFileTool(projectRoot);
    await tool.execute("tc1", { path: "out.txt", content: "old" }, undefined as any);
    await tool.execute("tc1", { path: "out.txt", content: "new" }, undefined as any);
    const content = await readFile(projectRoot, "out.txt");
    expect(content).toBe("new");
  });

  it("creates parent directories by default", async () => {
    const tool = createWriteFileTool(projectRoot);
    await tool.execute("tc1", { path: "a/b/c/deep.txt", content: "deep" }, undefined as any);
    expect(await readFile(projectRoot, "a/b/c/deep.txt")).toBe("deep");
  });

  it("skips directory creation when createDirs is false", async () => {
    const tool = createWriteFileTool(projectRoot);
    await expect(
      tool.execute("tc1", { path: "no/such/dir/file.txt", content: "x", createDirs: false }, undefined as any),
    ).rejects.toThrow();
  });

  it("rejects path traversal", async () => {
    const tool = createWriteFileTool(projectRoot);
    await expect(
      tool.execute("tc1", { path: "../../escape.txt", content: "nope" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });
});
```

- [ ] **Step 2: 运行测试验证通过**

```bash
npx vitest run src/__tests__/tools/write-file.test.ts --workspace=packages/core
```

预期：5 个测试全部通过

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/tools/write-file.test.ts
git commit -m "test: add write_file tool tests"
```

---

## Task 4: edit_file tool 测试

**Files:**
- Create: `packages/core/src/__tests__/tools/edit-file.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEditFileTool } from "../../tools/edit-file.js";
import { createTempProject, cleanupDir, writeFile, readFile } from "../helpers.js";

describe("createEditFileTool", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("replaces a single occurrence", async () => {
    await writeFile(projectRoot, "code.ts", "const x = 1;\nconst y = 2;");
    const tool = createEditFileTool(projectRoot);
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
    const tool = createEditFileTool(projectRoot);
    await tool.execute(
      "tc1",
      { path: "a.txt", old_string: "remove this", new_string: "" },
      undefined as any,
    );
    expect(await readFile(projectRoot, "a.txt")).toBe("keep this");
  });

  it("returns error when old_string not found", async () => {
    await writeFile(projectRoot, "a.txt", "hello");
    const tool = createEditFileTool(projectRoot);
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
    const tool = createEditFileTool(projectRoot);
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
    const tool = createEditFileTool(projectRoot);
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
    const tool = createEditFileTool(projectRoot);
    const result = await tool.execute(
      "tc1",
      { path: "nope.txt", old_string: "a", new_string: "b" },
      undefined as any,
    );
    expect(result.content[0].text).toContain("file not found");
    expect(result.details).toBeUndefined();
  });

  it("rejects path traversal", async () => {
    const tool = createEditFileTool(projectRoot);
    await expect(
      tool.execute("tc1", { path: "../etc/hosts", old_string: "a", new_string: "b" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });
});
```

- [ ] **Step 2: 运行测试验证通过**

```bash
npx vitest run src/__tests__/tools/edit-file.test.ts --workspace=packages/core
```

预期：7 个测试全部通过

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/tools/edit-file.test.ts
git commit -m "test: add edit_file tool tests"
```

---

## Task 5: list_files tool 测试

**Files:**
- Create: `packages/core/src/__tests__/tools/list-files.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createListFilesTool } from "../../tools/list-files.js";
import { createTempProject, cleanupDir, writeFile, ensureDir } from "../helpers.js";

describe("createListFilesTool", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("lists files and directories flat", async () => {
    await writeFile(projectRoot, "a.txt", "a");
    await writeFile(projectRoot, "b.md", "b");
    await ensureDir(projectRoot, "subdir");
    const tool = createListFilesTool(projectRoot);
    const result = await tool.execute("tc1", { path: "." }, undefined as any);
    const text = result.content[0].text;
    expect(text).toContain("📄 a.txt");
    expect(text).toContain("📄 b.md");
    expect(text).toContain("📁 subdir");
    expect(result.details).toEqual({ path: ".", recursive: false, count: 3 });
  });

  it("lists recursively", async () => {
    await writeFile(projectRoot, "top.txt", "top");
    await writeFile(projectRoot, "sub/nested.txt", "nested");
    const tool = createListFilesTool(projectRoot);
    const result = await tool.execute("tc1", { path: ".", recursive: true }, undefined as any);
    const text = result.content[0].text;
    expect(text).toContain("📄 top.txt");
    expect(text).toContain("📄 nested.txt");
    expect(result.details?.recursive).toBe(true);
  });

  it("shows (empty directory) for empty dir", async () => {
    await ensureDir(projectRoot, "empty");
    const tool = createListFilesTool(projectRoot);
    const result = await tool.execute("tc1", { path: "empty" }, undefined as any);
    expect(result.content[0].text).toBe("(empty directory)");
  });

  it("returns error for non-existent directory", async () => {
    const tool = createListFilesTool(projectRoot);
    const result = await tool.execute("tc1", { path: "nope" }, undefined as any);
    expect(result.content[0].text).toContain("Directory not found");
    expect(result.details?.exists).toBe(false);
  });

  it("returns error when path is a file", async () => {
    await writeFile(projectRoot, "file.txt", "hi");
    const tool = createListFilesTool(projectRoot);
    const result = await tool.execute("tc1", { path: "file.txt" }, undefined as any);
    expect(result.content[0].text).toContain("Not a directory");
    expect(result.details?.isDirectory).toBe(false);
  });

  it("rejects path traversal", async () => {
    const tool = createListFilesTool(projectRoot);
    await expect(
      tool.execute("tc1", { path: "../../etc" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });
});
```

- [ ] **Step 2: 运行测试验证通过**

```bash
npx vitest run src/__tests__/tools/list-files.test.ts --workspace=packages/core
```

预期：6 个测试全部通过

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/tools/list-files.test.ts
git commit -m "test: add list_files tool tests"
```

---

## Task 6: search_content tool 测试

**Files:**
- Create: `packages/core/src/__tests__/tools/search-content.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { createSearchContentTool } from "../../tools/search-content.js";
import { createTempProject, cleanupDir, writeFile, ensureDir } from "../helpers.js";

describe("createSearchContentTool", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("finds matching lines across files", async () => {
    await writeFile(projectRoot, "a.txt", "hello world\nfoo bar");
    await writeFile(projectRoot, "b.txt", "hello universe");
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute("tc1", { query: "hello" }, undefined as any);
    const text = result.content[0].text as string;
    expect(text).toContain("hello world");
    expect(text).toContain("hello universe");
    expect(result.details?.matches).toBe(2);
  });

  it("performs case-insensitive search", async () => {
    await writeFile(projectRoot, "a.txt", "Hello World");
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute("tc1", { query: "hello" }, undefined as any);
    expect(result.details?.matches).toBe(1);
  });

  it("searches within a subdirectory", async () => {
    await writeFile(projectRoot, "top.txt", "match here");
    await writeFile(projectRoot, "sub/deep.txt", "match deep");
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute("tc1", { query: "match", path: "sub" }, undefined as any);
    expect(result.details?.matches).toBe(1);
    expect(result.content[0].text).toContain("deep.txt");
  });

  it("filters by includePatterns", async () => {
    await writeFile(projectRoot, "doc.md", "search me");
    await writeFile(projectRoot, "data.json", "search me too");
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute(
      "tc1",
      { query: "search", includePatterns: ["*.md"] },
      undefined as any,
    );
    expect(result.details?.matches).toBe(1);
    expect(result.content[0].text).toContain("doc.md");
  });

  it("skips dotfiles and node_modules", async () => {
    await writeFile(projectRoot, ".hidden/config", "secret match");
    await writeFile(projectRoot, "node_modules/pkg/index.js", "match in deps");
    await writeFile(projectRoot, "visible.txt", "match visible");
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute("tc1", { query: "match" }, undefined as any);
    expect(result.details?.matches).toBe(1);
  });

  it("returns no matches message when nothing found", async () => {
    await writeFile(projectRoot, "a.txt", "nothing relevant");
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute("tc1", { query: "missing" }, undefined as any);
    expect(result.content[0].text).toContain("No matches found");
    expect(result.details?.matches).toBe(0);
  });

  it("caps results at 100", async () => {
    for (let i = 0; i < 110; i++) {
      await writeFile(projectRoot, `file${i}.txt`, `match line`);
    }
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute("tc1", { query: "match" }, undefined as any);
    expect(result.details?.matches).toBe(100);
    expect(result.details?.truncated).toBe(true);
  });

  it("returns error for non-existent path", async () => {
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute("tc1", { query: "x", path: "nope" }, undefined as any);
    expect(result.content[0].text).toContain("Path not found");
  });
});
```

- [ ] **Step 2: 运行测试验证通过**

```bash
npx vitest run src/__tests__/tools/search-content.test.ts --workspace=packages/core
```

预期：8 个测试全部通过

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/tools/search-content.test.ts
git commit -m "test: add search_content tool tests"
```

---

## Task 7: append_changelog tool 测试

**Files:**
- Create: `packages/core/src/__tests__/tools/append-changelog.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAppendChangelogTool } from "../../tools/append-changelog.js";
import { createTempProject, cleanupDir, writeFile, readFile, pathExists } from "../helpers.js";

describe("createAppendChangelogTool", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("appends an entry to CHANGELOG.md", async () => {
    const tool = createAppendChangelogTool(projectRoot);
    const result = await tool.execute(
      "tc1",
      { agent: "writer", action: "create", target: "chapter1.md", description: "Created chapter 1" },
      undefined as any,
    );
    expect(result.content[0].text).toContain("Changelog entry appended");
    expect(result.details?.agent).toBe("writer");
    const content = await readFile(projectRoot, "CHANGELOG.md");
    expect(content).toContain("writer / create / `chapter1.md`");
    expect(content).toContain("Created chapter 1");
  });

  it("appends multiple entries in order", async () => {
    const tool = createAppendChangelogTool(projectRoot);
    await tool.execute(
      "tc1",
      { agent: "a", action: "create", target: "x", description: "first" },
      undefined as any,
    );
    await tool.execute(
      "tc1",
      { agent: "b", action: "update", target: "y", description: "second" },
      undefined as any,
    );
    const content = await readFile(projectRoot, "CHANGELOG.md");
    const firstIdx = content.indexOf("first");
    const secondIdx = content.indexOf("second");
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it("creates parent directories if needed", async () => {
    const tool = createAppendChangelogTool(projectRoot, "logs/CHANGELOG.md");
    await tool.execute(
      "tc1",
      { agent: "a", action: "create", target: "x", description: "test" },
      undefined as any,
    );
    expect(pathExists(projectRoot, "logs/CHANGELOG.md")).toBe(true);
  });

  it("rejects path traversal on custom changelog path", async () => {
    const tool = createAppendChangelogTool(projectRoot, "../../etc/evil.md");
    await expect(
      tool.execute(
        "tc1",
        { agent: "a", action: "x", target: "x", description: "x" },
        undefined as any,
      ),
    ).rejects.toThrow("Path traversal denied");
  });
});
```

- [ ] **Step 2: 运行测试验证通过**

```bash
npx vitest run src/__tests__/tools/append-changelog.test.ts --workspace=packages/core
```

预期：4 个测试全部通过

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/tools/append-changelog.test.ts
git commit -m "test: add append_changelog tool tests"
```

---

## Task 8: load_skill tool 测试

**Files:**
- Create: `packages/core/src/__tests__/tools/load-skill.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLoadSkillTool } from "../../tools/load-skill.js";
import { createTempProject, cleanupDir, writeFile } from "../helpers.js";

describe("createLoadSkillTool", () => {
  let skillDir: string;

  beforeEach(async () => {
    const tmpRoot = await createTempProject();
    skillDir = tmpRoot;
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
    const tool = createLoadSkillTool(skillDir);
    const result = await tool.execute("tc1", { skill_name: "brainstorming" }, undefined as any);
    expect(result.content[0].text).toContain("Skill: brainstorming");
    expect(result.content[0].text).toContain("Do creative brainstorming here.");
    expect(result.details).toEqual({ name: "brainstorming" });
  });

  it("returns error for non-existent skill", async () => {
    const tool = createLoadSkillTool(skillDir);
    const result = await tool.execute("tc1", { skill_name: "missing" }, undefined as any);
    expect(result.content[0].text).toContain('skill "missing" not found');
    expect(result.details).toBeUndefined();
  });

  it("returns error for skill without SKILL.md", async () => {
    await writeFile(skillDir, "empty-dir/placeholder.txt", "");
    const tool = createLoadSkillTool(skillDir);
    const result = await tool.execute("tc1", { skill_name: "empty-dir" }, undefined as any);
    expect(result.content[0].text).toContain("not found");
  });
});
```

- [ ] **Step 2: 运行测试验证通过**

```bash
npx vitest run src/__tests__/tools/load-skill.test.ts --workspace=packages/core
```

预期：3 个测试全部通过

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/tools/load-skill.test.ts
git commit -m "test: add load_skill tool tests"
```

---

## Task 9: SessionStore 测试

**Files:**
- Create: `packages/core/src/__tests__/store/session.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { SessionStore } from "../../store/session.js";

describe("SessionStore", () => {
  let store: SessionStore;
  let dbPath: string;

  beforeEach(async () => {
    store = new SessionStore();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wb-session-"));
    dbPath = path.join(tmpDir, "test.db");
    await store.init(dbPath);
  });

  afterEach(() => {
    store.close();
  });

  it("creates and retrieves a session", () => {
    const id = store.createSession("agent-1", "Test Session");
    const session = store.getSession(id);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(id);
    expect(session!.agentId).toBe("agent-1");
    expect(session!.title).toBe("Test Session");
    expect(session!.status).toBe("active");
  });

  it("creates session without title", () => {
    const id = store.createSession("agent-1");
    const session = store.getSession(id);
    expect(session!.title).toBeUndefined();
  });

  it("returns null for non-existent session", () => {
    expect(store.getSession("no-such-id")).toBeNull();
  });

  it("lists sessions", () => {
    store.createSession("agent-1", "First");
    store.createSession("agent-1", "Second");
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(2);
  });

  it("lists sessions filtered by agentId", () => {
    store.createSession("agent-1", "A1");
    store.createSession("agent-2", "A2");
    const sessions = store.listSessions("agent-1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].agentId).toBe("agent-1");
  });

  it("archives a session", () => {
    const id = store.createSession("agent-1", "To Archive");
    store.archiveSession(id);
    const session = store.getSession(id);
    expect(session!.status).toBe("archived");
    const active = store.listSessions();
    expect(active).toHaveLength(0);
  });

  it("archives all sessions by agentId", () => {
    store.createSession("agent-1", "S1");
    store.createSession("agent-1", "S2");
    store.createSession("agent-2", "S3");
    store.archiveByAgentId("agent-1");
    const active = store.listSessions();
    expect(active).toHaveLength(1);
    expect(active[0].agentId).toBe("agent-2");
  });

  it("appends and retrieves messages", () => {
    const id = store.createSession("agent-1");
    store.appendMessage(id, { role: "user", content: "hello", timestamp: 1000 });
    store.appendMessage(id, { role: "assistant", content: "world", timestamp: 2000 });
    const messages = store.getSessionMessages(id);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("hello");
    expect(messages[1].content).toBe("world");
  });

  it("updates session updated_at on message append", () => {
    const id = store.createSession("agent-1");
    const before = store.getSession(id)!.updatedAt;
    store.appendMessage(id, { role: "user", content: "hi", timestamp: Date.now() });
    const after = store.getSession(id)!.updatedAt;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("updates session title", () => {
    const id = store.createSession("agent-1", "Old Title");
    store.updateSessionTitle(id, "New Title");
    const session = store.getSession(id);
    expect(session!.title).toBe("New Title");
  });
});
```

- [ ] **Step 2: 运行测试验证通过**

```bash
npx vitest run src/__tests__/store/session.test.ts --workspace=packages/core
```

预期：10 个测试全部通过

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/store/session.test.ts
git commit -m "test: add SessionStore tests"
```

---

## Task 10: ProjectStore 测试

**Files:**
- Create: `packages/core/src/__tests__/store/project.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProjectStore } from "../../store/project.js";
import { createTempProject, cleanupDir, readFile, pathExists, writeFile } from "../helpers.js";

describe("ProjectStore", () => {
  let projectRoot: string;
  let store: ProjectStore;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    store = new ProjectStore(projectRoot);
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("creates a project with all default files", async () => {
    const config = await store.create("TestProject", "gemini-2.5-pro");
    expect(config.name).toBe("TestProject");
    expect(config.defaultModel).toBe("gemini-2.5-pro");
    expect(config.paths.agents).toBe("agents");
    expect(pathExists(projectRoot, ".spherse/project.yaml")).toBe(true);
    expect(pathExists(projectRoot, ".spherse/agents")).toBe(true);
    expect(pathExists(projectRoot, "AGENTS.md")).toBe(true);
    expect(pathExists(projectRoot, "CHANGELOG.md")).toBe(true);
  });

  it("opens an existing project", async () => {
    await store.create("MyProject", "deepseek-v4-pro");
    const store2 = new ProjectStore(projectRoot);
    const config = await store2.open();
    expect(config.name).toBe("MyProject");
    expect(config.defaultModel).toBe("deepseek-v4-pro");
  });

  it("throws when opening non-existent project", async () => {
    await expect(store.open()).rejects.toThrow("project.yaml not found");
  });

  it("returns null config before create/open", () => {
    expect(store.getConfig()).toBeNull();
  });

  it("returns root path", () => {
    expect(store.getRootPath()).toBe(projectRoot);
  });

  it("reads and updates index", async () => {
    await store.create("P", "m");
    const index = await store.readIndex();
    expect(index).toContain("世界观项目");
    await store.updateIndex("# Updated Index");
    expect(await store.readIndex()).toBe("# Updated Index");
  });

  it("appends changelog entries", async () => {
    await store.create("P", "m");
    await store.appendChangelog({
      agent: "writer",
      action: "create",
      target: "ch1.md",
      description: "Created chapter 1",
    });
    const content = await readFile(projectRoot, "CHANGELOG.md");
    expect(content).toContain("writer / create / `ch1.md`");
    expect(content).toContain("Created chapter 1");
  });
});
```

- [ ] **Step 2: 运行测试验证通过**

```bash
npx vitest run src/__tests__/store/project.test.ts --workspace=packages/core
```

预期：7 个测试全部通过

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/store/project.test.ts
git commit -m "test: add ProjectStore tests"
```

---

## Task 11: AgentProfileStore 测试

**Files:**
- Create: `packages/core/src/__tests__/store/agent-profile.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentProfileStore } from "../../store/agent-profile.js";
import { createTempProject, cleanupDir, writeFile, ensureDir } from "../helpers.js";

describe("AgentProfileStore", () => {
  let agentDir: string;
  let store: AgentProfileStore;

  beforeEach(async () => {
    const tmp = await createTempProject();
    agentDir = tmp + "/agents";
    await ensureDir(tmp, "agents");
    store = new AgentProfileStore(agentDir);
  });

  afterEach(async () => {
    await cleanupDir(agentDir.replace("/agents", ""));
  });

  const VALID_PROFILE = `---
name: World Builder
type: assistant
model: gemini-2.5-pro
tools:
  - read_file
  - write_file
---

You are a world building assistant.`;

  it("lists profiles from markdown files", async () => {
    await writeFile(agentDir, "builder.md", VALID_PROFILE);
    const profiles = await store.list();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("World Builder");
    expect(profiles[0].type).toBe("assistant");
    expect(profiles[0].systemPrompt).toContain("world building assistant");
  });

  it("gets profile by id", async () => {
    await writeFile(agentDir, "builder.md", VALID_PROFILE);
    const profiles = await store.list();
    const id = profiles[0].id;
    const profile = await store.getById(id);
    expect(profile!.name).toBe("World Builder");
  });

  it("gets profile by name", async () => {
    await writeFile(agentDir, "builder.md", VALID_PROFILE);
    const profile = await store.getByName("World Builder");
    expect(profile).not.toBeNull();
    expect(profile!.type).toBe("assistant");
  });

  it("returns null for non-existent id/name", async () => {
    expect(await store.getById("nope")).toBeNull();
    expect(await store.getByName("nope")).toBeNull();
  });

  it("saves a new profile", async () => {
    const profile = await store.save("new-agent.md", VALID_PROFILE);
    expect(profile.name).toBe("World Builder");
    expect(profile.id).toBeDefined();
    const profiles = await store.list();
    expect(profiles).toHaveLength(1);
  });

  it("deletes a profile by id", async () => {
    await writeFile(agentDir, "builder.md", VALID_PROFILE);
    const profiles = await store.list();
    await store.delete(profiles[0].id);
    const remaining = await store.list();
    expect(remaining).toHaveLength(0);
  });

  it("skips files without required frontmatter fields", async () => {
    await writeFile(agentDir, "bad.md", "---\nname: NoType\n---\ncontent");
    const profiles = await store.list();
    expect(profiles).toHaveLength(0);
  });

  it("returns empty list for empty directory", async () => {
    const profiles = await store.list();
    expect(profiles).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试验证通过**

```bash
npx vitest run src/__tests__/store/agent-profile.test.ts --workspace=packages/core
```

预期：8 个测试全部通过

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/store/agent-profile.test.ts
git commit -m "test: add AgentProfileStore tests"
```

---

## Task 12: SkillStore 测试

**Files:**
- Create: `packages/core/src/__tests__/store/skill.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
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
```

- [ ] **Step 2: 运行测试验证通过**

```bash
npx vitest run src/__tests__/store/skill.test.ts --workspace=packages/core
```

预期：6 个测试全部通过

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/store/skill.test.ts
git commit -m "test: add SkillStore tests"
```

---

## Task 13: 全量测试验证 + 文档更新

**Files:**
- Modify: `docs/dev/backlog.md`
- Modify: `docs/official/project-structure.md`（如有必要）

- [ ] **Step 1: 运行全部测试**

```bash
npm run test --workspace=packages/core
```

预期：全部测试通过，无报错

- [ ] **Step 2: 更新 backlog.md**

在 `基础设施` 部分新增条目：

```markdown
- [ ] **packages/server 集成测试**：为 Fastify API 路由添加集成测试
- [ ] **packages/app 组件测试**：为 React 组件添加 Testing Library 测试
```

- [ ] **Step 3: 检查 `docs/official/project-structure.md` 是否需要同步更新测试目录结构**

如果 `project-structure.md` 中有 `packages/core/` 的目录树描述，补充 `__tests__/` 目录说明。

- [ ] **Step 4: Commit**

```bash
git add docs/dev/backlog.md
git commit -m "docs: update backlog with testing plan"
```

---

## Summary

| Task | 测试目标 | 预计测试数量 |
|------|---------|------------|
| 1 | Vitest 基础设施 | 0（搭建） |
| 2 | read_file tool | 5 |
| 3 | write_file tool | 5 |
| 4 | edit_file tool | 7 |
| 5 | list_files tool | 6 |
| 6 | search_content tool | 8 |
| 7 | append_changelog tool | 4 |
| 8 | load_skill tool | 3 |
| 9 | SessionStore | 10 |
| 10 | ProjectStore | 7 |
| 11 | AgentProfileStore | 8 |
| 12 | SkillStore | 6 |
| 13 | 全量验证 + 文档 | 0 |
| **Total** | | **~74 tests** |
