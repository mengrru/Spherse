# @spherse/presets Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `@spherse/presets` package to hold agent template and future static content, replacing the hardcoded template in AgentDialog.tsx.

**Architecture:** New npm workspace package `packages/presets`. Templates stored as `.md` files in `templates/`, a `prebuild` script (`sync-templates.mjs`) generates `.ts` constant exports into `src/generated/`. Consumers import synchronously.

**Tech Stack:** TypeScript (ESM), Node.js fs/path, tsc

---

### Task 1: Scaffold the presets package

**Files:**
- Create: `packages/presets/package.json`
- Create: `packages/presets/tsconfig.json`
- Create: `packages/presets/.gitignore`
- Create: `packages/presets/templates/agent-template.md`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@spherse/presets",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "templates"],
  "scripts": {
    "prebuild": "node scripts/sync-templates.mjs",
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create .gitignore**

```
src/generated/
```

- [ ] **Step 4: Create templates/agent-template.md**

```
---
name: 新 Agent
model: gemini-2.5-pro
type: creator
tools:
  - read_file
  - write_file
  - edit_file
  - list_files
  - search_content
  - append_changelog
context: []
---

# 系统提示

你是一个世界观创作助手。

## 创作风格

- 保持与已有设定的一致性
```

(Note: the file should end with a trailing newline)

- [ ] **Step 5: Create placeholder src/index.ts**

```typescript
export { AGENT_TEMPLATE } from "./generated/agent-template.js";
```

- [ ] **Step 6: Verify workspace detects the package**

Run: `npm ls @spherse/presets --depth=0 2>&1 | head -5`
Expected: Shows `@spherse/presets@0.1.0`

---

### Task 2: Create sync-templates script

**Files:**
- Create: `packages/presets/scripts/sync-templates.mjs`

- [ ] **Step 1: Create the script**

```javascript
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, "..", "templates");
const generatedDir = join(__dirname, "..", "src", "generated");

mkdirSync(generatedDir, { recursive: true });

const mapping = [
  ["agent-template.md", "AGENT_TEMPLATE", "agent-template.ts"],
];

for (const [sourceFile, constName, outFile] of mapping) {
  const content = readFileSync(join(templatesDir, sourceFile), "utf-8");
  const tsContent = `export const ${constName} = ${JSON.stringify(content)};\n`;
  writeFileSync(join(generatedDir, outFile), tsContent, "utf-8");
  console.log(`synced: templates/${sourceFile} → src/generated/${outFile} (${constName})`);
}
```

- [ ] **Step 2: Run the script and verify output**

Run: `node packages/presets/scripts/sync-templates.mjs`
Expected: `synced: templates/agent-template.md → src/generated/agent-template.ts (AGENT_TEMPLATE)`

Then verify the generated file:
Run: `cat packages/presets/src/generated/agent-template.ts`
Expected: `export const AGENT_TEMPLATE = "---\nname: 新 Agent\n...";`

---

### Task 3: Build the presets package and wire up consumers

**Files:**
- Modify: `packages/app/package.json` — add `@spherse/presets` dependency
- Modify: `packages/app/src/components/AgentDialog.tsx` — import from presets

- [ ] **Step 1: Build the presets package**

Run: `npm run build --workspace=packages/presets`
Expected: Compiles successfully, `dist/index.js` and `dist/index.d.ts` exist

- [ ] **Step 2: Add dependency to app package**

In `packages/app/package.json`, add `"@spherse/presets": "*"` to the `dependencies` object (after `"@spherse/server": "*"`).

- [ ] **Step 3: Run npm install to link workspace package**

Run: `npm install`

- [ ] **Step 4: Update AgentDialog.tsx**

In `packages/app/src/components/AgentDialog.tsx`:

Remove lines 3-24 (the `const AGENT_TEMPLATE = ...` block and trailing empty line).

Add import at line 1:
```typescript
import { AGENT_TEMPLATE } from "@spherse/presets";
```

The component should remain otherwise unchanged.

- [ ] **Step 5: Build the app package to verify**

Run: `npm run build --workspace=packages/app`
Expected: Compiles successfully

---

### Task 4: Update docs and verify

**Files:**
- Modify: `docs/official/project-structure.md` — add presets package to directory index
- Modify: `docs/dev/backlog.md` — no backlog entry for this, but check if needed

- [ ] **Step 1: Update project-structure.md**

After the `packages/core/` section (after line 30 in the current file) and before the `packages/server/` section, insert:

```
│   ├── presets/                     # @spherse/presets — 预置静态内容（模板、预置 skill）
│   │   ├── templates/               # 模板源文件（.md 格式）
│   │   │   └── agent-template.md    # 新 Agent 创建模板
│   │   ├── scripts/
│   │   │   └── sync-templates.mjs   # 模板同步脚本（.md → .ts 常量）
│   │   └── src/
│   │       ├── index.ts             # 公开导出
│   │       └── generated/           # 自动生成的 .ts 常量（git 忽略）
```

- [ ] **Step 2: Final verification — build all packages**

Run: `npm run build`
Expected: All packages compile successfully

- [ ] **Step 3: Commit**

```bash
git add packages/presets/ packages/app/package.json packages/app/src/components/AgentDialog.tsx docs/official/project-structure.md
git commit -m "feat: extract agent template into @spherse/presets package"
```
