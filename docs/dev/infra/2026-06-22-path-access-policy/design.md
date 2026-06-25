# Path 访问权限集中管理

## 背景

项目目录下文件的读/写权限定义分散在多处（`isProjectMetaPath`、`isReservedAiDenyPath`、`normalizeWelcomePagePath`、各 tool 内联的 `shouldSkipDir` 等），且只有读侧策略、写侧完全缺失（AI 可经 `write_file` 覆写 `.spherse/project.yaml`、`sessions.db`、`AGENTS.md`；server `PUT /content` 漏检 `.spherse`）。

本重构将分类与策略集中到 `@spherse/core` 的单一模块。

## 目标

1. **path-category**：语义化地分类 project 下任意路径，作为文件分类的唯一真相。
2. **access policies**：针对不同场景（LLM / server）的 policy 函数，统一收敛所有读写权限判断。

## path-category

`categorizePath()` 将项目内相对路径映射到一个语义 category。特殊文件路径（`AGENTS.md`、`CHANGELOG.md`、`.spherse/agents/`）由 path-category 模块内部的 `PROJECT_PATHS` 常量定义，作为文件分类的唯一真相。这些路径不再可配置（已从 `ProjectConfig` / `project.yaml` 中移除 `paths` 字段）。

| Category | 路径 |
|---|---|
| `userFiles` | 项目根下除 `.spherse/**`、`paths.index`、`paths.changelog` 外的文件 |
| `rootIndex` | `paths.index`（默认 `AGENTS.md`） |
| `changelog` | `paths.changelog`（默认 `CHANGELOG.md`） |
| `projectConfig` | `.spherse/project.yaml` |
| `projectTheme` | `.spherse/theme.css` |
| `generatedImages` | `.spherse/generated-images/**` |
| `skills` | `.spherse/skills/**` |
| `agentProfile` | `.spherse/{paths.agents}/<dir>/profile.md` |
| `agentTheme` | `.spherse/{paths.agents}/<dir>/theme.css` |
| `agentSessions` | `.spherse/{paths.agents}/<dir>/sessions.db` |
| `agentSchedules` | `.spherse/{paths.agents}/<dir>/schedules.yml` + `schedule-logs.jsonl` |
| `spherseOther` | `.spherse/**` 未匹配以上（兜底，默认全策略拒绝） |

实现要点：posix 化后按「具体文件 → 目录级 → `.spherse/**` 兜底」顺序匹配；目录前缀用 `=== seg || startsWith(seg + "/")` 避免跨段误判。纯函数，可独立单测。

## access policies

```ts
export interface AccessPolicy {
  /** 抛 AccessDeniedError；内部依次完成穿越校验 → deniedPath 校验 → category 校验 */
  read(relativePath: string): void;
  write(relativePath: string): void;
  /** 非抛出版本，用于 list/search 的 entry 过滤 */
  canRead(relativePath: string): boolean;
  canWrite(relativePath: string): boolean;
}

/** LLM 策略：携带用户配置的 aiDeniedPaths（读写均生效） */
export function llmAccessPolicy(
  projectRootPath: string,
  aiDeniedPaths: readonly string[],
): AccessPolicy;

/** server 策略：无 denylist */
export function serverAccessPolicy(projectRootPath: string): AccessPolicy;
```

**调用方式：**
```ts
llmAccessPolicy(projectRootPath, aiDeniedPaths).write(targetPath);
serverAccessPolicy(projectRootPath).read(targetPath);
```

**内部求值（`.read()` / `.write()` 一致）：**
1. **穿越边界校验**：`resolveProjectPath(root, rel)`，逃逸项目根 → 拒绝。
2. **denied path 校验**（仅 LLM 策略）：命中 `aiDeniedPaths`（目录递归）→ 拒绝。
3. **category 校验**：`categorizePath(rel)` 得到的 category 不在该 op 的白名单 → 拒绝。

`path-category` 模块内部定义 `PROJECT_PATHS` 常量（`{ agentsDir: "agents", indexFile: "AGENTS.md", changelogFile: "CHANGELOG.md" }`），作为特殊文件路径的唯一真相。`categorizePath` 使用这些常量，不从外部参数接收。

## 策略矩阵

`✓` = 白名单允许；`✗` = 拒绝（通用表面不可访问）；`专` = 不经通用策略，由专用表面处理。

| Category | LLM read | LLM write | Server read | Server write |
|---|---|---|---|---|
| `userFiles` | ✓ | ✓ | ✓ | ✓ |
| `rootIndex` | ✓ | ✗ | ✓ | ✓ |
| `changelog` | ✓ | ✗（专用 `append_changelog` 仅追加） | ✓ | ✓ |
| `projectConfig` | ✓ | ✗ | ✗ | ✗ |
| `projectTheme` | ✓ | ✓ | ✓ | ✓（`/settings/theme` 直写文件） |
| `generatedImages` | ✓ | ✗（专用 `generate_image`） | ✓ | ✗ |
| `skills` | ✓ | ✗ | ✗（专用 `/skills`） | ✗ |
| `agentProfile` | ✓ | ✗ | ✗（专用 `/agents`） | ✗（专用 `/agents` 走 core） |
| `agentTheme` | ✓ | ✓ | ✓ | ✗（专用 `/agents` 走 core） |
| `agentSessions` | ✗ | ✗ | ✗（专用 `/sessions`） | ✗ |
| `agentSchedules` | ✓ | ✗ | ✗（专用 `/schedules`） | ✗ |
| `spherseOther` | ✓ | ✗ | ✗ | ✗ |

**要点：**
- LLM write 白名单 = `userFiles` + `projectTheme` + `agentTheme`（AI 可写用户文件与主题文件；不可经通用工具改写 mechanism 文件）。
- `agentSessions`（二进制 SQLite）对所有策略拒绝，只通过专用 `/sessions` API 操作。
- server write 白名单 = `userFiles` + `rootIndex` + `changelog` + `projectTheme`。**拒绝 `.spherse` 下的 engine 数据**（`projectConfig`/`agentProfile`/`agentTheme`/`agentSessions`/`agentSchedules`/`spherseOther`）——这些只由 core 写或专用路由经 core 写，通用 `PUT /content/*` 必须拒绝。`projectTheme`（`.spherse/theme.css`）是用户可编辑 CSS、经 `/settings/theme` 直写，故允许。

**目录遍历过滤：** `shouldSkipDirEntry(name)`（跳过 dotfile/dotdir、`node_modules`、`.git`）独立导出，由 `list_files` / `search_content` / file-tree 复用。preview 扩展名白名单保留为 route 级校验。

## 模块结构

```
packages/core/src/access/
├── path-category.ts   # PathCategory + categorizePath()
├── access-policy.ts   # AccessPolicy + llmAccessPolicy() + serverAccessPolicy() + shouldSkipDirEntry()
└── denied-paths.ts    # normalizeDeniedPath(s)（从 ai-file-access.ts 迁入）
```

移除 `ai-file-access.ts`（职责被上述模块吸收）。`index.ts` 补导 `isPathInside`（当前缺失）；`isProjectMetaPath` deprecated。

## 消费者改造

- **AI 工具**：`ToolContext` 持有 `llmPolicy: AccessPolicy`。`read_file`/`list`/`search`/`render_card` 用 `llmPolicy.read`；`write_file` 新增 `llmPolicy.write`；`edit_file` 读用 `.read`、写用 `.write`；`move`/`copy` source 用 `.read`、destination 用 `.write`。7 处复制粘贴的 try/catch 收敛为一处调用。
- **engine/store**：`read-context-files.ts` 用 `llmPolicy.canRead`；`skill.ts:56` 的 `startsWith` 反模式改 `isPathInside`。
- **server 通用路由**：`content.ts`（GET/POST/PUT/DELETE）、`preview.ts`、`images.ts`（dest）走 `serverPolicy`；`file-tree.ts` 用 `shouldSkipDirEntry`。专用路由保留各自 scoped 逻辑。

## 行为变更（tighten）

1. LLM write 收紧：通用工具仅可写 `userFiles`/`projectTheme`/`agentTheme`，不可覆写 `.spherse/*`、`AGENTS.md`、`CHANGELOG.md`。
2. `edit_file` 写步骤改用 write 策略；`move`/`copy` 增加 destination 写校验。
3. `aiDeniedPaths` 同时禁读禁写（此前仅禁读）。
4. server `PUT /content` 拦截 `.spherse` 下的 engine 数据（`projectConfig`/`agentProfile`/`agentSessions`/`agentSchedules` 等）；`GET /content`、`/preview` 拒绝敏感 category。`.spherse/theme.css` 仍可写（用户可编辑 CSS）。
5. `agentSessions` 所有策略拒绝（此前 LLM 可读二进制乱码）。
6. `list_files` 补齐 dotfile/node_modules 跳过。

> 变更 1 移除了 AI 直写 `AGENTS.md`/`CHANGELOG.md` 的能力；如需保留，可在 review 时把 `rootIndex` 加回 LLM write 白名单。

## 测试

- `path-category.test.ts`：每 category 正向/越界/可配置路径/兜底。
- `access-policy.test.ts`：两策略 × 各 category 的 read/write 矩阵（表驱动）；denylist 目录递归；`shouldSkipDirEntry`。
- 更新现有工具/路由测试反映新行为；`npm run verify` 通过。

## 开放问题

1. AI 写 `AGENTS.md` 能力移除是否可接受（见上）。
2. `agentTheme` 经 server-read（preview）是否必要——若前端只经专用 `/agents/:id/theme` 加载可移除。

## 官方文档同步

实现后更新 `docs/official/architecture.md`（路径安全/AI 访问限制小节）与 `data-conventions.md`（category 说明、`aiAccess.deniedPaths` 改为「禁读+禁写」）。
