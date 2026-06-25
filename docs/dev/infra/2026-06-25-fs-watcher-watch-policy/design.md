# fs watcher watch policy 复用 core path definition

## 背景

`packages/server/src/lib/fs-watcher.ts` 是项目唯一的文件系统监听器（原生 `fs.watch`，`{recursive:true}`，按 `projectId` 引用计数共享）。它决定「哪些路径变更需要上报给前端」的逻辑——即 **watch policy**——目前是一个手写的内联函数 `shouldReport()`：

```ts
// packages/server/src/lib/fs-watcher.ts:4-10
const THEME_CSS = `${PROJECT_META_DIR}/theme.css`;

function shouldReport(filename: string): boolean {
  if (!filename.startsWith(PROJECT_META_DIR)) return true;   // .spherse/ 之外全部上报
  const normalized = filename.replace(/\\/g, "/");
  return normalized === THEME_CSS;                            // .spherse/ 内仅 theme.css 上报
}
```

这段逻辑与 `@spherse/core` 已建立的 **path definition** 体系重复并背离：

1. **语义重复**：`.spherse/theme.css` 在 core 里就是 `PathCategory = "projectTheme"`（`packages/core/src/access/path-category.ts:23` 的 `PATH_PATTERNS`）。watcher 用字符串字面量 `THEME_CSS` 重新表达了一遍同样的知识。该字面量在仓库中共出现 **3 处**：`fs-watcher.ts:4`、`packages/app/src/hooks/useCustomTheme.ts:4`（`THEME_CSS_PATH`）、以及 core 的 `PATH_PATTERNS`（唯一真相）。
2. **归一化重复**：watcher 手写 `filename.replace(/\\/g, "/")` 做 posix 化，而 `categorizePath` 内部的 `normalizeInput`（`path-category.ts:60-62`）已做 `\\` → `/` + `path.posix.normalize` + 去掉 `./` 前缀，且按 `/` 边界判断目录归属（比 `startsWith(PROJECT_META_DIR)` 更严谨，规避 `.spherseXxx` 这类无 `/` 的同级误判）。
3. **割裂**：core 侧已经围绕 `PathCategory` 建立了完整的 per-category 策略矩阵（`LLM_READ/WRITE`、`SRV_READ/WRITE`，见 `access-policy.ts`），唯独 watcher 这一维度游离在外，用独立的字符串判断维护。

本次重构把 watch policy 收敛到 core 的 path definition 上：watcher 不再自行解释路径，而是调用 core 的 `categorizePath()` 拿到 category，再据本地策略表决定是否上报。

## 目标

1. **复用 path definition**：watcher 的过滤决策基于 core 的 `categorizePath(filename)`，移除 `THEME_CSS` 字面量与手写 posix 归一化。
2. **行为变更收敛为两点**：(a) 新增上报 `agentTheme`；(b) 新增段级降噪 `node_modules`/`.git`（含嵌套，见下）。除此之外被 watch 的路径集合与今天完全一致。
3. **新增 watch agentTheme**：把 `.spherse/agents/*/theme.css`（`agentTheme`）纳入上报，使 agent 主题文件变更能被前端感知（与 `projectTheme` 对称——同属用户可编辑 CSS 主题，支持热重载）。
4. **策略留 server**：watched-category 决策表留在 `fs-watcher.ts` 内本地定义（watcher 运行时关注点不进 core）；core 不新增导出，只继续暴露已有的 `categorizePath` 与 `PathCategory`。
5. **结构化留口子**：用 `ReadonlySet<PathCategory>` 表达策略，使「以后想多 watch 某个 `.spherse` 子树」成为改一行的事，且新 category 加入 `PATH_PATTERNS` 时不会静默穿透。

## 方案

### 决策机制

用 core 的 category 分类 + server 本地的 watched-category 集合：

```ts
// packages/server/src/lib/fs-watcher.ts（改后）
import { categorizePath } from "@spherse/core";
import type { PathCategory } from "@spherse/core";

/** 上报这些 category 的变更；其余忽略。 */
const WATCHED_CATEGORIES: ReadonlySet<PathCategory> = new Set([
  "userFiles",
  "rootIndex",
  "changelog",
  "projectTheme",
  "agentTheme",
]);

function shouldReport(filename: string): boolean {
  const segs = filename.replace(/\\/g, "/").split("/");
  if (segs.includes("node_modules") || segs.includes(".git")) return false;
  return WATCHED_CATEGORIES.has(categorizePath(filename));
}
```

- 移除 `PROJECT_META_DIR` / `THEME_CSS` import 与常量。category 查找的归一化交给 `categorizePath` 内部 `normalizeInput`；仅保留一次 `\\`→`/` 用于拆分路径段做 node_modules/.git 降噪（Windows 跨平台）。
- 保留 `shouldReport` 这个函数名与调用点（`fs-watcher.ts:43`），最小化改动面。
- `ReadonlySet<PathCategory>` 与 core 的 `LLM_*`/`SRV_*` Set 惯用法一致，可读且易扩展。

### 降噪：node_modules / .git

`node_modules`/`.git` 在 core 里归 `userFiles`，会通过 category 过滤、今天被上报。但它们是高频噪音（依赖增删、git 内部写），触发 `useFsWatchRefresh` 的 300ms 全量 file-tree 刷新毫无价值。本次在 `shouldReport` 入口先做**段级**过滤：路径任一段为 `node_modules` 或 `.git` 即忽略。

- **段级而非仅顶层**：本仓库是 npm workspace，`packages/app/node_modules/foo` 这类嵌套也存在；按任意段匹配才能与 `list_files` / file-tree 的递归目录裁剪一致。
- **不直接复用 `shouldSkipDirEntry`**：它是 **name-segment 作用域**——所有调用方都传单个 `entry.name`（`file-tree.ts:30`、`list-files.ts:29`/`49`、`search-content.ts:90`），而非相对路径；直接喂 `filename` 对 `node_modules/pkg/index.js` 返回 `false`（整串不等于 `node_modules`）。更关键的是其 `startsWith(".")` 规则会把 `.spherse` 一并过滤（`fs-walk.test.ts:7` 钉死 `shouldSkipDirEntry(".spherse") === true`），从而误杀 `.spherse/theme.css` 与 `agentTheme`——正是本设计要保留的上报项。故显式只取 `node_modules`/`.git` 两个段，避开冲突的 dotdir 规则；`.spherse/**` 的取舍交由 category 过滤精确处理。

### 关键正确性点：不可遗漏 rootIndex / changelog

这是本次重构最易踩的坑。今天 `shouldReport` 上报的是「`.spherse/` 之外的**一切** + `.spherse/theme.css`」。把「`.spherse/` 之外」映射到 `PathCategory`，得到的是**三个** category：

| 「`.spherse/` 之外」的实际路径 | `categorizePath` 归属 |
|---|---|
| `lore/timeline.md`、`src/x.ts` 等所有项目内容（`node_modules`/`.git` 除外，它们在入口被段级降噪剔除） | `userFiles`（兜底） |
| `AGENTS.md`（项目根，非 `.spherse` 下） | `rootIndex` |
| `CHANGELOG.md`（项目根，非 `.spherse` 下） | `changelog` |

加上 `.spherse/` 内需要 watch 的类目（与 projectTheme 同属用户可编辑 CSS 主题）：

| `.spherse/` 内 watch 项 | `categorizePath` 归属 |
|---|---|
| `.spherse/theme.css` | `projectTheme`（历史即被上报） |
| `.spherse/agents/*/theme.css` | `agentTheme`（本次新增） |

因此 watched 集合 = `{ userFiles, rootIndex, changelog, projectTheme, agentTheme }`（其中 `agentTheme` 为本次新增，其余 4 类目用于等价保持今天的行为）。

> **陷阱**：若只按「用户内容 + 主题」语义误写成 `{ userFiles, projectTheme, agentTheme }`，会**静默丢弃** `AGENTS.md`（`rootIndex`）与 `CHANGELOG.md`（`changelog`）的变更事件。后果：`useFsWatchRefresh`（`packages/app/src/features/file-tree/hooks/useFsWatchRefresh.ts:10`，对任意事件做 300ms debounce 全量刷新 file-tree）将不再因编辑 `AGENTS.md`/`CHANGELOG.md` 而刷新。这是无声的行为回退，本设计明确保留 rootIndex/changelog。

### 策略矩阵（watch 维度）

| Category | 路径示例 | watch 上报 |
|---|---|---|
| `userFiles` | `lore/x.md`、`src/x.ts` | ✓ |
| `rootIndex` | `AGENTS.md` | ✓ |
| `changelog` | `CHANGELOG.md` | ✓ |
| `projectTheme` | `.spherse/theme.css` | ✓ |
| `projectConfig` | `.spherse/project.yaml` | ✗ |
| `generatedImages` | `.spherse/generated-images/**` | ✗ |
| `skills` | `.spherse/skills/**` | ✗ |
| `agentProfile` | `.spherse/agents/*/profile.md` | ✗ |
| `agentTheme` | `.spherse/agents/*/theme.css` | ✓（本次新增） |
| `agentSessions` | `.spherse/agents/*/sessions.db` | ✗ |
| `agentSchedules` | `.spherse/agents/*/schedules.yml` | ✗ |
| `agentScheduleLogs` | `.spherse/agents/*/schedule-logs.jsonl` | ✗ |
| `spherseOther` | `.spherse/**` 未匹配（兜底） | ✗ |

> 说明：`node_modules/**` / `.git/**` 在 core 里归 `userFiles`（会通过 category 过滤），但在 `shouldReport` 入口被**段级降噪**先行剔除（见上节），不再上报。这避免了依赖增删 / git 内部写触发 file-tree 全量刷新。

## 边界情况（透明、可忽略）

- **`.sphersefoo` 这类同级路径**（无 `/`）：今天 `"x".startsWith(".spherse")` 对 `.sphersefoo` 返回 `true` → 被当作 `.spherse/` 内 → 非 theme.css → **不上报**。改用 `categorizePath` 后，`.sphersefoo` 不匹配 `.spherse/**`（需 `/` 边界）→ 归 `userFiles` → **上报**。
  - 影响面：项目内不存在此类真实文件，无实际影响。
  - 方向：这反而与 core 的路径边界语义一致（`path-category` 用 `/` 边界、`isPathInside` 用 `path.relative` 判断，AGENTS.md 明确反对 `startsWith` 前缀误判）。属对齐而非回退。
- **`fs.watch` 的 `filename`** 已是相对项目根的路径，直接喂给 `categorizePath` 即可；`normalizeInput` 会处理 Windows 反斜杠与 `./` 前缀。
- **payload 契约不变**：`evt.path = filename`（`fs-watcher.ts:46`）原样透传给前端，本次只改「过滤」，不改「上报内容」。前端各 handler 的 `payload.path?.replace(/\\/g,"/")` 惯用法不受影响。

## 模块结构 / 改动范围

```
packages/core/src/access/path-category.ts   # 不改（已导出 categorizePath / PathCategory）
packages/server/src/lib/fs-watcher.ts       # 唯一改动：shouldReport 改用 categorizePath
packages/server/src/__tests__/fs-watcher.test.ts  # 补 case 锁定行为
```

**改动清单：**
- `fs-watcher.ts`：import 从 `{ PROJECT_META_DIR }` 改为 `{ categorizePath }` + `type { PathCategory }`；删除 `THEME_CSS` 常量；`shouldReport` 改为「node_modules/.git 段级降噪 + `WATCHED_CATEGORIES.has(categorizePath(filename))`」；新增 `WATCHED_CATEGORIES` 常量。约 ±12 行。
- core：**无改动**（零新增导出）。
- 前端：**无改动**。

**明确不在本次范围（未来工作）：**
- `packages/app/src/hooks/useCustomTheme.ts:4` 的 `THEME_CSS_PATH` 是该字面量的第 3 处副本。但它是**渲染进程侧**的事件过滤（决定收到 `fs-watch` 事件后是否重载主题 `<link>`），渲染层当前不 import `@spherse/core`；统一它需要让 renderer 复用 core 的纯分类逻辑（`categorizePath` 是纯函数，理论可共享，但涉及 renderer 构建/依赖边界），属独立变更，不在本次纯重构内。本设计仅在文档中标注其为已知重复。

## 测试

现有 `fs-watcher.test.ts:123-145`（「invokes all listeners on change, filters .spherse/ except theme.css」）的断言保持绿——它只探测 `src/bar.ts`（上报）、`.spherse/theme.css`（上报）、`.spherse/sessions/abc.json`（忽略）、`null`（忽略），未涉及 agent 主题，故不受 `agentTheme` 新增影响。但其描述字符串「filters .spherse/ except theme.css」已窄于新行为（现规则为「except projectTheme + agentTheme」），实现时应同步更新该 case 的描述。

补充以下 case 以**锁定行为**并防止 rootIndex/changelog 回退：

| 输入 filename | 期望 | 锁定的 category |
|---|---|---|
| `AGENTS.md` | 上报 | `rootIndex`（防回退关键） |
| `CHANGELOG.md` | 上报 | `changelog`（防回退关键） |
| `node_modules/pkg/index.js` | 忽略 | 段级降噪：顶层 node_modules |
| `packages/app/node_modules/x` | 忽略 | 段级降噪：嵌套 node_modules |
| `.git/config` | 忽略 | 段级降噪：.git |
| `.spherse/agents/bot/theme.css` | 上报 | `agentTheme`（本次新增） |
| `.spherse/agents/bot/profile.md` | 忽略 | `agentProfile`（确认 `.spherse/` 内仅主题类被 watch） |
| `.spherse/project.yaml` | 忽略 | `projectConfig` |

- 命令：`npm test --workspace=packages/server`（含 fs-watcher 契约测试）。
- 全量回归：`npm run verify`（lint + build + unit + i18n）。fs-watcher 改动不触达 Electron 启动/路由/store/server API/file-tree UI，按 AGENTS.md 的 E2E 选择原则无需新 E2E；合并/发布前再跑 `npm run verify:e2e`。

## 官方文档同步

实现后更新：
- `docs/official/architecture.md`：`fs-watcher.ts` 说明处补充「过滤决策基于 core `categorizePath` 的 watched-category 集合（`userFiles`/`rootIndex`/`changelog`/`projectTheme`/`agentTheme`）」。
- `docs/official/project-structure.md`：`fs-watcher.ts` 条目注释同步同上。
- `docs/dev/backlog.md`：若有对应条目则勾选；无则无需新增。

## 开放问题 / 未来工作

1. 渲染层 `useCustomTheme.ts` 的 `THEME_CSS_PATH` 副本是否要统一到 core 分类？——独立议题，需评估 renderer 复用 `@spherse/core` 纯函数的构建边界。
2. 若未来要 watch 更多 `.spherse` 子树（如 `generatedImages` 以支持生成图实时刷新），只需把对应 category 加入 `WATCHED_CATEGORIES`——这是本设计为后续扩展留的口子。`agentTheme` 已在本次纳入。
