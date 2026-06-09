# 预设 Skill 和 Agent 自动注入 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 项目首次创建时，自动从 `@spherse/presets` 注入预设 skill 和 agent，使用户开箱即用。

**Architecture:** 在 `@spherse/presets` 中通过 `presets.yaml` 声明预设列表，`sync-templates.mjs` 将其和 skill 源文件打包为 TypeScript 常量导出。`@spherse/core` 的 `factory.ts` 在新项目创建后调用 `initPresets()` 完成注入。

**Tech Stack:** TypeScript (ESM), Node.js fs, YAML, gray-matter, Vitest

---

### Task 1: 新增 `presets.yaml` 配置文件

**Files:**
- Create: `packages/presets/presets.yaml`

- [ ] **Step 1: 创建配置文件**

```yaml
presetSkills:
  - dir: create-ui-theme
  - dir: create-agent-chat-theme

presetAgents:
  - name: 世界观创作
    slug: world-building
```

- [ ] **Step 2: Commit**

```bash
git add packages/presets/presets.yaml
git commit -m "feat(presets): add presets.yaml config for preset skills and agents"
```

---

### Task 2: 扩展 `sync-templates.mjs` 生成预设常量

**Files:**
- Modify: `packages/presets/scripts/sync-templates.mjs`

- [ ] **Step 1: 扩展脚本，新增 presets.yaml 和 skill 目录的生成逻辑**

在现有 `mapping` 循环之后，追加以下逻辑：

```javascript
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, "..", "templates");
const generatedDir = join(__dirname, "..", "src", "generated");
const presetsPath = join(__dirname, "..", "presets.yaml");
const skillsDir = join(__dirname, "..", "skills");

mkdirSync(generatedDir, { recursive: true });

// ... existing mapping code stays above ...

// Generate presets.ts
const presetsContent = readFileSync(presetsPath, "utf-8");
const presets = YAML.parse(presetsContent);

const presetSkillsTs = `export const PRESET_SKILLS = ${JSON.stringify(presets.presetSkills, null, 2)};\n\n`;
const presetAgentsTs = `export const PRESET_AGENTS = ${JSON.stringify(presets.presetAgents, null, 2)};\n`;
writeFileSync(join(generatedDir, "presets.ts"), presetSkillsTs + presetAgentsTs, "utf-8");
console.log("synced: presets.yaml → src/generated/presets.ts");

// Validate: all declared skill dirs must exist
for (const skill of presets.presetSkills) {
  const skillPath = join(skillsDir, skill.dir);
  if (!statSync(skillPath).isDirectory()) {
    console.error(`ERROR: preset skill dir not found: ${skill.dir}`);
    process.exit(1);
  }
}

// Generate preset-skills.ts
function readDirRecursive(dir, base) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...readDirRecursive(fullPath, base));
    } else {
      files.push({
        relativePath: relative(base, fullPath),
        content: readFileSync(fullPath, "utf-8"),
      });
    }
  }
  return files;
}

const skillSources = presets.presetSkills.map((skill) => {
  const skillPath = join(skillsDir, skill.dir);
  const files = readDirRecursive(skillPath, skillPath);
  return { dir: skill.dir, files };
});

const presetSkillsSourcesTs = `export const PRESET_SKILL_SOURCES = ${JSON.stringify(skillSources, null, 2)};\n`;
writeFileSync(join(generatedDir, "preset-skills.ts"), presetSkillsSourcesTs, "utf-8");
console.log("synced: skills/ → src/generated/preset-skills.ts");
```

注意：脚本顶部需要新增 `import YAML from "yaml"`，而 `yaml` 已经是 presets 的 sibling package `@spherse/core` 的依赖。由于 `sync-templates.mjs` 是 Node.js 脚本而非 TypeScript，需要直接使用 `yaml` npm 包。检查 `packages/presets/` 是否有 `yaml` 依赖——如果没有，需要安装。

实际上 `sync-templates.mjs` 是 `.mjs` 文件在 `prebuild` 时由 Node 直接运行，不经过 tsc。可以用 `JSON.parse` + 手写解析替代 YAML 依赖，但 `presets.yaml` 的格式足够简单，可以直接用正则或手写解析。**更简单的方案**：因为 `presets.yaml` 格式固定且简单，直接用 Node 内置能力解析。

但如果要避免引入新依赖，可以改为将 presets 配置改为 `presets.json` 格式。这更简单且不需要额外依赖。**决定：将 `presets.yaml` 改为 `presets.json`**，这样 sync 脚本只需 `JSON.parse(readFileSync(...))`。

**更新 Task 1 的文件为 `presets.json`：**

```json
{
  "presetSkills": [
    { "dir": "create-ui-theme" },
    { "dir": "create-agent-chat-theme" }
  ],
  "presetAgents": [
    { "name": "世界观创作", "slug": "world-building" }
  ]
}
```

那么 sync-templates.mjs 的新增部分为：

```javascript
const presetsPath = join(__dirname, "..", "presets.json");
const skillsDir = join(__dirname, "..", "skills");

const presets = JSON.parse(readFileSync(presetsPath, "utf-8"));

const presetSkillsTs = `export const PRESET_SKILLS = ${JSON.stringify(presets.presetSkills, null, 2)};\n\nexport const PRESET_AGENTS = ${JSON.stringify(presets.presetAgents, null, 2)};\n`;
writeFileSync(join(generatedDir, "presets.ts"), presetSkillsTs, "utf-8");
console.log("synced: presets.json → src/generated/presets.ts");

for (const skill of presets.presetSkills) {
  const skillPath = join(skillsDir, skill.dir);
  if (!statSync(skillPath).isDirectory()) {
    console.error(`ERROR: preset skill dir not found: ${skill.dir}`);
    process.exit(1);
  }
}

function readDirRecursive(dir, base) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...readDirRecursive(fullPath, base));
    } else {
      files.push({
        relativePath: relative(base, fullPath),
        content: readFileSync(fullPath, "utf-8"),
      });
    }
  }
  return files;
}

const skillSources = presets.presetSkills.map((skill) => {
  const skillPath = join(skillsDir, skill.dir);
  const files = readDirRecursive(skillPath, skillPath);
  return { dir: skill.dir, files };
});

const presetSkillsSourcesTs = `export const PRESET_SKILL_SOURCES = ${JSON.stringify(skillSources, null, 2)};\n`;
writeFileSync(join(generatedDir, "preset-skills.ts"), presetSkillsSourcesTs, "utf-8");
console.log("synced: skills/ → src/generated/preset-skills.ts");
```

- [ ] **Step 2: 运行 prebuild 验证生成**

Run: `npm run prebuild --workspace=packages/presets`
Expected: 输出包含 `synced: presets.json → src/generated/presets.ts` 和 `synced: skills/ → src/generated/preset-skills.ts`，且 `src/generated/presets.ts` 和 `src/generated/preset-skills.ts` 文件已生成

- [ ] **Step 3: 验证生成的文件内容正确**

Run: `cat packages/presets/src/generated/presets.ts`
Expected: 包含 `PRESET_SKILLS` 和 `PRESET_AGENTS` 导出

Run: `cat packages/presets/src/generated/preset-skills.ts`
Expected: 包含 `PRESET_SKILL_SOURCES` 导出，每个 skill 包含完整的文件列表和内容

- [ ] **Step 4: Commit**

```bash
git add packages/presets/scripts/sync-templates.mjs packages/presets/src/generated/
git commit -m "feat(presets): generate preset config and skill sources in sync-templates"
```

---

### Task 3: 扩展 `@spherse/presets` 导出

**Files:**
- Modify: `packages/presets/src/index.ts`

- [ ] **Step 1: 新增导出**

```typescript
export { AGENT_TEMPLATE } from "./generated/agent-template.js";
export { AGENT_THEME_TEMPLATE } from "./generated/agent-theme-template.js";
export { PRESET_SKILLS, PRESET_AGENTS } from "./generated/presets.js";
export { PRESET_SKILL_SOURCES } from "./generated/preset-skills.js";
```

- [ ] **Step 2: 构建验证**

Run: `npm run build --workspace=packages/presets`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add packages/presets/src/index.ts
git commit -m "feat(presets): export preset config and skill sources"
```

---

### Task 4: 编写 `initPresets()` 及其测试

**Files:**
- Create: `packages/core/src/presets.ts`
- Create: `packages/core/src/__tests__/presets.test.ts`
- Modify: `packages/core/package.json` (添加 `@spherse/presets` 依赖)

- [ ] **Step 1: 在 core 的 package.json 中添加 @spherse/presets 依赖**

在 `packages/core/package.json` 的 `dependencies` 中添加：

```json
"@spherse/presets": "^0.1.0"
```

- [ ] **Step 2: 编写测试**

`packages/core/src/__tests__/presets.test.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentProfileStore } from "../store/agent-profile.js";
import { PRESET_SKILL_SOURCES, PRESET_AGENTS, AGENT_TEMPLATE } from "@spherse/presets";
import { createTempProject, cleanupDir, pathExists, readFile } from "./helpers.js";

describe("initPresets", () => {
  let projectRoot: string;
  let spherseDir: string;
  let agentDir: string;
  let profileStore: AgentProfileStore;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    spherseDir = path.join(projectRoot, ".spherse");
    agentDir = path.join(spherseDir, "agents");
    await fs.mkdir(agentDir, { recursive: true });
    profileStore = new AgentProfileStore(agentDir);
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("copies all preset skills to .spherse/skills/", async () => {
    const { initPresets } = await import("../presets.js");
    await initPresets(projectRoot, spherseDir, profileStore);

    for (const skill of PRESET_SKILL_SOURCES) {
      for (const file of skill.files) {
        expect(pathExists(projectRoot, `.spherse/skills/${skill.dir}/${file.relativePath}`)).toBe(true);
        const content = await readFile(projectRoot, `.spherse/skills/${skill.dir}/${file.relativePath}`);
        expect(content).toBe(file.content);
      }
    }
  });

  it("creates preset agents with correct names", async () => {
    const { initPresets } = await import("../presets.js");
    await initPresets(projectRoot, spherseDir, profileStore);

    const profiles = await profileStore.list();
    expect(profiles.length).toBeGreaterThanOrEqual(PRESET_AGENTS.length);

    for (const presetAgent of PRESET_AGENTS) {
      const profile = profiles.find((p) => p.name === presetAgent.name);
      expect(profile).toBeDefined();
      expect(profile!.slug).toMatch(new RegExp(`^${presetAgent.slug}-[a-f0-9]{6}$`));
    }
  });

  it("does not throw when called on empty project", async () => {
    const { initPresets } = await import("../presets.js");
    await expect(initPresets(projectRoot, spherseDir, profileStore)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test --workspace=packages/core -- --reporter=verbose src/__tests__/presets.test.ts`
Expected: FAIL — `../presets.js` 模块不存在

- [ ] **Step 4: 实现 `initPresets()`**

`packages/core/src/presets.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { PRESET_SKILL_SOURCES, PRESET_AGENTS, AGENT_TEMPLATE } from "@spherse/presets";
import type { AgentProfileStore } from "./store/agent-profile.js";
import type { Logger } from "./logger.js";

export async function initPresets(
  projectRoot: string,
  spherseDir: string,
  profileStore: AgentProfileStore,
  logger?: Logger,
): Promise<void> {
  for (const skill of PRESET_SKILL_SOURCES) {
    try {
      const skillDir = path.join(spherseDir, "skills", skill.dir);
      for (const file of skill.files) {
        const filePath = path.join(skillDir, file.relativePath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.content, "utf-8");
      }
      logger?.info({ skill: skill.dir }, "preset skill copied");
    } catch (err) {
      logger?.warn({ skill: skill.dir, err }, "failed to copy preset skill");
    }
  }

  for (const agent of PRESET_AGENTS) {
    try {
      const content = AGENT_TEMPLATE.replace("name: 新 Agent", `name: ${agent.name}`);
      await profileStore.save(agent.slug, content);
      logger?.info({ agent: agent.name }, "preset agent created");
    } catch (err) {
      logger?.warn({ agent: agent.name, err }, "failed to create preset agent");
    }
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test --workspace=packages/core -- --reporter=verbose src/__tests__/presets.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/presets.ts packages/core/src/__tests__/presets.test.ts packages/core/package.json
git commit -m "feat(core): add initPresets() with skill copy and agent creation"
```

---

### Task 5: 修改 `factory.ts` 集成 `initPresets()`

**Files:**
- Modify: `packages/core/src/factory.ts`

- [ ] **Step 1: 修改 `createEngine()` 在新项目创建后调用 `initPresets()`**

```typescript
import path from "node:path";
import { PROJECT_META_DIR } from "./types.js";
import { ProjectStore } from "./store/project.js";
import { SessionStore } from "./store/session.js";
import { AgentProfileStore } from "./store/agent-profile.js";
import { SkillStore } from "./store/skill.js";
import { Engine } from "./engine.js";
import { initPresets } from "./presets.js";
import type { Logger } from "./logger.js";

export async function createEngine(
  projectRoot: string,
  options?: { projectName?: string; defaultModel?: string; logger?: Logger },
): Promise<{ engine: Engine; projectStore: ProjectStore }> {
  const projectStore = new ProjectStore(projectRoot, options?.logger);
  let isNewProject = false;
  try {
    await projectStore.open();
  } catch {
    const dirName = path.basename(path.resolve(projectRoot));
    await projectStore.create(
      options?.projectName ?? dirName,
      options?.defaultModel ?? "gemini-2.5-pro",
    );
    isNewProject = true;
  }

  const config = projectStore.getConfig()!;
  const spherseDir = path.join(projectRoot, PROJECT_META_DIR);
  const profileStore = new AgentProfileStore(
    path.join(spherseDir, config.paths.agents),
  );

  const skillStore = new SkillStore(path.join(spherseDir, "skills"));

  if (isNewProject) {
    await initPresets(projectRoot, spherseDir, profileStore, options?.logger);
  }

  const sessionStore = new SessionStore(options?.logger);
  await sessionStore.init(path.join(spherseDir, "sessions.db"));

  const engine = new Engine(profileStore, sessionStore, projectStore, skillStore, {
    defaultModel: options?.defaultModel,
    logger: options?.logger,
  });

  return { engine, projectStore };
}
```

- [ ] **Step 2: 运行全部 core 测试确认无回归**

Run: `npm test --workspace=packages/core`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/factory.ts
git commit -m "feat(core): call initPresets() on new project creation"
```

---

### Task 6: 全量构建与 lint 验证

- [ ] **Step 1: 全量构建**

Run: `npm run build`
Expected: 全部 package 编译成功

- [ ] **Step 2: Lint 检查**

Run: `npm run lint`
Expected: 无错误
