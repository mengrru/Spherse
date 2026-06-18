# 前端 Store 边界整理（P1a）

## 背景

前端架构调查发现 data store 边界和 feature 耦合存在多处问题。完整的重构分两阶段：

- **P0**：路由 / Page / Layout 重构（拆 `ProjectLayout`、消除 `key={projectId}` remount、统一 URL 解析）。
- **P1**：Store 边界与 feature 解耦。

P1 中有两项与 `ProjectLayout` 强耦合（`resolveSessionViews` 的唯一消费者、schedule WebSocket 的生命周期归属），先做会随 P0 返工。因此把 P1 拆成两半：

- **P1a（本次）**：与 `ProjectLayout` 解耦的 store/feature 整理，零返工，且为 P0 打底。
- **P1b（随 P0）**：`resolveSessionViews` 响应式化、schedule 状态下沉 + WS 安家到 P0 新建的 project scope、`agent-session-list → chat/streaming-store` 解耦。

本文档只覆盖 **P1a**。

## 现状问题（P1a 范围内）

### 1. 全局 store 反向依赖 feature-local store（层级倒置）

`stores/project-data-store.ts:5` import 了 `features/settings/store`，在 `:93` 的 `getErrorMessage()` 里 `useSettingsStore.getState().locale` 取 locale 用于 `translate()`。

**问题**：

- store 层依赖 feature 层，与 AGENTS.md 的层级（store 在下、feature 在上）相反。
- 引入隐式全局依赖：`project-data-store` 的错误消息格式依赖 settings store 已初始化。当前测试能跑过仅因为 `useSettingsStore` 默认 `locale: "zh-CN"`，但任何对 settings store 的改动都可能波及 data store 的错误路径。

### 2. `ctx.client` 在 4+ 组件里重复从 app-store 推导

下列组件都重复 `activeProjectId → projects.get → ctx.{client,baseUrl,projectRoot}` 推导链：

| 组件 | 位置 | 取了什么 |
|------|------|---------|
| `HtmlCard` | `features/chat/HtmlCard.tsx:17-21` | `ctx.client`、`ctx.projectRoot` |
| `DebugMenu` | `features/debug-tools/DebugMenu.tsx:49-51` | `ctx.client`、`ctx.baseUrl` |
| `AgentSessionList` | `features/agent-session-list/index.tsx:48` | `ctx.client` |
| `FloatingChatManager` | `features/floating-chat/FloatingChatManager.tsx:7-10` | `ctx.client`、`ctx.baseUrl` |
| `useSpherseMessageListener` | `ui-sdk/use-spherse-message-listener.ts:10` | `ctx.client`、`ctx.baseUrl` |
| `WelcomePageSettingsDialog`（经 activity-bar 触发） | `features/activity-bar/index.tsx:135` | `ctx.client` |

**问题**：6 处重复同一推导；`useSpherseMessageListener`、`HtmlCard` 等深层组件本不该关心「哪个 project 是 active」，却被迫伸手进全局 store。

### 3. `collapsedAgentIds` 错放在全局 UI store

`stores/project-ui-store.ts:10` 的 `collapsedAgentIds` + `toggleAgentCollapsed` + `setCollapsedAgentIds`，**唯一消费者是 `features/agent-session-list`**（`index.tsx:57-58, 68, 77, 83-89`）。

**问题**：per-agent 折叠态是纯 feature 内 UI 状态，放在全局 store 违反「只被单个 feature 使用的状态不提升到全局 store」（AGENTS.md 前端 store 使用原则）。

### 4. 重复的派生逻辑

**4a. `sidePanelVisible = sidePanelPinned || sidePanelHovered`** 在 3 处独立计算：

- `features/activity-bar/index.tsx:44`
- `features/project-panel/index.tsx:41`
- `hooks/useSidePanelClickAway.ts:8`（内联为 `sidePanelHovered && !sidePanelPinned`）

**4b. `floatingSessionId` selector** 在 3 处几乎逐字重复：

- `layouts/ProjectLayout.tsx:52-54`
- `features/agent-session-list/index.tsx:59`
- `hooks/useFloatingChatRedirect.ts:7-9`

### 5. render 体里 `setState`

`features/floating-chat/FloatingChatManager.tsx:24-27` 在 render 体里调 `useProjectUiStore.getState().setFloatingChat(activeProjectId, null)` 清理孤儿 floating session。这是 render 期间的副作用，React StrictMode / concurrent 渲染下可能重复触发或告警。

### 6. 错放的文件

- `hooks/useFloatingChatRedirect.ts`：只服务 floating-chat，只 import `project-ui-store`。应移入 `features/floating-chat/`。
- `hooks/useSidePanelClickAway.ts`：side-panel 域逻辑，只被 `ProjectLayout` 用。应移入 side-panel 域（`features/project-panel/`，与 `project-panel` 共享 pin/hover 语义）。
- `components/AgentDialog.tsx` + `components/SearchFileField.tsx`：agent 域组件，唯一消费者是 `features/agent-session-list`。应移入该 feature。

### 7. 重复实现

**7a. CSS scoping 逻辑**：`features/chat/hooks/useAgentTheme.ts:4-50`（`scopeCss`，scope = `[data-chat-root]`）与 `features/floating-chat/FloatingChatContainer.tsx:9-46`（`scopeCssToFloat`，scope = `[data-chat-float-root]`）是近乎逐行相同的 ~40 行实现，仅 scope 前缀不同。AGENTS.md 明确要求「变更聊天窗口 DOM 结构、CSS token 时必须同步两侧 skill」——但代码层先得统一，skill 才有单一来源可参照。

**7b. side-panel 定位 className**：`sidePanelPinned ? "relative z-..." : "absolute ... translate-x-..."` 分支在 `features/project-panel/index.tsx:45-51` 和 `features/activity-bar/index.tsx:55-61` 各一份。

### 8. `useStreamingStore` 未在 AGENTS.md 登记

`features/chat/streaming-store.ts`（~290 行）是第二个 feature-local store，管理 WS 连接、消息流、滚动位置。AGENTS.md「前端 store 使用原则」只举了 `settings/store.ts` 的例子，未说明 feature-local store 是一种被认可的模式。

## 设计

### D1. 解掉 `project-data-store → settings` 倒置

`getErrorMessage()` 现在唯一用途是统一错误文案。locale 本应是渲染期关注点，不该渗入 store。

**方案**：`getErrorMessage(err)` 只判断「是 Error 实例取 `message`，否则取一个稳定的 fallback key」，不再翻译。翻译责任上移到**展示 error 的组件**（目前主要是 `AgentSessionList.handleRenameSession` 的 toast，`project-data-store.ts:94` 唯一调用点之外，error 字段的消费者本就用 `t()` 包装）。

具体：

- `getErrorMessage(err)` 返回 `err instanceof Error ? err.message : ""`（空串作 fallback）。
- store 的 `error` 字段语义改为「原始错误消息（可能为空）」，由消费组件用 `t("error.requestFailed")` 兜底。
- 删除 `project-data-store.ts:5` 对 `useSettingsStore` 的 import 与 `:2` 对 `translate` 的 import。

**为什么不注入 locale 参数**：所有 store action 已经接收 `client` 参数（调用方持有），再加 `locale` 参数会污染 ~15 个 action 签名，且 locale 在每个调用点都得重新取。把翻译推到展示层更干净。

**为什么不新建 `useI18nStore`**：当前只有 settings store 持有 locale（来自持久化 settings），引入新 store 会造成 locale 双源。locale 的真正归属问题留给后续 i18n 重构，本次不扩面。

### D2. 引入 ProjectContext 提供 `ctx`

新建 `lib/project-context.tsx`：

```ts
export interface ProjectContextValue {
  projectId: string;
  client: ApiClient;
  baseUrl: string;
  projectRoot: string;
}
const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ projectId, ctx, children }) { ... }
export function useProjectCtx(): ProjectContextValue  // throws if missing
export function useProjectCtxOrNull(): ProjectContextValue | null
```

**Provider 安家位置**：挂在 `ProjectLayout` 顶层（`ctx` 来源是 `project.ctx`，project 已从 app-store 解析）。这样 `ProjectLayout` 子树（Chat / ContentBrowser / ProjectPanel / FloatingChatManager）以及同层 ui-sdk listener 都能取到。

> 注：Provider 挂在 ProjectLayout 是临时位置——P0 会把 project scope 提到更高层级。届时 Provider 跟着上移即可，本次的 `useProjectCtx` 消费方无需改动。这是 P1a 为 P0 打底的关键点。

**消费方改造**（统一改成 `useProjectCtx()` 或 props 透传）：

| 组件 | 改造 |
|------|------|
| `HtmlCard` | `useProjectCtx()` 取 `client`、`projectRoot` |
| `DebugMenu` | `useProjectCtx()` 取 `client`、`baseUrl` |
| `AgentSessionList` | 已有 `projectId` prop；改用 `useProjectCtx()` 取 `client`，移除 `useAppStore` 取 project |
| `FloatingChatManager` | `useProjectCtx()` 取 `client`、`baseUrl`；但仍需 `activeProjectId`（floating chat 跟随 active project，见路由调查 §8.8） |
| `useSpherseMessageListener` | 改接收 `ctx` 参数（它已是 hook，但 listener effect 依赖 project 闭包；改成由 ProjectLayout 把 ctx 传入更直接） |

**保留 app-store 访问的场景**：`HtmlCard`/`DebugMenu`/`FloatingChatManager` 仍需 `activeProjectId`（判断「有无 active project」或 floating 跟随逻辑），这部分保留。ctx 链消除后，这些组件对 app-store 的依赖从「2 个 selector」降到「1 个 selector」。

### D3. `collapsedAgentIds` 下沉到 `agent-session-list`

新建 `features/agent-session-list/store.ts`（遵循 `settings/store.ts`、`chat/streaming-store.ts` 的 feature-local store 模式）：

```ts
interface AgentSessionListUiState {
  // per-project，因为 AgentSessionList 按 projectId 渲染
  collapsedAgentIdsByProject: Record<string, Set<string>>;
  toggleAgentCollapsed: (projectId: string, agentId: string) => void;
  setCollapsedAgentIds: (projectId: string, agentIds: Iterable<string>) => void;
  clearProject: (projectId: string) => void;
}
```

- 从 `project-ui-store.ts` 移除 `collapsedAgentIds`、`toggleAgentCollapsed`、`setCollapsedAgentIds`。
- `App.tsx` 关闭项目时的 `clearProjectUi` 调用：增加一行 `clearProject` on the feature store（或由 feature 自身监听 unmount 清理——见 D6 抉择）。
- `agent-session-list/index.tsx:50, 57-58` 改 import feature store。

**测试影响**：`project-ui-store.test.ts` 中 collapsedAgentIds 相关用例迁移到新 feature store 的测试。

### D4. 合并重复派生

**4a. side-panel**：新建 `hooks/useSidePanel.ts`：

```ts
export function useSidePanel() {
  const pinned = useAppStore((s) => s.sidePanelPinned);
  const hovered = useAppStore((s) => s.sidePanelHovered);
  return {
    pinned,
    visible: pinned || hovered,
    clickAwayActive: hovered && !pinned,
    show: useAppStore((s) => s.showSidePanel),
    hide: useAppStore((s) => s.hideSidePanel),
    togglePin: useAppStore((s) => s.toggleSidePanelPinned),
  };
}
```

`activity-bar`、`project-panel`、`useSidePanelClickAway` 改用此 hook。

**4b. floatingSessionId**：在 `project-ui-store.ts` 导出一个 selector 工厂或在 `floating-chat` 导出 `useFloatingSessionId(projectId)` hook。选 hook 形式（与 D6 的 floating-chat 内聚一致）：

```ts
// features/floating-chat/use-floating-session-id.ts
export function useFloatingSessionId(projectId: string): string | null {
  return useProjectUiStore((s) => s.projects[projectId]?.floatingChat?.sessionId ?? null);
}
```

`ProjectLayout`、`agent-session-list`、`useFloatingChatRedirect` 改用。

### D5. `FloatingChatManager` render-setState 改 useEffect

```ts
// before: render 体里
if (!session) {
  useProjectUiStore.getState().setFloatingChat(activeProjectId, null);
  return null;
}

// after: effect
const session = sessions.find((s) => s.id === floatingChat.sessionId);
useEffect(() => {
  if (floatingChat && activeProjectId && !session) {
    setFloatingChat(activeProjectId, null);
  }
}, [floatingChat, activeProjectId, session, setFloatingChat]);
if (!floatingChat || !activeProjectId || !project || !session) return null;
```

孤儿清理逻辑挪到 effect，render 保持纯函数。

### D6. 移走错放文件

| 文件 | 目标 | 说明 |
|------|------|------|
| `hooks/useFloatingChatRedirect.ts` | `features/floating-chat/use-floating-chat-redirect.ts` | 纯 floating-chat 域；与 D4b 的 `useFloatingSessionId` 同居 |
| `hooks/useSidePanelClickAway.ts` | 删除，逻辑并入 `hooks/useSidePanel.ts`（D4a） | click-away 返回值由 `useSidePanel().clickAwayActive` 派生 `onClick` |
| `components/AgentDialog.tsx` | `features/agent-session-list/AgentDialog.tsx` | 唯一消费者在该 feature |
| `components/SearchFileField.tsx` | `features/agent-session-list/SearchFileField.tsx` | 仅被 AgentDialog 用 |

`components/` 只保留真正跨 feature 共享的：`MarkdownContent.tsx`、`EmptyState.tsx`，以及 `components/ui/`（shadcn 原语）。

### D7. 统一重复实现

**7a. scopeCss**：新建 `lib/scope-css.ts`：

```ts
export function scopeCss(css: string, scope: string): string { ... }
```

`useAgentTheme` 调 `scopeCss(css, "[data-chat-root]")`，`FloatingChatContainer` 调 `scopeCss(css, "[data-chat-float-root]")`。两侧删除本地实现。

**7b. side-panel 定位**：D4a 的 `useSidePanel` 已合并状态；定位 className 仍各算（activity-bar 宽 w-14、project-panel 宽 w-65，定位基准不同）。不强行抽组件——抽出 `<SidePanelPositioned>` 会把两个不同尺寸/层级的容器硬绑，收益低于风险。**本次只合并状态派生，不合并定位 className**。

### D8. 补 AGENTS.md feature-local store 文档

在「前端 store 使用原则」一节补充：

> - **feature-local store**：只被单个 feature 使用的状态可在 feature 目录下建立自己的 store（如 `features/settings/store.ts`、`features/chat/streaming-store.ts`、`features/agent-session-list/store.ts`）。feature-local store 不应被其它 feature 或全局 store import。

并在 `docs/official/project-structure.md`（若存在前端 store 章节）同步。

## 不在本次范围（P1b / P0）

明确列出，避免扩面：

- `resolveSessionViews` / `getProjectData` 响应式化（依赖 P0 的新渲染主体）。
- schedule 状态下沉到 `features/agent-schedule/store.ts` + WS 安家（依赖 P0 的 project scope）。
- `agent-session-list/SessionRow` 解耦 `chat/streaming-store`（依赖新的 streaming-status 暴露方式）。
- 路由重构、`ProjectLayout` 拆分、`key={projectId}` 消除。
- content URL builder 行为分叉（`buildContentUrl` vs `open-file.ts`）——属路由层。
- locale 归属根本性重构（i18n store）。

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| `getErrorMessage` 改动影响 error 文案展示 | 所有 error 消费点改为 `error || t("error.requestFailed")` 兜底；逐个核对消费者 |
| ProjectContext 引入导致重渲染 | `ProjectContextValue` 在 project 不变时稳定（ctx 引用稳定），用 memo 包一层；消费方用细粒度 selector 取字段 |
| collapsedAgentIds 迁移丢失状态 | 状态非持久化（内存），关闭项目本就清理；迁移期间最坏情况是折叠态重置，无数据损失 |
| feature store 迁移后 App.tsx 清理调用遗漏 | 在 `closeProject` 流程显式调用新 store 的 `clearProject`，并加测试 |

每项改动独立可回滚；建议按 plan.md 的步骤分 commit，便于二分定位。

## 验证

- `npm run lint --workspace=packages/app`
- `npm test --workspace=packages/app`（含 store 单测 + structure 测试）
- `npm run verify`（全量 lint + build + unit + i18n check）
- 手动验证：打开项目 → 切换 agent 折叠 → 关闭项目重开（验证清理）；触发 store error（如断网）验证错误文案；floating chat 孤儿 session 清理；HTML card 保存；debug menu 下载 turn context
- 受影响 E2E：`file-tree.spec.ts`（AgentDialog 迁移）、chat/session 相关 spec（按 AGENTS.md「E2E 验证选择」按需跑）
