# Agent Tool 优化

日期：2026-06-10

## 背景

当前 agent tool 系统存在以下可优化点：

1. `list_files` 只支持全量递归或单层平铺，无法控制递归深度
2. 缺少文件移动和复制能力，agent 无法整理项目文件结构
3. 工具配置语义不直观：`tools` 字段未设置时默认为全部工具，而非"无工具"
4. 前端新建 agent 默认全选工具的行为需要与第 3 点配合保持

## 需求

1. `list_files` 增加递归深度参数 `depth`
2. 新增 `move_file` 和 `copy_file` 工具
3. 工具配置规则：未配置任何 tool 即为无 tool
4. 前端新建 agent 时默认勾选所有 tool（含新增工具）

## 设计

### 1. `list_files` 增加 `depth` 参数

**变更文件**：`packages/core/src/tools/list-files.ts`

**参数 schema 变更**：

```typescript
const ListFilesParams = Type.Object({
  path: Type.String({ description: "Directory path relative to project root" }),
  recursive: Type.Optional(Type.Boolean({ description: "List recursively", default: false })),
  depth: Type.Optional(Type.Number({ description: "Max recursion depth (only effective when recursive=true). Default: unlimited", minimum: 1 })),
});
```

**行为矩阵**：

| `recursive` | `depth` | 行为 |
|---|---|---|
| `false`（默认） | 忽略 | 仅列出顶层条目 |
| `true` | 未设置 | 无限递归（现有行为） |
| `true` | `N` | 递归 N 层后停止 |

**实现方式**：

`listRecursive()` 增加 `currentDepth` 和 `maxDepth` 参数。递归调用时 `currentDepth + 1`，当 `currentDepth >= maxDepth` 时不再进入子目录。

```typescript
async function listRecursive(
  dirPath: string,
  prefix: string,
  lines: string[],
  projectRoot: string,
  policy: AiFileAccessPolicy,
  currentDepth: number,
  maxDepth: number,
): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const icon = entry.isDirectory() ? "\u{1F4C1}" : "\u{1F4C4}";
    const entryPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(projectRoot, entryPath).split(path.sep).join("/");
    if (policy.isDenied(relativePath)) continue;
    lines.push(`${prefix}${icon} ${entry.name}`);
    if (entry.isDirectory() && currentDepth < maxDepth) {
      await listRecursive(entryPath, `${prefix}  `, lines, projectRoot, policy, currentDepth + 1, maxDepth);
    }
  }
}
```

在 `execute` 中，`recursive: true` 时根据 `params.depth` 决定 `maxDepth`：有值则用 `params.depth`，无值则用 `Infinity`。

### 2. 新增 `move_file` 和 `copy_file` 工具

#### 2.1 `move_file`

**新增文件**：`packages/core/src/tools/move-file.ts`

**参数 schema**：

```typescript
const MoveFileParams = Type.Object({
  source: Type.String({ description: "Source path relative to project root" }),
  destination: Type.String({ description: "Destination path relative to project root" }),
});
```

**行为**：

- 使用 `fs.rename()` 移动/重命名文件或目录
- 源路径和目标路径均通过 `resolveProjectPath` 进行路径安全校验
- 源路径做 AI 可读权限检查（`policy.assertReadableByAi`）
- 目标路径做路径安全检查
- 目标已存在时返回错误，不覆盖
- 源不存在时返回错误
- 通过 `FileWriteMutex` 保护目标路径的并发写入

**返回示例**：

```
Successfully moved {source} to {destination}
```

**错误场景**：

| 场景 | 返回 |
|---|---|
| 源不存在 | `Source not found: {source}` |
| 目标已存在 | `Destination already exists: {destination}` |
| 源被 AI 访问策略拒绝 | `Access denied: {source}` |
| 跨设备移动（rename 失败） | 使用 fallback：copy + delete |

跨设备 fallback：`fs.rename()` 在跨文件系统时会失败（`EXDEV` 错误）。捕获该错误后，对文件使用 `fs.copyFile()` + `fs.unlink()`，对目录使用 `fs.cp()` + `fs.rm()`。

#### 2.2 `copy_file`

**新增文件**：`packages/core/src/tools/copy-file.ts`

**参数 schema**：

```typescript
const CopyFileParams = Type.Object({
  source: Type.String({ description: "Source file path relative to project root" }),
  destination: Type.String({ description: "Destination file path relative to project root" }),
});
```

**行为**：

- 使用 `fs.copyFile()` 复制单个文件（不支持目录，遵循 YAGNI）
- 路径安全、权限检查与 `move_file` 一致
- 目标已存在时返回错误，不覆盖
- 通过 `FileWriteMutex` 保护目标路径

**返回示例**：

```
Successfully copied {source} to {destination}
```

#### 2.3 工具注册

**变更文件**：`packages/core/src/tools/index.ts`

在 `createToolsForProject()` 中注册两个新工具：

```typescript
tools.move_file = createMoveFileTool(projectRoot, mutex, getAiFileAccessPolicy);
tools.copy_file = createCopyFileTool(projectRoot, mutex, getAiFileAccessPolicy);
```

导出新增：
```typescript
export { createMoveFileTool } from "./move-file.js";
export { createCopyFileTool } from "./copy-file.js";
```

### 3. 工具配置语义变更

**变更文件**：`packages/core/src/engine.ts`

**当前逻辑**（L244）：
```typescript
const toolNames = profile.tools ?? Object.keys(allTools);
```

**改为**：
```typescript
const toolNames = profile.tools ?? [];
```

**影响分析**：

| 场景 | 影响 |
|---|---|
| 通过模板创建的 agent（有显式 `tools` 列表） | 无影响 |
| 通过前端编辑过的 agent（`parseAgentMarkdown` 默认返回 `ALL_TOOL_IDS`） | 无影响 |
| 手动创建且未设置 `tools` 字段的老 agent | 失去所有工具 |

前端 `parseAgentMarkdown()` 在 `tools` 字段缺失时默认返回 `[...ALL_TOOL_IDS]`，且 `buildAgentMarkdown()` 始终将 `tools` 序列化到 frontmatter。因此通过前端保存过的 agent 都有显式 `tools` 列表，不会受影响。

### 4. 前端与 i18n 适配

#### 4.1 工具注册

**变更文件**：`packages/app/src/lib/tool-registry.ts`

`ALL_TOOLS` 新增两个条目：

```typescript
{ id: "move_file", label: "tool.move_file" },
{ id: "copy_file", label: "tool.copy_file" },
```

`ALL_TOOL_IDS` 自动跟随更新。

#### 4.2 Agent 模板

**变更文件**：`packages/presets/templates/agent-template.md`

`tools` 列表新增：
```yaml
  - move_file
  - copy_file
```

#### 4.3 i18n

**变更文件**：`packages/i18n/src/locales/zh-CN.ts`、`en.ts`、`zh-TW.ts`

新增翻译键：

| Key | zh-CN | en | zh-TW |
|---|---|---|---|
| `tool.move_file` | 移动文件 | Move File | 移動檔案 |
| `tool.copy_file` | 复制文件 | Copy File | 複製檔案 |

zh-CN 中每条文案需附注释说明 UI 上下文。

## 不在范围内

- `copy_file` 不支持目录复制（YAGNI，后续可扩展）
- 不新增文件搜索过滤参数（glob pattern 等）
- 不修改 server API 层（工具配置透传不变）

## 测试覆盖

- `list_files` depth 参数：覆盖 `depth=1`、`depth=3`、`depth` 缺失 + `recursive=true`、`recursive=false` 忽略 depth 等场景
- `move_file`：正常移动、源不存在、目标已存在、跨设备 fallback、AI 访问策略拒绝
- `copy_file`：正常复制、源不存在、目标已存在、AI 访问策略拒绝
- 工具配置语义：`tools` 为 `undefined` 时返回空工具列表；为显式数组时正常过滤

## 涉及文件清单

| 文件 | 变更类型 |
|---|---|
| `packages/core/src/tools/list-files.ts` | 修改 |
| `packages/core/src/tools/move-file.ts` | 新增 |
| `packages/core/src/tools/copy-file.ts` | 新增 |
| `packages/core/src/tools/index.ts` | 修改 |
| `packages/core/src/engine.ts` | 修改 |
| `packages/app/src/lib/tool-registry.ts` | 修改 |
| `packages/presets/templates/agent-template.md` | 修改 |
| `packages/i18n/src/locales/zh-CN.ts` | 修改 |
| `packages/i18n/src/locales/en.ts` | 修改 |
| `packages/i18n/src/locales/zh-TW.ts` | 修改 |
