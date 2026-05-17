# Agent Context 预注入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `buildAgent()`, read files listed in `profile.context` and inject their content into systemPrompt, so the agent has context from the first turn.

**Architecture:** Extract a pure async function `readContextFiles(projectRoot, contextPaths)` that handles file reading, path safety, and formatting. Call it from `buildAgent()` in engine.ts. Test the function in isolation using temp directories.

**Tech Stack:** TypeScript (ESM), Node.js fs, Vitest

---

### Task 1: Write failing tests for readContextFiles

**Files:**
- Create: `packages/core/src/__tests__/engine/read-context-files.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

  it("skips path traversal attempts", async () => {
    const result = await readContextFiles(projectRoot, [
      "../../../etc/passwd",
    ]);
    expect(result).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- --run packages/core/src/__tests__/engine/read-context-files.test.ts`
Expected: FAIL — module `../../engine/read-context-files.js` not found

---

### Task 2: Implement readContextFiles

**Files:**
- Create: `packages/core/src/engine/read-context-files.ts`

- [ ] **Step 1: Implement the function**

```typescript
import fs from "node:fs/promises";
import path from "node:path";

export async function readContextFiles(
  projectRoot: string,
  contextPaths: string[] | undefined,
): Promise<string> {
  if (!contextPaths || contextPaths.length === 0) return "";

  const sections: string[] = [];

  for (const relPath of contextPaths) {
    const resolved = path.resolve(projectRoot, relPath);
    if (!resolved.startsWith(projectRoot + path.sep) && resolved !== projectRoot) {
      continue;
    }

    try {
      const content = await fs.readFile(resolved, "utf-8");
      sections.push(
        `<context-file path="${relPath}">\n${content}\n</context-file>`,
      );
    } catch {
      continue;
    }
  }

  if (sections.length === 0) return "";
  return `\n\n## Pre-loaded Context\n\n${sections.join("\n\n")}`;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- --run packages/core/src/__tests__/engine/read-context-files.test.ts`
Expected: All tests PASS

---

### Task 3: Integrate readContextFiles into buildAgent

**Files:**
- Modify: `packages/core/src/engine.ts` (lines 1, 168-176)

- [ ] **Step 1: Add import for readContextFiles**

In `packages/core/src/engine.ts`, add the import at line 12 (after the existing imports):

```typescript
import { readContextFiles } from "./engine/read-context-files.js";
```

- [ ] **Step 2: Add context injection after skill catalog injection**

In `buildAgent()`, after line 176 (the skill catalog block), add:

```typescript
    const contextSection = await readContextFiles(
      projectRoot,
      profile.context,
    );
    if (contextSection) {
      systemPrompt += contextSection;
    }
```

- [ ] **Step 3: Run all existing tests to ensure no regressions**

Run: `npm test --workspace=packages/core`
Expected: All tests PASS

---

### Task 4: Verify and commit

- [ ] **Step 1: Run full test suite**

Run: `npm test --workspace=packages/core`
Expected: All tests PASS

- [ ] **Step 2: Run TypeScript type check**

Run: `npx tsc --noEmit --project packages/core/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Update docs/dev/backlog.md line 31 status**

Change `- [ ]` to `- [x]` for the Agent context 预注入 entry.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/engine.ts packages/core/src/engine/read-context-files.ts packages/core/src/__tests__/engine/read-context-files.test.ts docs/dev/backlog.md
git commit -m "feat: implement agent context pre-injection from profile.context field"
```
