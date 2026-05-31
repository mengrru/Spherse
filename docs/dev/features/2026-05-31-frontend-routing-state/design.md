# 前端路由系统与全局状态管理

## 背景

当前 `packages/app` 已经有 `pages/` 目录，但应用仍由 `App.tsx` 和 `ProjectPage.tsx` 通过本地 state 手动切换视图：

- `App.tsx` 管理打开项目、当前项目、初始化和项目切换。
- `ProjectPage.tsx` 管理 agent/session/file 选择、chat/content 视图切换、项目内弹窗和列表刷新。
- `ChatPage` 和 `ContentBrowser` 管理消息流、输入框、编辑器 dirty 状态、文件内容加载等局部状态。

随着项目创建向导、Chat Debug、文件版本控制、多页面设置等功能增加，继续把跨页面状态集中在少数组件里会让组件职责变重，也无法通过 URL 恢复具体会话或文件页面。

## 目标

1. 引入前端路由系统，让项目、会话和文件内容页拥有可恢复的 URL。
2. 引入全局状态管理，收拢跨组件、跨页面共享的工作区状态。
3. 保留 `ChatPage` 和 `ContentBrowser` 的高频局部状态，避免把所有状态都全局化。
4. 为后续新增页面和工作区功能建立清晰的前端组织边界。

## 非目标

- 不重构 core/server API。
- 不引入完整服务端数据缓存层，如 TanStack Query。
- 不把弹窗、输入草稿、WebSocket 消息流、文件编辑 dirty 状态放进 URL。
- 不在本次任务中重做视觉设计。
- 不新增 E2E 测试框架。

## 选型

### React Router

使用 `react-router` 的声明式路由能力，并在 Electron renderer 中采用 Hash Router。

原因：

- Electron 的 renderer 页面通常从本地文件或 Vite dev server 加载，Hash URL 不要求服务端回退配置。
- 当前应用是 Vite + React 单页桌面应用，不需要 React Router Framework Mode。
- Hash URL 足够表达应用内导航状态，适合 `/#/project/:projectKey/chat/:sessionId` 这类内部路径。

### Zustand

使用 Zustand 作为全局状态管理库。

原因：

- 当前跨组件状态更像一个工作区模型，而不是许多独立原子。
- 打开项目、关闭项目、创建会话、删除 agent 后清理选择等动作是业务事务，用 store actions 更直观。
- Zustand 不需要 Provider，可以通过 selector 控制组件订阅范围。
- 在 Electron IPC、router effect 或组件外工具函数中需要读写 store 时，Zustand 的 `getState`/`setState` 模型更直接。

Jotai 保留为未来局部复杂模块的可选方案，例如复杂编辑器、画布或表单状态。本次不作为主 store。

## 路由设计

采用 Hash Router，路由结构如下：

```text
/
/project/:projectKey
/project/:projectKey/chat/:sessionId
/project/:projectKey/content?path=<encodedRelativePath>
```

页面含义：

- `/`：未选择项目时的空状态。
- `/project/:projectKey`：项目已打开，但未选择会话或文件时的项目空态。
- `/project/:projectKey/chat/:sessionId`：项目内某个 session 的对话页。
- `/project/:projectKey/content?path=...`：项目内某个文件的内容浏览或编辑页。

`projectKey` 不直接使用完整文件系统路径。全局 store 为每个打开项目维护稳定 key，并映射到真实 project path、display name、port 和 `AppContext`。生成规则为：取项目目录名作为 base，转为小写，保留字母、数字、下划线和中划线，其他字符替换为 `-`，空结果回退为 `project`。如果同一批打开项目内出现冲突，按 restore/open 顺序追加 `-2`、`-3` 等后缀。key 只需要在当前打开项目集合内稳定；真正持久化身份仍以 project path 为准。

## 状态边界

### 全局应用状态

新增 `useAppStore`，负责：

- `projects`: 打开的项目集合。
- `activeProjectKey`: 当前项目 key。
- `initializing`: restore projects 的初始化状态。
- `restoreProjects()`: 从 Electron store 恢复项目并初始化 `AppContext`。
- `openProject()`: 选择目录、启动 server、加入打开项目并导航。
- `closeProject(projectKey)`: 关闭项目，清理 project store，并选择下一个项目。
- `revealProject(projectKey)`: 在 Finder 中显示项目。
- `setActiveProject(projectKey)`: 更新当前项目并同步 last active project。

### 项目工作区状态

新增 `useProjectWorkspaceStore`，按 `projectKey` 存储：

- `agents`
- `sessions`
- `collapsedAgentIds`
- `initialMessageBySessionId`
- `lastContentPath`
- `loading` 和 `error` 状态

同时提供 actions：

- `refreshAgents(projectKey)`
- `refreshSessions(projectKey)`
- `selectSession(projectKey, sessionId)`
- `createSession(projectKey, agentId, initialMessage?)`
- `deleteSession(projectKey, sessionId)`
- `deleteAgent(projectKey, agentId)`
- `rememberContentPath(projectKey, filePath)`
- `clearProject(projectKey)`

### 保留为组件本地状态

以下状态仍留在具体组件中：

- `ChatPage` 的 `messages`、`input`、`streaming`、textarea 展开状态、WebSocket ref。
- `ContentBrowser` 的 `content`、`loading`、`isEditing`、`editedContent`、`saving`、conflict、确认弹窗。
- `AgentDialog`、`SettingsModal`、`SelectionSessionDialog` 的表单和弹窗内部状态。
- `FileTree` 的展开节点和局部树加载状态。

## 组件组织

新增或调整文件：

```text
packages/app/src/router.tsx
packages/app/src/stores/app-store.ts
packages/app/src/stores/project-workspace-store.ts
packages/app/src/lib/project-key.ts
```

`main.tsx` 挂载 `RouterProvider`。`App.tsx` 作为全局路由外壳，负责全局初始化、`TooltipProvider`、最左侧 ProjectBar 和 route outlet。

`ProjectPage.tsx` 保留为项目工作区页面，读取 route param 和 query，渲染项目内 sidebar，并按路由切换 chat/content 主视图。这样本次改动先完成路由与 store 边界，后续再单独拆分项目 sidebar、agent/session 列表和 workspace 子组件。

## 导航行为

- 应用启动后先执行 `restoreProjects()`。
- 如果 URL 指向已恢复项目，激活该项目。
- 如果 URL 不含项目但存在 last active project，导航到该项目。
- 如果 URL 指向不存在的项目，回退到 `/`。
- 点击 ProjectBar 项目头像，导航到 `/project/:projectKey` 或该项目最近一次项目内路径。
- 点击 session，导航到 `/project/:projectKey/chat/:sessionId`。
- 点击文件，导航到 `/project/:projectKey/content?path=...`，并把该路径记录为项目的 `lastContentPath`。
- 在 ContentBrowser 中划取文本创建 session 后，导航到新 session 的 chat route，并通过 `initialMessageBySessionId` 注入首条消息。
- 关闭当前项目后，如果还有项目，导航到剩余项目；否则导航到 `/`。

## 错误和边界处理

- route param 中的 `projectKey` 找不到项目时显示空状态并导航回 `/`。
- `sessionId` 找不到对应 session 时显示项目空态，并触发 sessions refresh。
- `content` route 缺少 `path` query 时显示项目空态。
- 文件读取失败仍由 `ContentBrowser` 展示现有错误状态。
- store action 中捕获 API 错误，写入对应项目 workspace 的 `error`，避免无声失败。

## 测试与验证

本次主要验证：

- `npm run build --workspace=packages/app`
- 手动验证应用启动后可恢复项目。
- 手动验证项目切换、session 切换、文件打开、返回 chat、关闭项目。
- 手动验证刷新 renderer 后 URL 可恢复到对应项目、session 或文件。
- 手动验证从 ContentBrowser 划取文本创建 session 后会进入新 chat route 并发送 initial message。

如果实现中抽出纯函数，例如 project key 生成和冲突消解，应补充单元测试或至少通过 TypeScript build 覆盖类型正确性。

## 文档更新

实现完成后需要检查并更新：

- `docs/official/project-structure.md`：补充 router、layouts、stores、project-key 等文件。
- `docs/official/architecture.md`：补充前端路由与全局状态约定。
- `docs/dev/backlog.md`：将“前端重构”或新增对应条目更新为已完成/部分完成，并补充后续拆分任务。
