# [Infra] 项目级生命周期编排收敛

## 背景

`docs/dev/infra/2026-08-22-frontend-architecture-followup/followup.md` P2「收敛项目级 Bridge」的触发条件（新增两个以上项目级 bridge）已满足：`ProjectScope` 现挂载 5 个 bridge（UiSdk / TriggerEvent / ContentQuery / ThemeQuery / WelcomePage）+ 3 个 FeatureGate manager（FloatingChat / FloatingContentBrowser / Browser）+ 3 个项目级 hook 与 2 个 useEffect。

同时项目关闭清理链落在 `features/activity-bar/use-project-actions.ts` 的 `handleCloseProject` 中，手工编排 8 个清理调用。`packages/app/README.md` 写明「关闭项目时，由编排层显式清理所有 per-project store 和 query cache」，但该编排层实际不存在：每新增一个 per-project store 都必须记得修改 activity-bar 的 hook，且该 hook 是 feature 层代码承担 app 级编排职责。此外 `lib/use-project-navigation.ts` 的模块级 `projectNavStacks` Map 属于 per-project 状态但不在任何清理面中，关闭后永不释放。

清理链还存在一个正确性缺陷：**关闭项目不断开该项目的 streaming runtime**。`cleanupExpired` 的守卫 `!session.streaming` 使仍在 streaming 的 session 永不清理，其 WebSocket 与重连定时器持续存活；且后续事件回写 `setStreaming` 会在 `project-data-store` 中重建已清除的项目条目（`updateProjectData` 对不存在的项目会创建）。

## 目标

- 项目关闭的全部级联清理收敛为单一入口 `closeProjectCascade`，调用方（当前仅 activity-bar）只保留导航与 toast 等 UI 关注点
- 关闭项目时同步断开该项目全部 streaming runtime（WebSocket、重连/心跳/探测定时器）
- `ProjectScope` 回归纯布局：bridge 与 manager 挂载收敛到 `<ProjectRuntimeBridges />`（followup P2 原方案）
- 新增 per-project store 时，structure test 强制其在 cascade 清理面中出现，消除「记得来加一行」的隐式契约

## 非目标

- 不改 server API 与 host bridge 契约
- 不做 session detail cache 统一、streaming/trigger 镜像移除（followup P0/P1 独立推进）
- 不引入 store 注册表、事件总线或 service locator：cascade 使用显式清理清单（followup 红线「不把多个 bridge 合成新的全局事件总线」）
- 不改 streaming TTL 缓存策略（未关闭项目仍保留 5 分钟空闲缓存）
- 不处理「关闭项目时正在 streaming 的会话的服务端侧终止」——服务端随项目关闭自会回收，本变更只保证客户端不再持有连接

## 方案

### 1. streaming 泄漏修复（先行，独立可交付）

`useStreamingStore` 新增 action：

```ts
disconnectProject(projectId: string): void
```

遍历 `state.sessions` 中 `session.projectId === projectId` 的条目，逐个调用现有 `disconnect(sessionId)`（含 runtime dispose、eventQueue 清理、空闲定时器回收；跨项目仍有 session 时全局清理定时器按现状保留）。

顺序安全性依据：`ChatSessionRuntime.dispose()` 先置 `manuallyClosed = true`、清空全部定时器、将 `this.ws` 置 null 再 `close()`；`ws.onclose` / `ws.onmessage` / `reconcileHistory` 异步回溯均有 `this.ws !== ws` 或 `!getSession()` 守卫早退——**dispose 之后无任何回调写入 store**，因此 cascade 中 disconnect 之后的清理不会出现迟到写入。

### 2. `closeProjectCascade`

新文件 `packages/app/src/layouts/project-lifecycle.ts`（README 已规定 layouts 承担「项目生命周期编排」，依赖方向 layouts → stores/queries 合法）：

```ts
export async function closeProjectCascade(
  bridge: HostBridge,
  projectId: string,
): Promise<string | null>
```

清理顺序：

1. `useAppStore.getState().closeProject(bridge, projectId)` —— host 侧关闭 + projects map 删除 + 计算 nextProjectId（不变）。**置于最前**：失败直接抛出，本地状态完全不动（与现状一致）；若先做本地清理而 host 关闭失败，会出现「项目仍打开但 chat session 已全部从 store 删除且 attach effect 不重跑」的部分态
2. `useStreamingStore.getState().disconnectProject(projectId)` —— host 关闭成功后立即断开事件源，后续清理期间无写入方
3. `clearProjectQueries(projectId)` —— generation +1、cancel、remove（不变）
4. 逐个 per-project store 清理：`useAgentSessionListUiStore` / `useTriggerStore` / `useFloatingChatStore` / `useFloatingContentBrowserStore` / `useBrowserStore` 的 `clearProject`
5. `useProjectDataStore.getState().clearProjectData(projectId)`
6. `clearProjectNavHistory(projectId)`（`lib/use-project-navigation.ts` 新导出；模块级 `projectNavStacks` Map 当前永不清理）
7. `clearLastRoute(projectId)`

返回值与现有 `app-store.closeProject` 一致（nextProjectId），导航留在调用方。

`use-project-actions.ts` 的 `handleCloseProject` 改为调用 cascade + 导航；删除对逐个清理函数的直接依赖。

### 3. `<ProjectRuntimeBridges />`

新文件 `packages/app/src/layouts/ProjectRuntimeBridges.tsx`，仅负责挂载（无 state、无 effect、无 props），**返回 fragment 不引入包装元素**（当前 8 个挂载点是 ProjectScope flex 容器的直接子节点，包 div 会改变布局树）：

- 3 个 FeatureGate manager：FloatingChatManager / FloatingContentBrowserManager / BrowserManager
- 5 个 bridge：UiSdkBridge / TriggerEventBridge / ContentQueryBridge / ThemeQueryBridge / WelcomePageQueryBridge

`ProjectScope` 渲染 `<ProjectRuntimeBridges />` 替代上述 8 个挂载点与对应 import。

### 4. structure test 防漏

`layouts/project-lifecycle.structure.test.ts`：

- fs 递归遍历 `packages/app/src` 全部 `.ts` 源文件（跳过 `.test.ts`），按 `create<...Store>(` 定义识别 store 文件——不依赖「store 必须在特定路径」的命名约定，未来 `stores/sub/` 或 feature 内多级目录均可覆盖；凡 store 文件内定义了 `clearProject` / `clearProjectData` action 的，其导出的 `useXxxStore` 标识符必须出现在 `project-lifecycle.ts` 源码中
- 断言 cascade 源码包含 `disconnectProject`、`clearProjectQueries`、`clearProjectNavHistory`、`clearLastRoute`（streaming / query / nav 栈 / localStorage 四个非 store action 清理面）
- 同步更新 `ProjectScope.structure.test.ts`：`<UiSdkBridge />` 断言迁移为 `<ProjectRuntimeBridges />`

新增 `ProjectRuntimeBridges.structure.test.ts`：断言组件源码不含 `useState` / `useEffect`（仅挂载，不成为逻辑汇聚点），且返回 fragment（不含 JSX 包装元素）。

### 已知取舍

- structure test 基于源码文本扫描而非 AST：对「一个文件定义多个 store」等特殊形态覆盖不足；当前仓库所有 per-project store 均为一文件一 store，文本断言足够，误报优于漏报
- 显式清单仍是手工维护：test 保证「定义了 clearProject 的 store 不被遗漏」，但不强制新 store 必须提供 clearProject；由 README 既有规范与 review 保证
- 迟到写入的保护机制按层区分：session mutations 由 generation 拦截（`queries/project/sessions.ts`）；agent mutations 无 generation，靠 invalidate-no-op 兜底；bridge 事件（如 trigger）由 unmount 截断。`clearProjectQueries` 与 navigate 之间 TriggerEventBridge 仍挂载的极小窗口内，trigger 事件可为已清项目重建 byProject 条目并残留到下次打开——可接受，随 followup P1 镜像移除整体消除
- `app-store.refreshProjects`（外部关闭/多窗口导致项目从快照消失）不走 cascade，该路径下 streaming runtime 仍可能泄漏：受「全局 store 不得依赖 feature-local store」红线约束，修复需 streaming runtime 生命周期整体重构（与 followup P1 镜像移除合并考虑），本设计记为已知缺口
- Composer 草稿 localStorage key `spherse:draft:{sessionId}` 为 per-session key，无法由 projectId 枚举清理，项目关闭后残留——已知缺口，无正确性影响
- cascade 内错误直接抛出与 `app-store.closeProject` 现行为一致；`closeProject` 中的 `setLastActiveProject` 为 hint 性持久化，失败时仅 warn 不中断（否则该 host await 点失败会使本地清理全跳过、泄漏以新路径复发），「host 关闭成功后的本地清理均为同步纯内存操作，无中间失败态」由此成立

## 影响文件

| 文件 | 变更 |
|---|---|
| `packages/app/src/features/chat/runtime/streaming-store.ts` | 新增 `disconnectProject` |
| `packages/app/src/features/chat/runtime/streaming-store.test.ts` | 新增 disconnectProject 用例 |
| `packages/app/src/layouts/project-lifecycle.ts` | 新增 cascade |
| `packages/app/src/layouts/project-lifecycle.structure.test.ts` | 新增清理面扫描测试 |
| `packages/app/src/layouts/ProjectRuntimeBridges.tsx` | 新增 bridge 收敛组件 |
| `packages/app/src/layouts/ProjectRuntimeBridges.structure.test.ts` | 新增挂载结构测试 |
| `packages/app/src/layouts/ProjectScope.tsx` | 移除 8 个挂载点，渲染 ProjectRuntimeBridges |
| `packages/app/src/layouts/ProjectScope.structure.test.ts` | 断言更新 |
| `packages/app/src/lib/use-project-navigation.ts` | 新增 `clearProjectNavHistory` 导出 |
| `packages/app/src/features/activity-bar/use-project-actions.ts` | handleCloseProject 改用 cascade |

## 测试计划

- 单测：streaming-store `disconnectProject`（断开目标项目全部 runtime、不影响其他项目、streaming 中的 session 也被断开且不再重连）；structure tests（清理面扫描、bridge 组件纯挂载）；cascade 行为测试（成功清理全表面、host close 失败时本地状态不动）；app-store `closeProject`（setLastActiveProject 失败仍完成本地删除）
- 既有测试回归：`npm test --workspace=packages/app`
- E2E：`project-close.spec.ts`——streaming 中经 activity bar 关闭项目断开 chat runtime（WS mock 计数断言无重连）、关闭后 reload 不再恢复项目且 lastRoute 已清、重开项目落到欢迎页；另按变更影响面运行 `app-launch`、`chat-streaming-resilience`、`floating-chat`

## 验收标准（对齐 followup doc）

- `ProjectScope` 不再直接挂载任何 bridge / manager
- 项目关闭的级联清理只有一个入口；activity-bar 不再 import 任何 store 清理函数
- 关闭项目后该项目无存活 streaming runtime；`project-data-store` 不再被关闭后的项目重建条目
- 所有定义 `clearProject` 的 store 被 structure test 覆盖
