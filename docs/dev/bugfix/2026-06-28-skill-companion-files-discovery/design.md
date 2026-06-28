# Bugfix: Skill 附加文件无法被 LLM 发现

## 问题描述

一个 skill 目录除了 `SKILL.md` 之外，往往还携带附加文件（`references/*`、`assets/*`、`scripts/*` 等）。在当前实现中，LLM 无法正常发现当前 skill 目录中的这些附加文件，因而无法读取并使用它们。

典型场景：skill 的 `SKILL.md` 在正文中引用 `references/foo.md`、`scripts/helper.js` 等相对路径（如 superpowers 风格的 skill），但 agent 调用 `load_skill` 后只知道 `SKILL.md` 的正文，既不知道附加文件存在、也不知道它们在磁盘上的路径，`SKILL.md` 中的相对引用遂成为死链。

## 根因分析

`load_skill` 工具（`packages/core/src/tools/load-skill.ts`）只返回 `SKILL.md` 的正文：

```typescript
text: `# Skill: ${skill.name}\n\n${skill.instructions}`,
```

而 `SkillStore.parseSkill`（`packages/core/src/store/skill.ts:55`）只读取 `SKILL.md`，从不枚举 skill 目录的兄弟文件，`SkillDefinition`（`packages/core/src/types.ts:30`）也没有承载附加文件清单的字段。

由此造成两个层面的缺失：

1. **Discovery（发现）缺失**：`load_skill` 输出不包含任何附加文件清单，LLM 无从知道 skill 目录里还有哪些文件。
2. **Path（路径）缺失**：即便 LLM 猜测存在附加文件，也不知道 skill 目录在项目中的相对路径（skill 的 `name` 来自 frontmatter，与目录名 `dirName` 不一定一致），无法构造可用的 `read_file` 路径。

> 注：project skill 位于 `.spherse/skills/<dirName>/`，其路径分类为 `skills`（`access/path-category.ts`），已在 `LLM_READ` 白名单中，因此 `read_file` / `list_files` 本就具备读权限。所以本次问题的本质是「发现 + 路径暴露」，而非权限。

### 范围界定

经确认，本次 bugfix **仅覆盖 project skill**（磁盘上的 `.spherse/skills/<name>/`）：

- **builtin skill**（app 内置、`PRESET_SKILL_SOURCES` 内存合并）**不在范围内**。其 `filePath` 为合成路径 `builtin://<dir>/SKILL.md`，且当前所有 builtin skill（`create-ui-theme`、`create-agent-chat-theme`、`use-ui-sdk`）均仅含 `SKILL.md`、无附加文件。如未来 builtin skill 需要携带附加文件，可在此基础上扩展为统一的「skill 文件读取」入口（参见「未来扩展」）。

## 方案

### load_skill 返回附加文件清单 + 复用 read_file（方案 A）

`SkillStore` 在解析 project skill 时递归枚举其目录下的附加文件，写入 `SkillDefinition.files`；`load_skill` 在输出中追加一段 manifest，列出每个附加文件的**完整项目相对路径**，并提示用现有 `read_file` 工具按需读取。

**选择此方案的理由：**

- **最小改动**：不新增工具、不改动访问策略（`skills` 分类已可读），完全复用既有的路径安全（`resolveProjectPath`）与访问控制（`AccessPolicy`）。
- **懒加载、无上下文膨胀**：manifest 只列文件名/路径，不内联内容；LLM 按需 `read_file`，避免一次性灌入大文件（脚本、资源等）。
- **零猜测**：输出直接给出可用 `read_file` 路径，LLM 无需推断目录名或拼接路径。

**已否决的备选方案：**

- **新增 `read_skill_file` 工具**：与 `read_file` 逻辑重复，对 project-only 范围属过度设计。
- **`load_skill` 内联全部附加文件内容**：上下文膨胀风险大、不懒加载，不可取。

## 设计

### 1. 数据模型：SkillDefinition 增加 files 字段

`packages/core/src/types.ts`：

```typescript
export interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
  filePath: string;
  source: "builtin" | "project";
  files: string[]; // 附加文件的 posix 相对路径（相对 skill 目录根，不含 SKILL.md）；无附加文件时为 []
}
```

约定：

- 路径为 **posix 风格**（`/` 分隔），相对 skill 目录根，例如 `["references/foo.md", "scripts/helper.js"]`。
- 始终**排除 `SKILL.md`**（其内容即 `instructions`，已单独暴露）。
- builtin skill 一律为 `files: []`（project-only 范围）。

### 2. SkillStore：枚举附加文件

`packages/core/src/store/skill.ts`：

- 新增私有方法 `collectSkillFiles(skillDirAbs: string): Promise<string[]>`：递归枚举 `skillDirAbs`，收集除 `SKILL.md` 外的文件相对路径（posix 风格）。复用现有 `shouldSkipDirEntry`（`utils/fs-walk.ts`）过滤隐藏文件 / `node_modules` / `.git`。readdir 出错时返回 `[]`（容错，不影响 skill 本身可用）。
- `parseSkill(dirName)`：读取 `SKILL.md` 成功后调用 `collectSkillFiles` 填充 `files`。仍受既有 `isPathInside(skillDir, ...)` 边界约束。
- `parseBuiltin`：`files: []`。

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

### 3. load_skill 工具：输出 manifest

`packages/core/src/tools/load-skill.ts`：

- `createLoadSkillTool` 签名由 `(skillStore)` 改为 `(projectRoot, skillStore)`，用于把附加文件的绝对路径换算为**项目相对路径**。
- 当 `skill.source === "project"` 且 `skill.files.length > 0` 时，在返回文本末尾追加：

  ```
  ## Skill Files

  This skill has companion files you can read with the read_file tool:
  - .spherse/skills/<dirName>/references/foo.md
  - .spherse/skills/<dirName>/scripts/helper.js
  ```

- 完整相对路径由 `path.relative(projectRoot, path.dirname(skill.filePath))` 得到 skill 目录，再 join 各 `files` 条目（posix 风格输出），保证与 `read_file` 期望的「相对项目根」入参一致。
- builtin skill（`files: []`）不追加 manifest。

```typescript
const skillDirRel = path.relative(projectRoot, path.dirname(skill.filePath)).split(path.sep).join("/");
const fileList = skill.files
  .map((f) => `- ${skillDirRel}/${f}`)
  .join("\n");
text = `# Skill: ${skill.name}\n\n${skill.instructions}\n\n## Skill Files\n\nThis skill has companion files you can read with the read_file tool:\n${fileList}`;
```

### 4. 工具注册

`packages/core/src/tools/index.ts`：

```typescript
load_skill: createLoadSkillTool(ctx.root, ctx.skill),
```

`ToolContext` 已暴露 `root` 与 `skill`，无需扩展。

### 5. Server contract

`packages/server/src/contracts/skills.ts` 的 `skillDefinition` schema 增加 `files` 字段，使 `/skills` 与 `/skills/:name` 端点同步暴露清单（前端可选展示，非必须）：

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

### 6. 改动清单

| 文件 | 改动 |
|------|------|
| `packages/core/src/types.ts` | `SkillDefinition` 增加 `files: string[]` |
| `packages/core/src/store/skill.ts` | 新增 `collectSkillFiles`；`parseSkill` 填充 `files`；`parseBuiltin` 置 `[]` |
| `packages/core/src/tools/load-skill.ts` | 构造函数增 `projectRoot` 参数；输出追加 manifest |
| `packages/core/src/tools/index.ts` | `createLoadSkillTool(ctx.root, ctx.skill)` |
| `packages/server/src/contracts/skills.ts` | `skillDefinition` schema 增 `files` 字段 |

### 7. 测试

- **SkillStore**（`packages/core/src/__tests__/` 下 skill 相关测试）：构造 project skill 目录，含 `references/foo.md`、`scripts/helper.js`、隐藏文件 `.hidden`；断言 `get(name).files` 为 `["references/foo.md", "scripts/helper.js"]`（排除 `SKILL.md` 与隐藏文件）。另断言无附加文件时 `files` 为 `[]`，builtin skill `files` 为 `[]`。
- **load_skill**（`packages/core/src/__tests__/tools/load-skill.test.ts`）：构造含附加文件的 project skill，断言输出包含 `## Skill Files` 段且每条为完整项目相对路径（`.spherse/skills/<dirName>/...`）；无附加文件时不包含该段。
- **Contract**（`packages/server/src/__tests__/contracts/api-contracts.test.ts`）：`skillListResponse` 校验用例补 `files` 字段。

## 边界与限制

- **仅文本附加文件**：`read_file` 以 `utf-8` 读取，二进制文件（如图片）会乱码——属 `read_file` 既有限制，不在本次范围。
- **仅 project skill**：builtin skill 附加文件不支持（参见「范围界定」）。
- **manifest 只列路径、不读内容**：懒加载，避免上下文膨胀。

## 未来扩展

若 builtin skill 也需携带附加文件，可在 `PRESET_SKILL_SOURCES` 已打包的 `files[]`（sync 脚本 `readDirRecursive` 本就收集了全部文件内容）基础上，让 `parseBuiltin` 填充 `files` 清单，并引入统一的「skill 文件读取」入口（如 `read_skill_file(skill_name, relative_path)`，builtin 从内存 bundle 读、project 从磁盘读），以覆盖 `builtin://` 合成路径无法用 `read_file` 直接读取的缺口。

## 文档同步

- `docs/official/data-conventions.md`：补充 skill 可携带附加文件、`SkillDefinition.files` 字段语义、`load_skill` 输出 manifest 的说明。
- `docs/official/architecture.md`：Skill 系统段落补充附加文件发现机制。
- `docs/dev/backlog.md`：新增/更新对应条目状态。
