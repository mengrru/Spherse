# 前端路由 / Layout 重构 + Store 收尾（P0 + P1b）— 实施计划

参照 `design.md`。改动面大，按依赖关系分阶段。每步独立可 commit。步骤标记 `[设计 DN]`。

## 阶段总览

```
1 路由骨架（真嵌套 + ProjectScope + page 组件壳）
 ├─ 2 搬生命周期 effect 到 ProjectScope（theme/listener/lastRoute/refresh/WS）
 │   └─ 3 消除 key={projectId} + 条件性刷新 + WS t-dependency 修复
 ├─ 4 content 路由去 sessionId + 统一 content URL builder
 ├─ 5 FloatingChatManager 改读 URL（D3 active project 真相源统一）
 ├─ 6 DebugMenu 用 useMatch（消除手写解析）
 ├─ 7 ActivityBar 自治化（D7，改动 App.tsx）
 ├─ 8 schedule store 下沉（P1b target 2，D6）
 ├─ 9 resolveSessionViews 响应式化（P1b target 1，D8）
 ├─ 10 streamingSessionIds 解耦 SessionRow（P1b target 3，D9）
 └─ 11 删死代码 + 结构测试更新 + 文档收尾
```

阶段 8/9/10 之间无强依赖，可并行或按便利顺序调整。

---

## 阶段 1：路由骨架 `[设计 D1, D2]`

### 步骤 1.1 — 重写路由表

**文件**：`packages/app/src/router.tsx`

改为真嵌套：
- [ ] `project/:projectId` → `<ProjectScope>`（element，带 children）
- [ ] children：`index` → `<WelcomePagePage>`、`chat/:sessionId` → `<ChatPage>`、`content` → `<ContentBrowserPage>`
- [ ] 保留顶层 `/`（App）+ index（EmptyState）

### 步骤 1.2 — 新建 page 组件

**新文件**：
- `packages/app/src/pages/WelcomePagePage.tsx`：渲染 `<WelcomePage>`，从 `useProjectCtx` 取 client
- `packages/app/src/pages/ChatPage.tsx`（**覆盖死代码**）：从 `useParams` 取 `:sessionId`，查 agent（阶段 9 补 `useSessionViews`），渲染 `<Chat>`
- `packages/app/src/pages/ContentBrowserPage.tsx`：从 `useSearchParams` 取 `path`，渲染 `<ContentBrowser>`

**注意**：阶段 1 的 page 组件先写成**能跑的最小壳**——内联从 store 读 agent/session 的逻辑（即使重复 ProjectLayout 现有逻辑），阶段 9 再用 `useSessionViews` 收敛。目的是先让路由骨架立起来。

### 步骤 1.3 — 新建 ProjectScope（壳）

**新文件**：`packages/app/src/layouts/ProjectScope.tsx`

- [ ] `useParams().projectId` + 校验 project 存在（走 app-store）
- [ ] 挂 `<ProjectProvider projectId={projectId} ctx={project.ctx}>`
- [ ] 渲染 `<ProjectPanel>` + `<main><Outlet/></main>` + `<FloatingChatManager/>`
- [ ] **暂不搬 effect**（阶段 2 做）——先把结构立起来
- [ ] 用 `useSidePanel().clickAwayProps`（P1a 已有）spread 到 `<main>`

### 步骤 1.4 — 删除旧 ProjectLayout

- [ ] `git rm packages/app/src/layouts/ProjectLayout.tsx`
- [ ] `git rm packages/app/src/layouts/ProjectLayout.structure.test.ts`（阶段 11 重建针对 ProjectScope 的结构测试）
- [ ] 更新 `pages/ProjectPage.tsx`：`ProjectPage` 现在只做「校验 projectId 存在 → 渲染 `<ProjectScope>`」，或直接让路由渲染 `<ProjectScope>`（ProjectPage 变多余则删）

### 步骤 1.5 — 验证路由骨架

- [ ] `npm run lint --workspace=packages/app`
- [ ] `npm test --workspace=packages/app`（预期 structure 测试需更新，先跳过失败的）
- [ ] 手动：打开项目 → 看到 ProjectPanel + Outlet 渲染的 page；切 chat/content 路由 URL 变化

**commit**：`refactor(app): introduce real nested routing with ProjectScope layout`

---

## 阶段 2：搬生命周期 effect 到 ProjectScope `[设计 D2]`

把旧 ProjectLayout 的 effect 逻辑搬到 ProjectScope。**暂不加缓存判断、暂不修 WS t-dependency**（阶段 3 做），本阶段纯搬运。

### 步骤 2.1 — 搬 effect

**文件**：`packages/app/src/layouts/ProjectScope.tsx`

- [ ] `useCustomTheme(project.ctx.projectRoot, project.ctx.baseUrl, project.ctx.projectId)`
- [ ] `useSpherseMessageListener(projectId, project.ctx.client)`
- [ ] `setActiveProject` effect（URL→store 同步）
- [ ] `setProjectLastRoute` effect（lastRoute 持久化）——**改用 `useParams`+`useLocation`**，不再 prefix-strip（见 D11）
- [ ] `refreshAgents + refreshSessions` effect
- [ ] schedule WS effect（含 `showScheduleNotification`）
- [ ] `consumeInitialMessage` effect——**注意**：initialMessage 现在读自 `project-data-store`，ChatPage 渲染 Chat 时需要这个值。消费逻辑移到 ChatPage（阶段 9 一起做），或暂留 ProjectScope 读 selectedSession（临时）。本阶段先保留 ProjectScope 读 initialMessage 的逻辑，ChatPage 通过 `useProjectDataStore` 读。

### 步骤 2.2 — 搬 handler

- [ ] `handleSelectFile`（navigate to content）→ 但 content URL 不带 sessionId（阶段 4）
- [ ] `handleBackToChat` / `handleStartSession` / `handleFileDeleted`——这些现在分属 ChatPage/ContentBrowserPage/ProjectPanel。初步：把 file 相关的留 ProjectScope（通过 ProjectPanel 透传），chat 相关的移 ChatPage。

### 步骤 2.3 — 验证

- [ ] 手动：切项目、切 chat/content、schedule 通知、initialMessage 消费都正常

**commit**：`refactor(app): move project lifecycle effects into ProjectScope`

---

## 阶段 3：消除 remount + 条件性刷新 + WS 修复 `[设计 D3, D4]`

### 步骤 3.1 — 确认无 key={projectId}

- [ ] grep 确认 `<ProjectScope>` 无 `key` prop（路由 element 不接受 key 透传，天然无 remount）
- [ ] 验证 effect 依赖 `projectId`，切项目时 effect 自然重跑

### 步骤 3.2 — 条件性刷新

**文件**：`packages/app/src/layouts/ProjectScope.tsx` 的 refresh effect

- [ ] `refreshAgents`/`refreshSessions` 调用前检查 `useProjectDataStore.getState().projects[projectId]?.agents` 是否已有数据
- [ ] 有数据：跳过（或后台静默刷新，不阻塞）
- [ ] 无数据：全量拉

### 步骤 3.3 — 修 WS t-dependency

**文件**：`packages/app/src/layouts/ProjectScope.tsx` 的 schedule WS effect

- [ ] 用 `useRef` 持有最新 `t`（`tRef.current = t` 每次渲染更新）
- [ ] effect 内 `showScheduleNotification` 读 `tRef.current`（而非闭包 `t`）
- [ ] 依赖数组移除 `t`，只留 `[handleScheduleEvent, client, projectId]`

### 步骤 3.4 — 验证

- [ ] 手动：切项目不重拉已有数据；切语言不重开 WS；schedule 通知文案正确

**commit**：`refactor(app): eliminate remount, add cache check for refresh, fix WS locale dependency`

---

## 阶段 4：content 路由去 sessionId `[设计 D5]`

### 步骤 4.1 — 简化 content URL builder

**文件**：`packages/app/src/layouts/ProjectScope.tsx`（或 ProjectPanel）

- [ ] `handleSelectFile` → `navigate(`/project/${projectId}/content?path=${encodeURIComponent(filePath)}`)`，**不带 sessionId**
- [ ] 删除 `buildContentUrl` helper（或简化为不带 sessionId 版本）

### 步骤 4.2 — 统一 open-file handler

**文件**：`packages/app/src/ui-sdk/handlers/open-file.ts`

- [ ] 确认已只带 `path`（当前 `:7-8` 已是不带 sessionId，无需改）——验证一致性即可

### 步骤 4.3 — ContentBrowserPage onBack

**文件**：`packages/app/src/pages/ContentBrowserPage.tsx`

- [ ] `onBack` 改用 `navigate(-1)`（浏览器后退）或 `navigate(`/project/${projectId}`)`
- [ ] 不再读 `?sessionId=` query param

### 步骤 4.4 — 清理 ProjectLayout 残留的 sessionId query 读取

- [ ] grep `searchParams.get("sessionId")` 确认无残留

**commit**：`refactor(app): drop sessionId from content route, unify content URL builder`

---

## 阶段 5：FloatingChatManager 改读 URL `[设计 D3]`

### 步骤 5.1 — 用 useParams 替代 activeProjectId

**文件**：`packages/app/src/features/floating-chat/FloatingChatManager.tsx`

- [ ] `const { projectId } = useParams()` 替代 `useAppStore((s) => s.activeProjectId)`
- [ ] `useProjectUiStore`/`useProjectDataStore` 的 selector 用 URL 的 `projectId`
- [ ] `useProjectCtx()` 仍取 client/baseUrl（已是 URL-scoped，无需改）
- [ ] 验证：floating chat 现在与主面板同源（URL）

**commit**：`refactor(app): FloatingChatManager reads projectId from URL instead of store`

---

## 阶段 6：DebugMenu 用 useMatch `[设计 D11]`

### 步骤 6.1 — 替换正则解析

**文件**：`packages/app/src/features/debug-tools/DebugMenu.tsx`

- [ ] 删除 `extractSessionId`（`:34-37`）
- [ ] 改用 `useMatch("/project/:projectId/chat/:sessionId")` 取 `sessionId`
- [ ] `activeProjectId`/`activeProject.ctx.client` 保留（DebugMenu 在 ProjectScope 外，合理）

**commit**：`refactor(app): DebugMenu uses useMatch instead of regex for session id`

---

## 阶段 7：ActivityBar 自治化 `[设计 D7]`

### 步骤 7.1 — ActivityBar 改自治

**文件**：`packages/app/src/features/activity-bar/index.tsx`

- [ ] 删除 `ActivityBarProps` 的 `projects`/`activeProjectId`/`onSelect`/`onAdd`/`onClose`/`onReveal`
- [ ] 自己读 `useAppStore`：`projects`、`openProject`、`closeProject`、`revealProject`、`setActiveProject`
- [ ] `useNavigate()` + `useParams().projectId`（高亮 + 导航）
- [ ] 内部构造 `handleSelect`/`handleAdd`/`handleClose`：
  - `handleClose` 需调 `clearProjectData`/`clearProjectUi`/`clearAgentSessionListUi`——从各自 store 取 action
  - 导航用 `buildProjectRoute`（移到 ActivityBar 或抽 lib）

### 步骤 7.2 — App.tsx 精简

**文件**：`packages/app/src/App.tsx`

- [ ] 删除 `handleAddProject`/`handleSelectProject`/`handleCloseProject`（移入 ActivityBar）
- [ ] 删除 `projects`/`activeProjectId`/`openProject`/`closeProject`/`revealProject`/`setActiveProject` selector（不再需要）
- [ ] 删除 `clearProjectData`/`clearProjectUi`/`clearAgentSessionListUi` selector（移入 ActivityBar）
- [ ] `<ActivityBar onSettings={() => setShowSettings(true)} />`（只留 settings 入口回调）
- [ ] 保留 `restoreProjects` effect（app 级初始化）+ `loadSettings` effect
- [ ] `App.structure.test.ts` 更新（仍约束 no sidePanel/useRef）

### 步骤 7.3 — 验证

- [ ] `npm test --workspace=packages/app`（App.structure.test + ActivityBar.structure.test 更新）
- [ ] 手动：切项目、加项目、关项目都正常

**commit**：`refactor(app): make ActivityBar autonomous, slim down App shell`

---

## 阶段 8：Schedule store 下沉 `[设计 D6]`（P1b target 2）

### 步骤 8.1 — 新建 schedule store

**新文件**：`packages/app/src/features/agent-schedule/store.ts`

- [ ] `useScheduleStore`：`byProject: Record<string, {schedulesByAgent, runningScheduleIdsByAgent, scheduleEventVersion}>`
- [ ] 6 个 action（`refreshSchedules`/`createSchedule`/`updateSchedule`/`deleteSchedule`/`triggerSchedule`/`handleScheduleEvent`）+ `clearProject`
- [ ] 复用 `addRunningSchedule`/`removeRunningSchedule` helper（从 project-data-store 搬来）

### 步骤 8.2 — 从 project-data-store 移除

**文件**：`packages/app/src/stores/project-data-store.ts`

- [ ] 删除 `schedulesByAgent`/`runningScheduleIdsByAgent`/`scheduleEventVersion` 字段（`:8-10`）
- [ ] 删除 6 个 schedule action（`:370-456`）
- [ ] 删除 `addRunningSchedule`/`removeRunningSchedule`（`:65-88`）
- [ ] `ProjectData` 接口和 `createProjectData` 同步精简

### 步骤 8.3 — agent-schedule 改用新 store

**文件**：`packages/app/src/features/agent-schedule/index.tsx`

- [ ] 所有 schedule selector/action 改从 `useScheduleStore` 取（`:35-43`）

### 步骤 8.4 — ProjectScope WS effect 改派发到新 store

**文件**：`packages/app/src/layouts/ProjectScope.tsx`

- [ ] `handleScheduleEvent` → `useScheduleStore.getState().handleScheduleEvent(...)`
- [ ] `showScheduleNotification` 读 `useScheduleStore.getState().byProject[projectId]?.schedulesByAgent`

### 步骤 8.5 — App.tsx 关闭项目时清理

**文件**：`packages/app/src/features/activity-bar/index.tsx`（阶段 7 后 close 逻辑在此）

- [ ] `handleClose` 加 `useScheduleStore.getState().clearProject(projectId)`

### 步骤 8.6 — 测试更新

- [ ] `project-data-store.test.ts` 移除 schedule 相关用例（若有）
- [ ] 新建 `features/agent-schedule/store.test.ts`（迁移 schedule action 测试）
- [ ] `ScheduleFeature.structure.test.ts:9-15` 更新：`createScheduleWebSocket` 钉在 `ProjectScope.tsx`

**commit**：`refactor(app): extract schedule store from project-data-store`

---

## 阶段 9：resolveSessionViews 响应式化 `[设计 D8]`（P1b target 1）

### 步骤 9.1 — 新建 useSessionViews hook

**新文件**：`packages/app/src/lib/use-session-views.ts`

- [ ] 订阅 `agents`/`sessions`，`useMemo` 派生 `selectedSession`/`selectedAgent`/`activeSessions`
- [ ] 输入：`projectId`、`activeSessionId`、`floatingSessionId`

### 步骤 9.2 — ChatPage 用 hook 取 agent

**文件**：`packages/app/src/pages/ChatPage.tsx`

- [ ] `const { sessionId } = useParams()`
- [ ] `const { selectedAgent } = useSessionViews(projectId, sessionId, null)`
- [ ] 渲染 `<Chat>`（agent/client/baseUrl 都齐）
- [ ] initialMessage 消费逻辑移此（从 `useProjectDataStore` 读 + `consumeInitialMessage`）

### 步骤 9.3 — ContentBrowserPage 用 hook 取 activeSessions

**文件**：`packages/app/src/pages/ContentBrowserPage.tsx`

- [ ] `const { activeSessions } = useSessionViews(projectId, null, floatingSessionId)`（floatingSessionId 给 TextSelectionSession 用）

### 步骤 9.4 — 删除旧 resolveSessionViews

**文件**：`packages/app/src/stores/project-data-store.ts`

- [ ] 删除 `resolveSessionViews` 方法（`:19-27` 接口、`:117-154` 实现）
- [ ] 删除 `getProjectData`（死代码，`:18`/`:113-115`）
- [ ] 清理 `ActiveSessionInfo` 类型的归属（移到 `lib/types.ts` 若不在）

### 步骤 9.5 — ProjectScope 清理

**文件**：`packages/app/src/layouts/ProjectScope.tsx`

- [ ] 移除 `resolveSessionViews` 调用（ProjectScope 不再需要 selectedSession/selectedAgent——那些是 ChatPage 的事）
- [ ] `consumeInitialMessage` effect 移到 ChatPage（步骤 9.2）

**commit**：`refactor(app): replace resolveSessionViews with reactive useSessionViews hook`

---

## 阶段 10：streamingSessionIds 解耦 SessionRow `[设计 D9]`（P1b target 3）

### 步骤 10.1 — project-data-store 加 streamingSessionIds

**文件**：`packages/app/src/stores/project-data-store.ts`

- [ ] `ProjectData` 加 `streamingSessionIds: Set<string>`
- [ ] `createProjectData` 初始化 `new Set()`

### 步骤 10.2 — streaming-store 同步 streaming flag

**文件**：`packages/app/src/features/chat/streaming-store.ts`

- [ ] `flushQueuedEvents`（`:60-82`）在更新 session 的 `streaming` 时，同步写 `project-data-store`：
  - streaming: true → `useProjectDataStore` 的对应 project 加 sessionId 到 set
  - streaming: false → 移除
- [ ] **注意**：streaming-store 不知道 projectId（它按 sessionId key）——需要从 session 反查 projectId。选项：
  - (a) streaming-store 的 `StreamingSession` 加 `projectId` 字段（attach 时传入，已有 projectId 参数）
  - (b) 不在 streaming-store 同步，改为 SessionRow 直接读 streaming-store（现状）——但这违反解耦目标
- [ ] 采用 (a)：`StreamingSession` 加 `projectId`，flush 时用它写 project-data-store

### 步骤 10.3 — SessionRow 改读 project-data-store

**文件**：`packages/app/src/features/agent-session-list/SessionRow.tsx`

- [ ] 删除 `import { useStreamingStore }`（`:15`）
- [ ] `isStreaming` 改读 `useProjectDataStore((s) => s.projects[projectId]?.streamingSessionIds.has(session.id) ?? false)`
- [ ] 需要 `projectId` prop（从父组件 AgentSessionListView 透传，或用 ProjectContext）

**commit**：`refactor(app): mirror streaming flag to project-data-store, decouple SessionRow`

---

## 阶段 11：收尾 `[设计 D10, D11]`

### 步骤 11.1 — 确认死代码删除

- [ ] grep 确认无 `getProjectData`/`resolveSessionViews`/旧 `buildContentUrl` 残留
- [ ] `pages/ChatPage.tsx`/`pages/ContentBrowser.tsx` 已是新 page 组件（阶段 1 覆盖）
- [ ] `useProjectCtxOrNull` 保留（未用但不碍事）

### 步骤 11.2 — 结构测试重建

- [ ] 新建 `layouts/ProjectScope.structure.test.ts`：
  - 断言无 `useState`（状态走 store/hook，继承原 ProjectLayout 约束精神）
  - 断言含 `useSidePanel`/`ProjectProvider`/`Outlet`
- [ ] `App.structure.test.ts` 更新（ActivityBar 自治后 App 更薄）
- [ ] `ActivityBar.structure.test.tsx` 更新（命名/断言对齐）

### 步骤 11.3 — lastRoute 用 useLocation 重写

**文件**：`packages/app/src/layouts/ProjectScope.tsx`

- [ ] `setProjectLastRoute` effect 改用 `useLocation().pathname + search` + `useParams().projectId`，不再 prefix-strip 字符串
- [ ] 或保留 strip 但用 `useMatch` 校验归属

### 步骤 11.4 — App.tsx hash 读取改 useLocation

**文件**：`packages/app/src/App.tsx`

- [ ] `window.location.hash.replace(...)`（`:40`）→ `useLocation().pathname`
- [ ] 验证 restore 逻辑正常

### 步骤 11.5 — 文档同步

- [ ] `docs/official/project-structure.md`：更新路由表、ProjectScope、page 组件、schedule store、session-views hook
- [ ] `docs/dev/backlog.md`：标记 P0+P1b 完成
- [ ] AGENTS.md：若有新约定（如 page 组件命名、ProjectScope 职责）补充

### 步骤 11.6 — 全量验证

- [ ] `npm run verify`
- [ ] 受影响 E2E（按 design「验证」节）
- [ ] 手动联调清单（design「验证」节）

**commit**：`refactor(app): cleanup dead code, update structure tests and docs (P0+P1b complete)`

---

## 执行顺序建议

阶段 1-3 是核心（路由骨架 + effect 搬迁 + remount 消除），必须顺序做。阶段 4-6 是路由清理，可并行。阶段 7（ActivityBar 自治）独立但改动 App.tsx 较大，单独做。阶段 8-10（P1b store）互相独立，可任意顺序。阶段 11 最后。

每个阶段独立 commit，便于回滚和 review。
