# 前端路由 / Layout 重构 + Store 收尾（P0 + P1b）

## 背景

前端架构调查（见 `docs/dev/features/2026-06-19-frontend-store-p1a/design.md` 背景）发现两类全局问题：路由/布局混乱（P0）和 store 边界剩余项（P1b）。P1a 已完成 store 边界的第一批整理，引入了 `ProjectContext`。本文档覆盖 P0 和 P1b——它们交织在一起，必须一起设计。

## 现状问题（P0 + P1b 范围内）

### A. 路由：假嵌套

`router.tsx:6-28` 定义了三条 project 子路由（`/project/:id`、`/chat/:sessionId`、`/content`），但**全部渲染同一个 `<ProjectPage />`**。`pages/ChatPage.tsx` 和 `pages/ContentBrowser.tsx` 是死代码。

`ProjectLayout` 名为 layout 实为 page——内部没有 `<Outlet />`，而是用 `endsWith("/content")`（`:50`）、`searchParams.get("path")`/`get("sessionId")`（`:48-49`）、`useParams().sessionId`（`:34`）四个数据源混合推导要渲染什么。同一个概念「active session」在 chat 路由是 path param、在 content 路由是 query param——两套编码。`buildContentUrl`（`:25-29`）与 `ui-sdk/handlers/open-file.ts:7-8` 构造 content URL 时一个带 sessionId 一个不带——静默行为分叉。

### B. `key={projectId}` remount 导致重复开销

`ProjectPage.tsx:22` 的 `key={projectId}` 让每次切项目都 unmount 旧 `ProjectLayout`、mount 新的。8 个 effect 重新跑：`useCustomTheme`、`useSpherseMessageListener`、`setActiveProject`、`setProjectLastRoute`、**`refreshAgents + refreshSessions`（2 个 HTTP）**、**schedule WebSocket（open + close）**、`consumeInitialMessage`、`useFloatingChatRedirect`。schedule WS 的依赖数组还含 `t`（locale），**切语言会重开 WS**（latent bug，`ProjectLayout.tsx:101`）。

### C. 两个 active project 真相源

`useAppStore.activeProjectId`（被 `FloatingChatManager`、`DebugMenu`、`ActivityBar` 高亮用）和 URL `:projectId`（被主面板用）通常同步但会瞬时分歧——靠 `ProjectLayout.tsx:65-67` 的 remount effect 反向同步。`FloatingChatManager` 同时读 URL-scoped `useProjectCtx()` 和 store-scoped `activeProjectId`——如果两者分歧，会用错 project 的 client。

### D. `resolveSessionViews` 非响应式（P1b target 1）

`project-data-store.ts:117-154` 的 `resolveSessionViews` 内部走 `get().projects[projectId]`——非响应式快照读。`ProjectLayout.tsx:54-57` 在 render 体里调用它，目前能 work 纯属侥幸（`:49` 行另一个 selector 顺带订阅了）。`getProjectData` 是同一模式的死代码（grep 无调用方）。

### E. Schedule 子系统错放在全局 store（P1b target 2）

`schedulesByAgent`/`runningScheduleIdsByAgent`/`scheduleEventVersion` + 6 个 schedule action（`project-data-store.ts:370-456`，约 100 行）**只被 `features/agent-schedule` 消费**（`ProjectLayout` 只用 `handleScheduleEvent` 做 WS 派发 + 通知）。应下沉到 `features/agent-schedule/store.ts`。schedule WS effect（`ProjectLayout.tsx:82-101`）的新家依赖 P0 建立的 project scope。

### F. `SessionRow` 越界读 chat 内部 store（P1b target 3）

`features/agent-session-list/SessionRow.tsx:15,41` 伸手进 `chat/streaming-store` 只为读一个 `streaming: boolean` 显示 spinner。sidebar 和 chat engine 之间最越界的 feature→feature 链接。

### G. 结构测试固化了反模式

`ProjectLayout.structure.test.ts:13` 断言 `expect(source).not.toContain("useState")`——这个好心的约束把状态挤进了 URL 字符串和全局 store，是路由混乱的根因之一。`ScheduleFeature.structure.test.ts:9-15` 把 `createScheduleWebSocket` 钉死在 `ProjectLayout.tsx`。`App.structure.test.ts:12-13` 禁止 `sidePanel`/`useRef`。

## 设计决策

### D1. 真嵌套路由

**路由表**改为：

```
/                                  → <App>（shell）
  index                            → <EmptyState>
  project/:projectId               → <ProjectScope>（layout，带 <Outlet>）
    index                          → <WelcomePagePage>
    chat/:sessionId                → <ChatPage>
    content                        → <ContentBrowserPage>（?path= 查询参数）
```

- **`<ProjectScope>`**：layout route 的 element，包 `<Outlet />`。职责见 D2。
- **`<WelcomePagePage>`/`<ChatPage>`/`<ContentBrowserPage>`**：page 组件，各自从 `useParams`/`useSearchParams` 读路由参数，渲染对应 feature。
- **`sessionId` 统一为 path param**——content 路由不再用 `?sessionId=` query param 携带 session（见 D5）。
- 删除死代码 `pages/ChatPage.tsx`（旧版）、`pages/ContentBrowser.tsx`（旧版），在 `pages/` 新建真正的 page 组件。

**为什么真嵌套**：消除 `endsWith`、统一 sessionId 编码、URL 成为单一真相源、`useMatch`/`useParams` 取代手写解析。Chat 保活已验证安全——`streaming-store` 的 `attach/detach` 引用计数 + `cleanupExpired`（5 分钟 TTL + streaming 豁免）保证切到 content 时 ws/messages/scroll 全部保留（见 `streaming-store.ts:219-225, 278-286`）。

### D2. `<ProjectScope>` 组件——project 级 layout + 生命周期宿主

新建 `layouts/ProjectScope.tsx`（替代当前 `ProjectLayout` 的编排角色）：

```tsx
export function ProjectScope() {
  const { projectId } = useParams();
  const project = useAppStore((s) => projectId ? s.projects.get(projectId) : undefined);
  // 校验 project 存在
  // 挂 ProjectProvider（ctx 注入，P1a 已有）
  // 渲染 <ProjectPanel>（侧栏，常驻）+ <main><Outlet /></main> + <FloatingChatManager/>
  // 承载跨 chat/content 切换的生命周期 effect：
  //   - useCustomTheme（项目主题）
  //   - useSpherseMessageListener（postMessage 桥）
  //   - setActiveProject（URL→store 同步，见 D3）
  //   - setProjectLastRoute（lastRoute 持久化）
  //   - refreshAgents + refreshSessions（条件性，见 D4）
  //   - schedule WebSocket（见 D6）
}
```

**关键区别于旧 ProjectLayout**：
- 有 `<Outlet />`，子路由渲染 ChatPage/ContentBrowserPage，不再用 `endsWith` 判断
- **无 `key={projectId}`**——靠 `useParams` 订阅 `:projectId` 变化，effect 依赖数组含 `projectId`，自然在切项目时重跑
- 不再在 render 体里决定 chat vs content——交给路由

**Chat 保活验证**：切 chat↔content 时，`<ChatPage>` unmount → `useChatSession` cleanup 调 `detach`（`attachedCount: 1→0`，ws 保活）；切回时 `attach`（`attachedCount: 0→1`，复用 ws/messages，不重连）。scroll 从 `streaming-store.scrollPosition` 恢复。

### D3. URL 为唯一 active project 真相源

**消除 `useAppStore.activeProjectId` 作为独立真相源**。改为：

- `activeProjectId` **保留**在 app-store（兼容现有 `restoreProjects` 的「上次活跃项目」启动恢复），但**运行时不再被业务组件读取**。
- `<ProjectScope>` 用 `useParams()` 读 `:projectId`，在 effect 里 `setActiveProject(projectId)`——这是**唯一**的写入口，用于 IPC 持久化「上次活跃项目」。
- **`FloatingChatManager`**：改用 `useParams()` 读 `:projectId`（替代 `useAppStore.activeProjectId`），`useProjectCtx()` 读 client/baseUrl。与主面板同源。
- **`DebugMenu`**：保留读 `activeProjectId`（它在 activity-bar，ProjectScope 之外），但 `extractSessionId` 改用 `useMatch("/project/:projectId/chat/:sessionId")`（替代正则）。`activeProjectId` 仍是 DebugMenu 的合理来源——它本就是 app 级调试工具。
- **`ActivityBar`**：高亮改用 `useParams().projectId`（替代 `activeProjectId` prop）——见 D7。

**为什么不一刀切删 `activeProjectId`**：启动恢复（`restoreProjects` 返回 lastActiveId）和 IPC 持久化仍需要这个字段。但运行时业务读取改为 URL 派生，消除分歧窗口。

### D4. 消除 remount，条件性刷新

`<ProjectScope>` **不用 `key`**。effect 依赖 `projectId`，切项目时 effect 重跑是自然的。但刷新加缓存判断：

- `refreshAgents`/`refreshSessions`：在 `<ProjectScope>` 的 effect 里调用，但先检查 `project-data-store.projects[projectId]` 是否已有数据——有则跳过（或只做后台静默刷新）。首次打开项目仍全量拉，切回已缓存项目不重复拉。
- schedule WS：见 D6。

**为什么不完全去掉刷新**：项目内容可能在切走期间变化（外部编辑、schedule 触发新 session）。静默后台刷新保证不过期，但不阻塞渲染（已有缓存先显示）。

### D5. content 路由的 session 上下文

**决策**：content 路由**不再携带 sessionId**。`/project/:id/content?path=foo.md` 是纯文件查看。

- 「返回」行为：`ContentBrowserPage` 的 `onBack` 用 `navigate(-1)`（浏览器后退）或 `navigate(`/project/${projectId}`)`。不再尝试「返回到之前的 chat」——那是历史导航的职责，不是 content 路由的职责。
- 消除 `buildContentUrl` 的 sessionId 参数和 `open-file.ts` 的 sessionId 不一致——两者都不带 sessionId，行为统一。
- 如果未来需要「在 content 里发起会话后返回原 chat」，用浏览器历史（`navigate(-1)`）或 dedicated「返回 chat」按钮（读历史栈），不在 URL 编码。

**为什么**：当前 `?sessionId=` 是为了 `handleBackToChat` 能回到原 chat。但「返回」是导航历史的事，content URL 不该知道「之前在哪个 chat」。简化后 URL 语义清晰：content 就是看文件。

### D6. Schedule 子系统下沉（P1b target 2）

**新建 `features/agent-schedule/store.ts`**（`useScheduleStore`）：

```ts
interface ScheduleStoreState {
  byProject: Record<string, {
    schedulesByAgent: Record<string, ScheduleInfo[]>;
    runningScheduleIdsByAgent: Record<string, string[]>;
    scheduleEventVersion: number;
  }>;
  refreshSchedules(projectId, client, agentId): Promise<void>;
  createSchedule(...): Promise<void>;
  // ... 6 个 action，签名同 project-data-store 现版
  handleScheduleEvent(projectId, client, event): void;
  clearProject(projectId): void;
}
```

- 从 `project-data-store` 移除 3 个 schedule 字段 + 6 个 action + 2 个 helper（`addRunningSchedule`/`removeRunningSchedule`）。
- `features/agent-schedule/index.tsx` 改 import 新 store。
- `ProjectScope` 的 WS effect 调 `useScheduleStore.getState().handleScheduleEvent(...)`（而非 project-data-store 版）。

**WS effect 留在 `<ProjectScope>`**（不进 feature）：
- WS 生命周期 = 「项目打开期间」，与 ProjectScope 一致
- 依赖数组**移除 `t`**（locale）——用 `useRef` 持有最新 `t`，effect 内读 ref。修掉切语言重开 WS 的 latent bug
- `showScheduleNotification` 读 schedule 缓存改走 `useScheduleStore.getState()`
- 更新 `ScheduleFeature.structure.test.ts`：`createScheduleWebSocket` 钉在 `ProjectScope.tsx`（原 `ProjectLayout.tsx`）

**为什么不把 WS 也挪进 feature**：WS 生命周期是 project scope 级，feature 组件（`ScheduleDialog`）只在打开时 mount。WS 要「项目打开期间常驻」，只能挂 project scope 层。

### D7. ActivityBar 自治化

落实「feature root 自治」原则（AGENTS.md 新增条目）：

- `ActivityBar` 不再接收 `projects`/`activeProjectId`/6 个回调 props
- 自己从 `useAppStore` 读 `projects`、`openProject`/`setActiveProject`/`closeProject`/`revealProject`
- 高亮用 `useParams().projectId`（替代 `activeProjectId` prop）
- `handleSelect`/`handleAdd`/`handleClose` 内部用 `useNavigate()` + store action 构造行为
- `App.tsx` 不再向 ActivityBar 透传任何 feature 数据/action，只渲染 `<ActivityBar />`

**卡点**：`App.tsx` 的 `restoreProjects` effect 调 `navigate(buildProjectRoute(...))`——这是 app 级初始化，留在 App.tsx 合理。`handleSelectProject`/`handleAddProject`/`handleCloseProject` 的逻辑（setActiveProject + navigate）移入 ActivityBar，但「关闭后切到下一个项目」需要 store 状态，ActivityBar 直接读 store 即可。

### D8. `resolveSessionViews` 响应式化（P1b target 1）

**改为 hook**：新建 `features/chat/use-session-views.ts`（或放 `lib/`）：

```ts
export function useSessionViews(projectId: string, activeSessionId: string | null, floatingSessionId: string | null) {
  const agents = useProjectDataStore((s) => s.projects[projectId]?.agents ?? EMPTY);
  const sessions = useProjectDataStore((s) => s.projects[projectId]?.sessions ?? EMPTY);
  return useMemo(() => {
    // 纯派生逻辑，从 agents/sessions 计算 selectedSession/selectedAgent/activeSessions
  }, [agents, sessions, activeSessionId, floatingSessionId]);
}
```

- 从 `project-data-store` **删除** `resolveSessionViews` 方法（getState-based）和 `getProjectData`（死代码）
- `<ChatPage>` 调 `useSessionViews` 拿 `selectedSession`/`selectedAgent`——但 `<ChatPage>` 已经从 `:sessionId` 直接知道 session，只需要 `selectedAgent`（从 session.agentId 查 agents）
- `<ContentBrowserPage>` 调 `useSessionViews` 拿 `activeSessions`（给 TextSelectionSession）
- `<ProjectScope>` 不再需要 `resolveSessionViews`——它不渲染 Chat/ContentBrowser 的细节

**为什么用 hook 而非 store selector**：派生逻辑纯函数，输入是已订阅的 `agents`/`sessions` + 路由参数。`useMemo` 保证只在依赖变化时重算。不需要进 store。

### D9. SessionRow 解耦 streaming-store（P1b target 3）

**在 `project-data-store` 增加 `streamingSessionIds: Set<string>`**（per-project）：

```ts
// project-data-store.ts ProjectData 新增
streamingSessionIds: Set<string>;
```

- `streaming-store` 的 `flushQueuedEvents`（`:60-82`）在更新 session 的 `streaming` flag 时，同步写 `project-data-store` 的 `streamingSessionIds`（add/remove）。这是 store→store 单向同步，`streaming-store` 依赖 `project-data-store`（feature→global，允许）。
- `SessionRow` 改读 `useProjectDataStore((s) => s.projects[projectId]?.streamingSessionIds.has(session.id) ?? false)`——不再 import `chat/streaming-store`。
- 移除 `SessionRow.tsx:15` 的 `useStreamingStore` import。

**为什么放 project-data-store 而非新 store**：`streaming` 是 session 的派生属性，和 `sessions` 同生命周期，放一起最自然。`streaming-store` 仍是 ws/messages 的权威源，只是把 `streaming` flag 镜像一份到全局 store 供 sidebar 读。

**替代方案考虑过**：放 feature-local store（agent-session-list/store.ts）——但 streaming-store 要跨 feature 写，写方在 chat feature，读方在 agent-session-list feature，放任一方的 feature store 都会造成 feature→feature 依赖。放全局 store 是唯一无越界的选项。

### D10. 删死代码 + 清理

- 删 `pages/ChatPage.tsx`（旧死代码）、`pages/ContentBrowser.tsx`（旧死代码）——被新 page 组件替代
- 删 `project-data-store.getProjectData`（死代码）
- 删 `project-data-store.resolveSessionViews`（被 D8 hook 替代）
- `useProjectCtxOrNull`（P1a 引入但零消费方）——保留还是删？保留，未来 ProjectScope 外的组件（如 DebugMenu）可能用。不强制删。

### D11. 手写 URL 解析全消除

- `App.tsx:40` `window.location.hash.replace(...)` → 用 `useLocation().pathname`（App 在 router 内，可用 hooks）
- `ProjectLayout.tsx:50` `endsWith("/content")` → 真嵌套路由后自然消失
- `DebugMenu.tsx:34-37` 正则 → `useMatch("/project/:projectId/chat/:sessionId")`
- `ProjectLayout.tsx:70-72` prefix-strip → 改用 `useLocation` + `useParams` 组合，或保留但用 `useMatch` 校验

## 不在本次范围

- `welcome-page` vs `welcome-page-settings` 的事件总线通信——正常工作，不动
- `content-browser` 的 dirty/conflict 状态管理——组件内 `useState`/`useRef`，符合规范
- `file-tree` 的 `AiReadDenylistDialog` 越界 import（`project-panel/index.tsx:5`）——小问题，留给后续
- locale 归属根本性重构（i18n store）
- `useProjectCtxOrNull` 的消费方扩展（DebugMenu 等是否挪进 ProjectScope）——结构性决策，留给后续

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| 真嵌套路由改动面大，Chat 保活可能有意料外的边界 | 已验证 streaming-store attach/detach + TTL；分步实施（先路由骨架，再搬 effect）；每步可独立 commit + 测试 |
| `streamingSessionIds` 双向同步可能漏更新 | streaming-store 的 flushQueuedEvents 是 streaming flag 的唯一写点；同步逻辑集中在一处；补测试 |
| ActivityBar 自治化改动 App.tsx 结构 | App.tsx 的 `App.structure.test.ts` 约束（no sidePanel/useRef）仍满足；ActivityBar 测试更新 |
| schedule store 迁移丢失 running 状态 | running 状态非持久化（内存），迁移期间最坏是 running 标记重置；ScheduleFeature.structure.test 同步更新 |
| lastRoute 持久化逻辑改动可能丢恢复 | 保留 `setProjectLastRoute` 语义；用 `useParams`+`useLocation` 重写 strip 逻辑；测试覆盖 |

## 验证

- `npm run lint --workspace=packages/app`
- `npm test --workspace=packages/app`（含 store 单测 + structure 测试）
- `npm run verify`
- 受影响 E2E（按 AGENTS.md「E2E 验证选择」）：
  - chat/session 相关 spec（WS 保活、切 chat↔content）
  - file-tree.spec.ts（AgentDialog 已在 P1a 迁移）
  - 路由恢复相关（项目切换、lastRoute）
- 手动联调：
  - 切项目不重拉 agents/sessions（验证缓存）
  - chat→content→chat，scroll/ws/messages 恢复
  - schedule WS 在切语言时不重开
  - floating chat 孤儿清理
  - 文件树打开 content、返回
  - iframe postMessage 打开文件（open-file handler）
