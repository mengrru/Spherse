# [Bugfix] Skill 附加文件发现 — 实施计划

> **For agentic workers:** 使用 subagent-driven-development 实现。步骤用 checkbox（`- [ ]`）跟踪。详见 design doc。

**Goal:** 让 LLM 能发现 project skill 目录下的附加文件（`references/*`、`scripts/*` 等）并读取它们。

**Design doc:** `docs/dev/bugfix/2026-06-28-skill-companion-files-discovery/design.md`

**Tech Stack:** TypeScript ESM (strict), pi-agent-core, @sinclair/typebox, vitest

**Scope:** 仅 project skill（磁盘 `.spherse/skills/<name>/`，`skills` 路径分类已可读）。不新增工具、不改访问策略。

**依赖关系：** Task 1 是基础（改 `SkillDefinition` 接口，所有构造处必须同步）；Task 1 完成后 Task 2 与 Task 3 可并行。

---

### Task 1: 数据模型 + SkillStore 枚举附加文件（基础，必须最先做）

改动 `SkillDefinition` 接口，所有构造 `SkillDefinition` 的地方都须带上 `files`，所以本任务同时覆盖 types / store / store 测试，保证编译通过。

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/store/skill.ts`
- Modify: `packages/core/src/__tests__/store/skill.test.ts`

- [ ] **Step 1: `packages/core/src/types.ts` — `SkillDefinition` 增加 `files: string[]`**

在接口末尾增加字段（排在 `source` 之后）：

```typescript
files: string[]; // 附加文件相对 skill 目录的 posix 路径，排除 SKILL.md；无附加文件为 []
```

- [ ] **Step 2: `packages/core/src/store/skill.ts` — 新增 `collectSkillFiles`，`parseSkill` 填充，`parseBuiltin` 置 `[]`**

引入 `shouldSkipDirEntry`（来自 `../utils/fs-walk.js`，与 `list-files.ts` 一致地过滤隐藏文件 / `node_modules` / `.git`）。新增私有方法递归枚举 skill 目录：

```typescript
private async collectSkillFiles(skillDirAbs: string): Promise<string[]> {
  const result: string[] = [];
  const walk = async (dir: string, prefix: string) => {
    let entries: import("node:fs/promises").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (shouldSkipDirEntry(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
      } else if (rel !== "SKILL.md") {
        result.push(rel);
      }
    }
  };
  await walk(skillDirAbs, "");
  return result;
}
```

`parseSkill(dirName)`：读取 SKILL.md 成功、构造返回对象时，用 `await this.collectSkillFiles(path.dirname(skillMdPath))` 填充 `files`。`skillDirAbs = path.resolve(this.skillDir, dirName)`。返回对象增加 `files`。

`parseBuiltin`：每个 builtin skill 的 `files: []`。

- [ ] **Step 3: `packages/core/src/__tests__/store/skill.test.ts` — 补 files 断言**

- 在 project-only describe 块：构造 skill 含附加文件 `references/foo.md`、`scripts/helper.js`、隐藏文件 `.hidden`、子目录里的 `assets/logo.txt`；新增 case 断言 `get(name).files`（排序后比较）为 `["assets/logo.txt", "references/foo.md", "scripts/helper.js"]`，且不含 `SKILL.md` 与 `.hidden`。
- 现有 case 补 `expect(s.files).toEqual([])`（无附加文件 / builtin / project-only 基础 case）。
- builtin fixture 相关 case：断言 `files` 为 `[]`。

- [ ] **Step 4: 验证**

```bash
npm test --workspace=packages/core -- --run src/__tests__/store/skill.test.ts
npm run lint --workspace=packages/core
```

---

### Task 2: load_skill 输出 manifest + 工具注册（依赖 Task 1）

**Files:**
- Modify: `packages/core/src/tools/load-skill.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/__tests__/tools/load-skill.test.ts`

- [ ] **Step 1: `packages/core/src/tools/load-skill.ts` — 构造函数增 `projectRoot`，输出追加 manifest**

`createLoadSkillTool(skillStore)` → `createLoadSkillTool(projectRoot, skillStore)`。

`execute` 内，当 `skill.source === "project"` 且 `skill.files.length > 0` 时，在 `text` 末尾追加：

```typescript
const skillDirRel = path
  .relative(projectRoot, path.dirname(skill.filePath))
  .split(path.sep)
  .join("/");
const fileList = skill.files.map((f) => `- ${skillDirRel}/${f}`).join("\n");
// 追加：
//
// ## Skill Files
//
// This skill has companion files you can read with the read_file tool:
// <fileList>
```

`project` 但无附加文件、或 builtin（`files: []`），不追加该段。

- [ ] **Step 2: `packages/core/src/tools/index.ts` — 调整调用**

```typescript
load_skill: createLoadSkillTool(ctx.root, ctx.skill),
```

- [ ] **Step 3: `packages/core/src/__tests__/tools/load-skill.test.ts` — 更新现有调用 + 新增 manifest case**

- 现有 `createLoadSkillTool(new SkillStore(skillDir))` 全部改为 `createLoadSkillTool(projectRoot, new SkillStore(skillDir))`。注意 `skillDir` 是 `.spherse/skills` 等价的临时根；测试里 `createTempProject` 返回的目录需传作 `projectRoot`（与 SkillStore 同一个根即可，manifest 路径会形如 `<subdir>/references/foo.md`）。
- 新增 case：skill 含附加文件 `references/foo.md`、`scripts/helper.js`；断言输出包含 `## Skill Files`，且包含每个 `- <skillDirRel>/references/foo.md` 形式的完整路径。

- [ ] **Step 4: 验证**

```bash
npm test --workspace=packages/core -- --run src/__tests__/tools/load-skill.test.ts
npm run lint --workspace=packages/core
```

---

### Task 3: Server contract schema 同步（依赖 Task 1，可与 Task 2 并行）

**Files:**
- Modify: `packages/server/src/contracts/skills.ts`
- Modify: `packages/server/src/__tests__/contracts/api-contracts.test.ts`

- [ ] **Step 1: `packages/server/src/contracts/skills.ts` — schema 增 `files`**

```typescript
const skillDefinition = Type.Object({
  name: Type.String(),
  description: Type.String(),
  instructions: Type.String(),
  filePath: Type.String(),
  source: Type.Union([Type.Literal("builtin"), Type.Literal("project")]),
  files: Type.Array(Type.String()),
});
```

- [ ] **Step 2: `packages/server/src/__tests__/contracts/api-contracts.test.ts` — 校验用例补 `files`**

定位 `validates skill list response`（约 106-109 行）及 `skillDefinition` 相关 case，给每个 skill 对象补 `files: []`（或 `["references/foo.md"]`），确保 parse 通过；新增一个缺 `files` 字段应被拒绝的负例。

- [ ] **Step 3: 验证**

```bash
npm test --workspace=packages/server
npm run lint --workspace=packages/server
```

---

### Task 4: 全量验证 + 文档同步（Task 1-3 完成后）

- [ ] **Step 1: 全量验证**

```bash
npm run verify
```

确保 lint + build + 全部 unit test + i18n check 通过。

- [ ] **Step 2: 文档同步**（按 design doc「文档同步」段）

- `docs/official/data-conventions.md`：补充 skill 可携带附加文件、`SkillDefinition.files` 字段语义、`load_skill` 输出 manifest 的说明（定位 skill 相关段落，约 121-138 行 / 196-209 行）。
- `docs/official/architecture.md`：Skill 系统段（约 25 行）补一句附加文件发现机制。
- `docs/dev/backlog.md`：补充对应条目（若无则新增一条已完成的 bugfix 条目）。

- [ ] **Step 3: 最终 lint**

```bash
npm run lint
```
