# 实施计划：自定义主题体验优化

> Date: 2026-06-26
> Design: `docs/dev/features/2026-06-26-theme-customization-experience/design.md`

## 并行策略

任务间无文件重叠，分两个 phase：

- **Phase A**（并行）：T1、T2、T3 三组改动无共享文件，可同时由 subagent 执行
- **Phase B**（并行，依赖 A 完成）：T4、T5 依赖 token 名 / 钩子名 / nesting 方案确定，无共享文件，可同时执行
- **Phase C**：全量验证（lint / build / 手动 / E2E）

### 文件归属（确认无冲突）

| Task | 文件 |
|------|------|
| T1 token rename | `styles.css`、`Header.tsx`、`DiffViewer.tsx`、`FileViewerCard.tsx` |
| T2 data-* hooks | `MessageItem.tsx`、`Composer.tsx`、`MarkdownContent.tsx`、`FloatingChatFrame.tsx`、`ContentView.tsx` |
| T3 scopeCss 移除 + reload | `scope-css.ts`（删）、`useAgentTheme.ts`、`FloatingChatContainer.tsx`、`chat/index.tsx` |
| T4 skills/templates | `create-ui-theme/SKILL.md`、`create-agent-chat-theme/SKILL.md`、`agent-theme-template.css` |
| T5 docs | `architecture.md`、`project-structure.md`、`data-conventions.md`、`AGENTS.md`、`backlog.md` |

---

## Phase A — 核心代码（并行）

### T1. Token 重命名（`--shadcn-*` / `--agent-*` → `--sp-*`）

**目标**：所有 design token 统一到 `--sp-` 命名空间。

**`packages/app/src/styles.css`**（按 design 1.1 映射表）：
- `:root`（行 6-35）：所有 `--shadcn-*` → `--sp-*`；`--agent-diff-added` → `--sp-diff-added`；`--radius` → `--sp-radius`
- dark `@media`（行 37-67）：同步改名
- `@theme inline`（行 69-101）：右侧引用改为 `var(--sp-*)`；半径 `--radius-lg: var(--sp-radius)` 等；新增 `--color-success`/`--color-success-foreground`/`--color-warning`/`--color-warning-foreground`/`--color-diff-added`
- `@layer base`（行 109-110）：`var(--shadcn-foreground)` → `var(--sp-foreground)`，`var(--shadcn-background)` → `var(--sp-background)`
- **新增 token 默认值**（参考 shadcn neutral 语义）：light 下 `--sp-success: #16a34a`、`--sp-success-foreground: #ffffff`、`--sp-warning: #ea580c`、`--sp-warning-foreground: #ffffff`；dark 下 `--sp-success: #22c55e`、`--sp-success-foreground: #052e16`、`--sp-warning: #f97316`、`--sp-warning-foreground: #1c1917`

**组件 Tailwind 类名修正**（这些类走 `--color-*` 桥接，改名后类名也变）：
- `Header.tsx:62` — `text-agent-success` → `text-success`
- `DiffViewer.tsx:53` — `bg-agent-diff-added/10` → `bg-diff-added/10`
- `FileViewerCard.tsx:67` — `bg-agent-diff-added/20 text-agent-diff-added` → `bg-diff-added/20 text-diff-added`

**验证**：`npm run build --workspace=packages/app` 通过；`npm run lint --workspace=packages/app` 通过。

---

### T2. data-* 钩子补齐

**目标**：补齐聊天 + 文档视图的 DOM 钩子，去除脆弱位置选择器。

| 文件 | 改动 |
|------|------|
| `MessageItem.tsx:26` | 内层气泡 `<div>` 加 `data-chat-bubble`（保留 className） |
| `Composer.tsx:86` | 输入框外框 `<div>` 加 `data-chat-composer-input` |
| `FloatingChatFrame.tsx` | close `<button>` 加 `data-chat-float-close` |
| `ContentView.tsx:81` | 文档容器 `<div>` 加 `data-content-doc` |
| `MarkdownContent.tsx` | `CHAT_COMPONENTS` **与** `DOCUMENT_COMPONENTS` 的 `pre`/`code`/`blockquote` 加属性：`pre` → `data-md-code`；`code` → `data-md-code-inline`；`blockquote` → `data-md-quote` |

**MarkdownContent 注意点**：
- `pre` 内部的 `code` 会自动渲染，不要给它加 `data-md-code-inline`（由外层 `pre` 的 `data-md-code` 代表）。实现上 react-markdown 的 `pre` 组件接收的 children 通常是单个 `code`，给 `pre` 加 `data-md-code`、给 `code` 加 `data-md-code-inline`，嵌套时两者都出现但语义由最外层块元素表达——可接受（主题作者用 `[data-md-code]` 选 `pre` 即可）
- 两个 Components 对象用同一组属性名，作用域由父选择器表达

**验证**：`npm run build --workspace=packages/app` 通过。

---

### T3. 移除 `scopeCss` + Chat Theme 自动重载

**目标**：改用原生 CSS nesting；renderer 端订阅 fs-watch 实现自动重载。

**删除**：
- `packages/app/src/lib/scope-css.ts`
- 全仓确认无残留 import（grep `scope-css` / `scopeCss`）

**`packages/app/src/features/chat/hooks/useAgentTheme.ts`**：
- 去掉 `import { scopeCss }` 与 `scopeCss(css, "[data-chat-root]")` 调用
- 直接返回原始 CSS 文本（state 重命名 `themeCss` 更准确，或保留 `scopedCss` 但内容是原始 CSS——推荐重命名为 `themeCss`）
- hook 签名增加 `projectId: string | undefined` 参数
- 新增 fs-watch 订阅（复用 `useCustomTheme.ts` 的 `useBusSubscription(projectId, "fs-watch", handler)` 模式）：
  - 抽出内部 `fetchTheme()` 函数（fetch + setState，避免 effect 和 handler 重复）
  - handler 规范化 path（`replace(/\\/g, "/")`），宽松匹配 `path.includes("agents/") && path.endsWith("theme.css")`
  - 命中后 debounce ~250ms refetch（用 `setTimeout`/`useRef` timer，cleanup 时 clear）
- 依赖数组：`[client, agentId, projectId]`

**`packages/app/src/features/floating-chat/FloatingChatContainer.tsx`**：
- 去掉 `scopeCss(css, "[data-chat-float-root]")`，直接用原始 CSS
- 同样加 fs-watch 订阅 + debounce refetch（与 useAgentTheme 共用匹配逻辑——可抽到 `useAgentTheme.ts` 导出的 `isAgentThemePath(path)` 辅助函数，或就近内联；优先内联避免过度抽象，两边逻辑简单且一致）

**`packages/app/src/features/chat/index.tsx`**：
- 调用 `useAgentTheme` 时传入 `projectId`（从 `useProjectCtx()` 取，或现有 props）
- `<style>{scopedThemeCss}</style>` 内容已是原始 CSS，注入方式不变（变量名随 hook 返回值更新即可）

**验证**：
- `npm run build --workspace=packages/app` 通过
- `npm run lint --workspace=packages/app` 通过
- 确认 grep `scopeCss` 全仓无结果

---

## Phase B — 文档（并行，依赖 A）

### T4. Presets skill 文档与模板

依赖 T1（token 名）、T2（钩子名）、T3（nesting 写法）全部确定后执行。

**`packages/presets/skills/create-ui-theme/SKILL.md`**：
- 全部变量名 `--shadcn-*` → `--sp-*`（含映射表、示例、默认值表）
- 补齐新增 token（success/warning 及 foreground）
- 新增「全局 chat 默认样式」章节：示范在 `.spherse/theme.css` 写 `[data-chat-root] { ... }` nesting 块
- 新增「文档视图 markdown 样式」示例：`[data-content-doc] [data-md-code]`、`[data-md-quote]` 等
- dark mode 示例保持 `@media (prefers-color-scheme: dark) { :root { ... } }`（项目级用 `:root`，chat 用 nesting）

**`packages/presets/skills/create-agent-chat-theme/SKILL.md`**：
- **重写核心章节**：从「scopeCss 自动加前缀，不要写 `[data-chat-root]`」改为「原生 CSS nesting，最外层 `[data-chat-root] { ... }`」
- 移除所有「Scope Gotchas」段落
- 新增「层叠关系」说明：agent theme 覆盖 project theme 的 chat 默认样式（三级层叠模型 2.4）
- 变量名 `--shadcn-*` → `--sp-*`
- 选择器示例改用 `data-chat-bubble` / `data-chat-composer-input` / `data-chat-float-close` / `data-md-*`
- 新增「暗色适配」章节：嵌套 `@media (prefers-color-scheme: dark) { ... }` 写在 `[data-chat-root]` 内

**`packages/presets/templates/agent-theme-template.css`**：
- **整体重写为 nesting 结构**：最外层 `[data-chat-root] { ... }`，内部嵌套各选择器
- 变量名 → `--sp-*`
- 用新钩子（`data-chat-bubble` 等）
- 加 light/dark 双调色板示例（嵌套 `@media`）
- 保持「全部注释掉」的模板风格（新建 agent 时默认空样式）

**构建**：
- `npm run build --workspace=packages/presets`（触发 `sync-templates.mjs` 生成 `src/generated/`）
- 确认 `packages/presets/src/generated/agent-theme-template.ts` 内容更新

**验证**：`npm run build --workspace=packages/presets` 通过。

---

### T5. 官方文档 + AGENTS.md + Backlog

依赖 T1-T3 的方案确定。

**`docs/official/architecture.md`**（前端样式章节，约 85-99 行）：
- token 命名说明 → `--sp-*`
- 业务 token 说明 → `--sp-{name}` + `--color-{name}` 映射
- agent 主题改用原生 CSS nesting（废弃 scopeCss）；说明三级层叠模型（2.4）
- data-* 钩子清单补齐（`data-chat-bubble`/`data-chat-composer-input`/`data-chat-float-close`/`data-md-*`/`data-content-doc`）
- chat dark mode 跟随 OS（嵌套 `@media`）
- chat theme 自动重载（fs-watch 已覆盖 `agentTheme`）

**`docs/official/project-structure.md`**：移除 `scope-css.ts` 条目（约 166 行）

**`docs/official/data-conventions.md`**：token 相关描述同步（如有 `--shadcn-*` / `--agent-*` 引用）

**`AGENTS.md`**（前端样式规范段）：
- 示例 `bg-agent-creator` / `text-agent-success` → 正确 token（`text-success` 等）
- token 命名规范说明 → `--sp-*`

**`docs/dev/backlog.md`**：
- 行 56（`[ ] 内置 Skill：主题制作 Skill`）→ `[x]`，注明本次更新
- 新增条目指向本 design doc

**验证**：文档链接、token 名与代码一致。

---

## Phase C — 验证

1. `npm run lint`（全仓）
2. `npm run build`（全仓，含 presets sync）
3. 手动验证（运行 `npm run dev`）：
   - 编辑 `.spherse/agents/*/theme.css`，chat/floating 窗口自动重载（不需重开）
   - chat theme 写嵌套 `@media (prefers-color-scheme: dark)`，切 OS 外观后聊天窗口暗色生效、不污染全局
   - 项目 `.spherse/theme.css` 写 `[data-content-doc] [data-md-code] { ... }`，文档视图 markdown 生效
   - agent theme 写 `[data-chat-root] { [data-md-code] { ... } }`，聊天 markdown 生效
   - 幽灵 token（`text-agent-success`、`bg-agent-creator`）已消除
   - `scopeCss` 无残留 import
4. E2E（按需）：`npm run test:e2e --workspace=packages/app -- <chat/content-browser 相关 spec>`
5. 提醒用户 commit 前检查 backlog / official docs 是否同步（本计划已含）

---

## Subagent 执行清单

| Task | Phase | 依赖 | 可并行 | 描述 |
|------|-------|------|--------|------|
| T1 | A | — | ✅ 与 T2/T3 | Token 重命名 |
| T2 | A | — | ✅ 与 T1/T3 | data-* 钩子补齐 |
| T3 | A | — | ✅ 与 T1/T2 | 移除 scopeCss + reload |
| T4 | B | T1+T2+T3 | ✅ 与 T5 | Presets skill/模板 |
| T5 | B | T1+T2+T3 | ✅ 与 T4 | 官方文档 + AGENTS + backlog |

每个 subagent 完成后跑 `npm run build --workspace=<相关>` 自检，全量验证在 Phase C 统一执行。
