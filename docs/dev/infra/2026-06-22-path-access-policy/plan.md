# 实施计划 — Path 访问权限集中管理

设计文档：`docs/dev/infra/2026-06-22-path-access-policy/design.md`

## 签名修正

设计文档中 `llmAccessPolicy(projectRootPath, aiDeniedPaths)` 省略了 `paths` 参数。实际实现需要 `paths: ConfigPaths`（来自 `ProjectConfigStore.get().paths`）供 `categorizePath` 解析可配置路径：

```ts
export function llmAccessPolicy(
  projectRootPath: string,
  paths: ConfigPaths,
  aiDeniedPaths: readonly string[],
): AccessPolicy;

export function serverAccessPolicy(
  projectRootPath: string,
  paths: ConfigPaths,
): AccessPolicy;
```

调用方（ToolContext / server route）已持有 `ProjectConfigStore`，同步读取 `config.paths`，无需 policy 自行读盘。

## 依赖图

```
T1 path-category ──→ T3 access-policy ──→ T4 core wiring ──→ T5 AI tools ─┐
                                      ┌──→ T6 engine/store ──────────────┼──→ T8 verify
T2 denied-paths ────→ T3 ─────────────┘                      T7 server ──┘
```

T5 / T6 / T7 在 T4 完成后可并行。

---

## T1 — path-category.ts

**文件：** `packages/core/src/access/path-category.ts`（新建）

**依赖：** 无

**内容：**
- `PathCategory` 联合类型（12 个值，见设计矩阵）
- `ConfigPaths` 类型 = `{ agents: string; index: string; changelog: string }`
- `categorizePath(relativePath: string, paths: ConfigPaths): PathCategory`
  - posix 化（`\` → `/`）、`path.posix.normalize`
  - 匹配顺序：具体文件（`project.yaml`、`theme.css`、`profile.md`、`sessions.db`、`schedules.yml`、`schedule-logs.jsonl`）→ 目录级（`generated-images/**`、`skills/**`、`agents/<dir>/`）→ `rootIndex`/`changelog`（可配置路径）→ `.spherse/**` 兜底 `spherseOther` → 其余 `userFiles`
  - 目录前缀匹配用 `=== seg || startsWith(seg + "/")`
  - `agents` 目录前缀 = `.spherse/${paths.agents}/`

**测试：** `packages/core/src/__tests__/access/path-category.test.ts`
- 每 category 正向命中
- 越界（`AGENTS.md.bak` 不命中 `rootIndex`）
- 可配置路径（自定义 `paths.index`、`paths.agents`）
- `.spherse` 兜底（`spherseOther`）
- 非 `.spherse` 文件 → `userFiles`
- posix 化（`\` 路径）

**验收：** `npm test --workspace=packages/core` 通过

---

## T2 — denied-paths.ts

**文件：** `packages/core/src/access/denied-paths.ts`（新建）

**依赖：** T1（`categorizePath`、`PathCategory`、`ConfigPaths`）

**内容：**
- 从 `ai-file-access.ts` 迁入 `normalizeDeniedPath` / `normalizeDeniedPaths` / `normalizeProjectRelativePath`（纯字符串处理，逻辑不变）
- `isReservedDenyPath(relativePath: string, paths: ConfigPaths): boolean` —— 替代 `isReservedAiDenyPath`。用 `categorizePath` 判断 category 是否为保留 category（`rootIndex` / `changelog` / 所有 `.spherse` 系），若是则不允许加入 denylist
- `normalizeDeniedPath` 签名变为 `(input: string, paths: ConfigPaths) => string | null`，内部调 `isReservedDenyPath`
- `normalizeDeniedPaths` 签名变为 `(inputs: readonly string[], paths: ConfigPaths) => string[]`

**测试：** `packages/core/src/__tests__/access/denied-paths.test.ts`
- 迁入 `ai-file-access.test.ts` 的 denylist 归一化用例
- 新增：保留 category（自定义 paths 下的 `AGENTS.md` / `.spherse/project.yaml`）被拒绝

**验收：** `npm test --workspace=packages/core` 通过

---

## T3 — access-policy.ts

**文件：** `packages/core/src/access/access-policy.ts`（新建）

**依赖：** T1（`categorizePath`、`ConfigPaths`）、T2（`normalizeDeniedPaths`）

**内容：**
- `Decision` 类型 = `{ allowed: true } | { allowed: false; reason: string }`
- `AccessPolicy` 接口（`read` / `write` / `canRead` / `canWrite`）
- 白名单常量（4 组 `Set<PathCategory>`，来自设计矩阵）：
  ```
  LLM_READ  = userFiles, rootIndex, changelog, projectConfig, projectTheme,
              generatedImages, skills, agentProfile, agentTheme, agentSchedules, spherseOther
  LLM_WRITE = userFiles, projectTheme, agentTheme
  SRV_READ  = userFiles, rootIndex, changelog, projectTheme, generatedImages, agentTheme
  SRV_WRITE = userFiles, rootIndex, changelog, projectTheme
  ```
- `llmAccessPolicy(projectRootPath, paths, aiDeniedPaths): AccessPolicy`
  - `read(rel)`：① `resolveProjectPath` 穿越 → ② deniedPaths 命中检查 → ③ category ∈ LLM_READ？
  - `write(rel)`：① 穿越 → ② deniedPaths 检查 → ③ category ∈ LLM_WRITE？
  - `canRead` / `canWrite`：try `read`/`write`，返回 boolean
- `serverAccessPolicy(projectRootPath, paths): AccessPolicy`（同上，无 deniedPaths 步骤）
- `shouldSkipDirEntry(name: string): boolean`（`name.startsWith(".") || name === "node_modules" || name === ".git"`）

**测试：** `packages/core/src/__tests__/access/access-policy.test.ts`
- 表驱动：两策略 × 12 category 的 read/write 完整矩阵
- deniedPaths 目录递归命中（`secrets` 拦截 `secrets/a.md`）
- deniedPaths 同时禁读禁写
- 穿越路径（`../`）被拒
- `shouldSkipDirEntry`

**验收：** `npm test --workspace=packages/core` 通过

---

## T4 — Core 接线

**文件：** 多个（见下）

**依赖：** T1、T2、T3

**目标：** 让新模块可用（导出 + ToolContext 提供 llmPolicy），但**不改动工具代码、不删除旧文件**——保持 `ai-file-access.ts` 与 `getAiFileAccessPolicy` 暂时共存，确保中间状态可编译。

**内容：**

1. **`packages/core/src/tools/tool-context.ts`**：
   - 新增 `get llmPolicy(): AccessPolicy` getter —— 从 `projectStore.config.get()` 读 `paths` + `getAiAccessSettings().deniedPaths`，构造 `llmAccessPolicy(root, paths, deniedPaths)`（每次调用重建，保持 deniedPaths 实时生效）
   - 保留 `getAiFileAccessPolicy()`（T5 移除）

2. **`packages/core/src/index.ts`**：
   - 新增导出：`PathCategory`（type）、`ConfigPaths`（type）、`categorizePath`、`AccessPolicy`（type）、`Decision`（type）、`llmAccessPolicy`、`serverAccessPolicy`、`shouldSkipDirEntry`
   - 补导 `isPathInside`
   - `isProjectMetaPath` 保留但标 `@deprecated`

3. **`packages/core/src/store/project-config.ts`**：
   - import 从 `../access/ai-file-access.js` → `../access/denied-paths.js`
   - `normalizeDeniedPath` / `normalizeDeniedPaths` 调用补 `paths` 参数（`this.get().paths`）
   - `normalizeWelcomePagePath` 中 `.spherse` 检查改用 `categorizePath` 判定（消除第三套分类副本）；扩展名白名单保留

4. **`packages/core/src/project-manager.ts`**：
   - 新增 `getPaths(): ConfigPaths`（返回 `projectStore.config.get().paths`），供 server 路由构造 policy

**验收：** `npm run build --workspace=packages/core` 通过；`npm test --workspace=packages/core` 通过（工具仍走旧路径，新模块已导出可用）

---

## T5 — AI 工具迁移 + 旧代码清理

**文件：** `packages/core/src/tools/` 下的 8 个工具 + `tool-context.ts` + `index.ts`

**依赖：** T4

**可并行于：** T6、T7

**改造（统一模式）：**

各工具的 `createXxxTool` 工厂函数签名从接收 `getAiFileAccessPolicy` 闭包改为接收 `llmPolicy: AccessPolicy`（或接收 `ToolContext`）。`tools/index.ts` 的 `createToolsForProject` 改为传 `ctx.llmPolicy`。

| 工具 | 改造 |
|---|---|
| `read-file.ts` | `getAiFileAccessPolicy().assertReadableByAi(path)` → `llmPolicy.read(path)` |
| `write-file.ts` | 新增 `llmPolicy.write(path)`（此前无检查） |
| `edit-file.ts` | 读步骤 `llmPolicy.read(path)`，写步骤 `llmPolicy.write(path)` |
| `list-files.ts` | `assertReadableByAi` → `llmPolicy.read`；递归 `isDenied` → `!llmPolicy.canRead`；新增 `shouldSkipDirEntry` 过滤 |
| `search-content.ts` | `assertReadableByAi` → `llmPolicy.read`；`isDenied` → `!llmPolicy.canRead`；`shouldSkipDir` → `shouldSkipDirEntry` |
| `move-file.ts` | source `llmPolicy.read`，**destination `llmPolicy.write`**（新增） |
| `copy-file.ts` | source `llmPolicy.read`，**destination `llmPolicy.write`**（新增） |
| `render-card.ts` | `assertReadableByAi` → `llmPolicy.read`（仅 file_path 分支） |

各工具 try/catch 返回 `{ ..., denied: true }` 的模式保留不变（policy 方法仍抛 `AccessDeniedError`）。

**迁移完成后清理：**
- `tool-context.ts`：移除 `getAiFileAccessPolicy()` 方法及相关 import
- `tools/index.ts`：移除 `getPolicy` 闭包
- 删除 `packages/core/src/access/ai-file-access.ts`
- 删除 `packages/core/src/__tests__/access/ai-file-access.test.ts`（用例已迁入 T2/T3）

**验收：** `npm run build --workspace=packages/core` 通过；`npm test --workspace=packages/core` 通过；更新对应工具测试反映新行为

---

## T6 — engine / store 迁移

**文件：** `packages/core/src/engine/` + `packages/core/src/store/`

**依赖：** T3（`AccessPolicy`）、T4（import 路径）

**可并行于：** T5、T7

**内容：**
- `engine/read-context-files.ts`：`policy.isDenied(rel)` → `!llmPolicy.canRead(rel)`。注意此处需要拿到 `llmPolicy`——从 `SessionRuntime` 传入或从 `ToolContext` 获取
- `store/skill.ts:56`：`skillMdPath.startsWith(this.skillDir)` → `isPathInside(this.skillDir, skillMdPath)`
- `store/project-config.ts`：已在 T4 完成

**验收：** `npm test --workspace=packages/core` 通过

---

## T7 — server 路由迁移

**文件：** `packages/server/src/routes/`

**依赖：** T4（`serverAccessPolicy` / `shouldSkipDirEntry` / `ProjectManager.getPaths()` 从 `@spherse/core` 导出）

**可并行于：** T5、T6

**内容：**

| 文件 | 改造 |
|---|---|
| `content.ts` | GET：`serverPolicy.read(rel)`（拦截敏感 category）；POST/DELETE：`serverPolicy.write(rel)` 替代 `isProjectMetaPath`；PUT：新增 `serverPolicy.write(rel)`（修复漏检 `.spherse`） |
| `preview.ts` | `serverPolicy.read(rel)` + 保留扩展名白名单 |
| `images.ts` | dest：`serverPolicy.write(destRel)`（禁止写入 `.spherse` engine 数据） |
| `file-tree.ts` | `EXCLUDED_DIRS` → `shouldSkipDirEntry` |

构造方式：每个 handler 内 `const server = serverAccessPolicy(root, projectManager.getPaths())`。

**验收：** `npm test --workspace=packages/server` 通过

---

## T8 — 验证 + 文档

**依赖：** T5、T6、T7

**内容：**
- `npm run verify`（lint + build + unit tests + i18n check）全绿
- 更新 `docs/official/architecture.md`：路径安全 / AI 访问限制小节改为 Category + AccessPolicy 模型
- 更新 `docs/official/data-conventions.md`：补充 category 说明；`aiAccess.deniedPaths` 语义改为「禁读 + 禁写」
- 更新 `docs/dev/backlog.md`（如有对应条目）

**验收：** `npm run verify` 通过；文档更新完成
