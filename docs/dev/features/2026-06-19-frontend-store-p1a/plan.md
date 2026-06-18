# 前端 Store 边界整理（P1a）— 实施计划

参照 `design.md`。每步独立可 commit，顺序按依赖关系排。步骤标记 `[设计 DN]` 对应 design 章节。

## 阶段 1：解耦 store 层（无 UI 影响）

### 步骤 1.1 — `getErrorMessage` 去 locale 化 `[设计 D1]`

**文件**：`packages/app/src/stores/project-data-store.ts`

- [ ] 删除 `:2` 的 `import { translate } from "@spherse/i18n"` 与 `:5` 的 `import { useSettingsStore }`
- [ ] `getErrorMessage(err)`（`:92-95`）改为：`return err instanceof Error ? err.message : "";`
- [ ] 核对所有 `error` 字段消费者，确保空串被 `t("error.requestFailed")` 兜底：
  - `features/agent-session-list/index.tsx:123`（`handleRenameSession` toast，已用 `?? t(...)` 兜底，确认空串也走兜底）
  - grep `state.error` / `projectData?.error` / `\.error` 找全所有消费者，逐个加 `|| t("error.requestFailed")`
- [ ] `project-data-store.test.ts` 增加 error-path 用例：抛非 Error 值时 `error === ""`；抛 Error 时 `error === err.message`
- [ ] 验证：`npm test --workspace=packages/app -- project-data-store`

**commit**：`refactor(app): decouple project-data-store from settings store`

---

## 阶段 2：引入 ProjectContext `[设计 D2]`

### 步骤 2.1 — 新建 ProjectContext

**新文件**：`packages/app/src/lib/project-context.tsx`

- [ ] 定义 `ProjectContextValue`（`projectId`、`client`、`baseUrl`、`projectRoot`）
- [ ] `ProjectProvider` + `useProjectCtx()`（缺失时 throw）+ `useProjectCtxOrNull()`
- [ ] Provider value 用 `useMemo`（依赖 `ctx` 引用），避免无谓重渲染

### 步骤 2.2 — ProjectLayout 挂 Provider

**文件**：`packages/app/src/layouts/ProjectLayout.tsx`

- [ ] 在最外层 `<div>` 内包一层 `<ProjectProvider projectId={projectId} ctx={project.ctx}>`
- [ ] 不改动子树消费方（下一步逐个迁）

### 步骤 2.3 — 迁移消费方到 useProjectCtx

按风险从低到高：

- [ ] `features/chat/HtmlCard.tsx`：移除 `useAppStore` 取 `activeProjectId`/`ctx`，改 `const { client, projectRoot } = useProjectCtx()`
- [ ] `features/debug-tools/DebugMenu.tsx`：`activeProjectId`+`projects` → `useProjectCtx()` 取 `client`/`baseUrl`；保留 `activeProjectId` 仅当仍需判断「有无 active project」（检查后若不需要则一并移除）
- [ ] `features/agent-session-list/index.tsx`：移除 `:48` 的 `useAppStore((state) => state.projects.get(projectId))`，改 `const { client } = useProjectCtx()`；其余 `project.ctx.client` 调用点（`:99, :113, :121, :135, :143, :150-151, :158, :262`）全部改用 `client`
- [ ] `ui-sdk/use-spherse-message-listener.ts`：改签名为 `useSpherseMessageListener(projectId, ctx)` 或内部 `useProjectCtx()`；`ProjectLayout.tsx:64` 调用处同步更新。注意 listener 的 effect 依赖列表要相应调整
- [ ] `features/floating-chat/FloatingChatManager.tsx`：`client`/`baseUrl` 走 `useProjectCtx()`；保留 `activeProjectId`（floating 跟随 active project）

### 步骤 2.4 — 测试与验证

- [ ] 检查 `ProjectLayout.structure.test.ts` 是否需要更新（新增 Provider 不应破坏断言）
- [ ] grep 确认 `projects.get(.*).ctx.client` / `project.ctx.client` 模式已消除（允许 ProjectLayout 顶层仍取 `project.ctx` 作为 Provider value 来源）
- [ ] `npm run lint --workspace=packages/app && npm test --workspace=packages/app`

**commit**：`refactor(app): introduce ProjectContext for ctx.client access`

---

## 阶段 3：collapsedAgentIds 下沉 `[设计 D3]`

### 步骤 3.1 — 新建 feature store

**新文件**：`packages/app/src/features/agent-session-list/store.ts`

- [ ] 定义 `AgentSessionListUiStore`：`collapsedAgentIdsByProject`、`toggleAgentCollapsed`、`setCollapsedAgentIds`、`getCollapsedAgentIds(projectId)`、`clearProject(projectId)`
- [ ] 复用 project-ui-store 现有的 Set 操作逻辑

### 步骤 3.2 — 从 project-ui-store 移除

**文件**：`packages/app/src/stores/project-ui-store.ts`

- [ ] 从 `ProjectUiState`（`:9-12`）移除 `collapsedAgentIds`
- [ ] 从 `ProjectUiStore`（`:14-21`）移除 `toggleAgentCollapsed`、`setCollapsedAgentIds`
- [ ] 删除实现（`:61-78`）与 `createProjectUi` 中的初始化
- [ ] `ProjectUiState` 只剩 `floatingChat?`

### 步骤 3.3 — AgentSessionList 改用 feature store

**文件**：`packages/app/src/features/agent-session-list/index.tsx`

- [ ] `:50` `useProjectUiStore` → 仅保留 `floatingChat` 读取（见步骤 4.2 改用 `useFloatingSessionId`）
- [ ] `:57-58` `toggleAgentCollapsed`/`setCollapsedAgentIds` → 从新 feature store 取
- [ ] `:68` `collapsedAgentIds` → `useAgentSessionListUiStore((s) => s.getCollapsedAgentIds(projectId))`
- [ ] `:77, :83-89` effect 中的 `setCollapsedAgentIds` → feature store 版本

### 步骤 3.4 — 关闭项目时清理

**文件**：`packages/app/src/App.tsx`

- [ ] `handleCloseProject`（`:68-78`）在 `clearProjectData`/`clearProjectUi` 旁加 `clearAgentSessionListUi(projectId)`

### 步骤 3.5 — 测试迁移

- [ ] `project-ui-store.test.ts` 中 collapsedAgentIds 用例迁移到新 `features/agent-session-list/store.test.ts`
- [ ] 新 store 补 `clearProject` 用例
- [ ] `npm test --workspace=packages/app`

**commit**：`refactor(app): move collapsedAgentIds to agent-session-list feature store`

---

## 阶段 4：合并重复派生 `[设计 D4]`

### 步骤 4.1 — useSidePanel hook

**新文件**：`packages/app/src/hooks/useSidePanel.ts`

- [ ] 实现 D4a 的 `useSidePanel()`（返回 `pinned`/`visible`/`clickAwayActive`/`show`/`hide`/`togglePin`）

**改造消费者**：

- [ ] `features/activity-bar/index.tsx:39-44` → `const { pinned, visible, togglePin, show, hide } = useSidePanel()`
- [ ] `features/project-panel/index.tsx:37-41` → `const { pinned, visible, show, hide } = useSidePanel()`

### 步骤 4.2 — useFloatingSessionId hook + 删除 useSidePanelClickAway

**新文件**：`packages/app/src/features/floating-chat/use-floating-session-id.ts`

- [ ] 实现 D4b 的 `useFloatingSessionId(projectId)`

**删除**：`packages/app/src/hooks/useSidePanelClickAway.ts`

- [ ] 逻辑并入 `useSidePanel`：新增 `clickAwayProps` 返回值（`clickAwayActive ? { onClick: hide } : {}`）
- [ ] `ProjectLayout.tsx:38, 159` 的 `useSidePanelClickAway()` → `const { clickAwayProps } = useSidePanel()`，spread 到 `<main>`

**改造消费者**：

- [ ] `layouts/ProjectLayout.tsx:52-54` → `useFloatingSessionId(projectId)`
- [ ] `features/agent-session-list/index.tsx:59` → `useFloatingSessionId(projectId)`
- [ ] `hooks/useFloatingChatRedirect.ts:7-9` → `useFloatingSessionId(projectId)`（此文件随后在阶段 6 迁移，此处先改 import）

- [ ] grep 确认无残留 `floatingChat?.sessionId` 直接 selector
- [ ] `npm test --workspace=packages/app`

**commit**：`refactor(app): consolidate sidePanel and floatingSessionId selectors`

---

## 阶段 5：FloatingChatManager render-setState 修复 `[设计 D5]`

**文件**：`packages/app/src/features/floating-chat/FloatingChatManager.tsx`

- [ ] 把 `:24-27` 的 render 体清理改成 `useEffect`（见 design D5 代码）
- [ ] render 体的早返回条件改为不触发副作用
- [ ] 确认 `setFloatingChat` 通过 hook selector 取（而非 `getState()`）

- [ ] 手动验证：构造孤儿 floating session（手动改 store 或快速切换 session），确认不再有 React 告警
- [ ] `npm test --workspace=packages/app`

**commit**：`fix(app): move floating chat orphan cleanup out of render`

---

## 阶段 6：移走错放文件 `[设计 D6]`

### 步骤 6.1 — useFloatingChatRedirect 迁入 floating-chat

- [ ] `git mv packages/app/src/hooks/useFloatingChatRedirect.ts packages/app/src/features/floating-chat/use-floating-chat-redirect.ts`
- [ ] 更新内部 import 路径（`useFloatingSessionId` 现在同目录）
- [ ] 更新 `ProjectLayout.tsx:17` 的 import 路径

### 步骤 6.2 — AgentDialog + SearchFileField 迁入 agent-session-list

- [ ] `git mv packages/app/src/components/AgentDialog.tsx packages/app/src/features/agent-session-list/AgentDialog.tsx`
- [ ] `git mv packages/app/src/components/SearchFileField.tsx packages/app/src/features/agent-session-list/SearchFileField.tsx`
- [ ] 更新 `AgentDialog` 内对 `SearchFileField` 的 import（同目录）
- [ ] 更新 `agent-session-list/index.tsx:4` 的 import（`../../components/AgentDialog` → `./AgentDialog`）
- [ ] grep 确认无其它消费者

- [ ] `npm run lint --workspace=packages/app`

**commit**：`refactor(app): relocate misplaced hooks and components to owning features`

---

## 阶段 7：统一 scopeCss `[设计 D7a]`

### 步骤 7.1 — 抽出 scopeCss 工具

**新文件**：`packages/app/src/lib/scope-css.ts`

- [ ] 实现 `scopeCss(css: string, scope: string): string`（从 `useAgentTheme.ts:4-50` 提取，scope 参数化）
- [ ] 可选：补 `lib/scope-css.test.ts`（给定含选择器/`@media`/CSS 变量的输入，断言两种 scope 输出）

### 步骤 7.2 — 两侧改用工具

- [ ] `features/chat/hooks/useAgentTheme.ts:4-50` 删除 `scopeCss`，`:62` 改 `scopeCss(css, "[data-chat-root]")`
- [ ] `features/floating-chat/FloatingChatContainer.tsx:9-46` 删除 `scopeCssToFloat`，`:71` 改 `scopeCss(css, "[data-chat-float-root]")`

- [ ] 检查 `packages/presets/skills/create-agent-chat-theme/` 是否需要同步说明（AGENTS.md 要求；若 skill 文档引用了具体实现位置则更新，否则仅确认行为不变）

**commit**：`refactor(app): unify scopeCss implementation`

---

## 阶段 8：文档与收尾 `[设计 D8]`

### 步骤 8.1 — AGENTS.md 补 feature-local store 说明

- [ ] 在「前端 store 使用原则」末尾补充 feature-local store 条目（见 design D8 文案）
- [ ] 更新 `docs/official/project-structure.md`（若有前端 store 章节）

### 步骤 8.2 — backlog 与 official 文档同步

- [ ] `docs/dev/backlog.md`：若已有「前端重构」条目则标记 P1a 完成；无则新增
- [ ] 检查 `docs/official/` 是否需要反映 `components/` 精简、feature store 新增

### 步骤 8.3 — 全量验证

- [ ] `npm run verify`
- [ ] 受影响 E2E（按需）：`npm run test:e2e --workspace=packages/app -- e2e/file-tree.spec.ts`（AgentDialog 迁移）；chat/session spec 若有 floating/side-panel 覆盖则跑
- [ ] 手动联调清单（design「验证」节）

**commit**：`docs: document feature-local store pattern and P1a completion`

---

## 执行顺序总览

```
1.1 getErrorMessage 去 locale
 ├─ 2.1-2.4 ProjectContext（依赖 1.1 让 store 层干净）
 │   ├─ 3.1-3.5 collapsedAgentIds 下沉
 │   ├─ 4.1-4.2 useSidePanel + useFloatingSessionId（含删 useSidePanelClickAway）
 │   ├─ 5   FloatingChatManager render-setState
 │   ├─ 6.1-6.2 文件迁移
 │   └─ 7.1-7.2 scopeCss 统一
 └─ 8.1-8.3 文档 + 全量验证
```

阶段 3-7 之间无强依赖，可并行或按便利顺序调整；阶段 8 最后。
