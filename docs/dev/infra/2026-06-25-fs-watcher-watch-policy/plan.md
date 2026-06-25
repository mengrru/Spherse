# 实施计划 — fs watcher watch policy 复用 core path definition

设计文档：`docs/dev/infra/2026-06-25-fs-watcher-watch-policy/design.md`

## 范围与复杂度

本任务复杂度低：**1 个生产文件**（`packages/server/src/lib/fs-watcher.ts`，约 ±12 行）+ **1 个测试文件**；core 与前端零改动；无跨 package 接口变更；无并发/状态/迁移问题。故不拆分多 subagent，按两个顺序 task 推进（实现 → 验证）。

## 依赖图

```
T1 实现 ──→ T2 验证 + 文档
```

---

## T1 — 重写 watch policy

**文件：** `packages/server/src/lib/fs-watcher.ts`

**依赖：** 无（core 已导出 `categorizePath` / `PathCategory`，见 `packages/core/src/index.ts:10-11`）

**内容：**

1. import 改造（`fs-watcher.ts:1-2`）：
   - 移除 `import { PROJECT_META_DIR } from "@spherse/core"`
   - 新增 `import { categorizePath } from "@spherse/core"` + `import type { PathCategory } from "@spherse/core"`

2. 删除 `THEME_CSS` 常量（`fs-watcher.ts:4`）

3. 新增 `WATCHED_CATEGORIES` 常量（替代 `fs-watcher.ts:6-10` 的旧 `shouldReport`）：
   ```ts
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

4. 调用点 `fs-watcher.ts:43`（`if (!shouldReport(filename)) return;`）保持不变。

**要点（防止回退）：**
- watched set 必须含 `rootIndex`（`AGENTS.md`）+ `changelog`（`CHANGELOG.md`）——它们在项目根、不在 `.spherse` 下，今天本就被上报；漏掉会让 file-tree 不再因它们刷新。
- `agentTheme` 为本次新增（`.spherse/agents/*/theme.css`，与 projectTheme 对称）。
- node_modules/.git 按**任意段**匹配（本仓库是 npm workspace，存在 `packages/app/node_modules/...` 嵌套）。
- **不要**用 `shouldSkipDirEntry`：其 `startsWith(".")` 规则连 `.spherse` 一起过滤（`fs-walk.test.ts:7` 钉死），会误杀 `.spherse/theme.css` 与 agentTheme。

**测试文件：** `packages/server/src/__tests__/fs-watcher.test.ts`

**测试改造：**
1. 现有 case（`fs-watcher.test.ts:123-145`，"invokes all listeners on change, filters .spherse/ except theme.css"）：断言不变，但更新 `it(...)` 描述字符串以反映新规则（现规则为 `.spherse` 内 watch `projectTheme` + `agentTheme`，外加 node_modules/.git 降噪）。
2. 新增 case 锁定行为（按下表，合并进同一 `describe` 块或新增 `it`）：

   | 输入 filename | 期望 |
   |---|---|
   | `AGENTS.md` | 上报（防 rootIndex 回退） |
   | `CHANGELOG.md` | 上报（防 changelog 回退） |
   | `node_modules/pkg/index.js` | 忽略（顶层 node_modules） |
   | `packages/app/node_modules/x` | 忽略（嵌套 node_modules） |
   | `.git/config` | 忽略（.git 段） |
   | `.spherse/agents/bot/theme.css` | 上报（agentTheme 新增） |
   | `.spherse/agents/bot/profile.md` | 忽略（agentProfile） |
   | `.spherse/project.yaml` | 忽略（projectConfig） |

**验收：** `npm test --workspace=packages/server` 通过

---

## T2 — 验证 + 官方文档同步

**依赖：** T1

**内容：**
1. `npm run verify`（lint + build + unit tests + i18n check）全绿。
2. 官方文档同步（按 design.md「官方文档同步」节）：
   - `docs/official/architecture.md`：`fs-watcher.ts` 说明处补充「过滤决策基于 core `categorizePath` 的 watched-category 集合（`userFiles`/`rootIndex`/`changelog`/`projectTheme`/`agentTheme`），并对 `node_modules`/`.git` 段级降噪」。
   - `docs/official/project-structure.md`：`fs-watcher.ts` 条目注释同步同上。
   - `docs/dev/backlog.md`：若存在对应条目则勾选。
3. E2E：本改动不触达 Electron 启动 / 路由 / store / server API / file-tree UI 渲染逻辑（仅改 server 侧事件过滤），按 AGENTS.md 选择原则无需新 E2E；合并/发布前跑 `npm run verify:e2e`。

**验收：** `npm run verify` 通过；官方文档已同步。
