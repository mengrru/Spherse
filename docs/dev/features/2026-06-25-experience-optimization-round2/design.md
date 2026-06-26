# 体验优化 Round 2

- 日期：2026-06-25
- 状态：Draft（待 review）
- 关联：`docs/dev/features/2026-05-18-agent-form-ui`、`2026-05-31-frontend-routing-state`、`2026-05-12-skill-support`

## 背景与目标

Round 1 之后，用户反馈与已知 bug 集中在三个方向：UI 入口收敛、权限模型简化、持久化/加载行为修正。本轮在不改变核心架构的前提下，对以下 5 项体验问题做针对性优化。

原始需求中的「关闭项目时未将项目从 electron store 中移除」经核实已在 commit `38a447c` 修复（`close-project` IPC handler 已调用 `removeOpenProjectById`），本轮不再处理，但会顺带修复一个由 lastRoute 迁移 localStorage 引入的关联清理缺口（见 Change 4）。

## 变更清单

| # | 变更 | 类型 | 影响层 |
|---|------|------|--------|
| 1 | 创建 agent 按钮改为下拉菜单 | UX | app/renderer |
| 2 | 全量改名「搭档」→「角色」 | 文案 | i18n（3 locales）|
| 3 | Agent dialog：权限分组 + 文案调整 | UX + 数据语义 | app/renderer + i18n |
| 4 | lastRoute 迁移至 localStorage + 关闭清理 | bugfix | app/renderer + app/main |
| 5 | 聊天历史懒加载（最新 10 turn + 加载更多）| feature | core + server + app/renderer |

> 下文「目标文件」标注的是改动落点；具体行号以实现时的代码为准。

---

## Change 1 — 创建按钮改为下拉菜单

### 现状
`packages/app/src/features/agent-session-list/index.tsx:173-179`：`SidebarGroupAction`（侧栏分组标题右侧的绝对定位按钮）内放一个 `PlusIcon`，`onClick` 直接打开创建弹窗。

### 设计
将 `SidebarGroupAction` 的内容包进 `DropdownMenu`，按钮本身作为 `DropdownMenuTrigger`（通过 base-ui 的 `render` prop 复用现有 `SidebarGroupAction` 外观，与 `AgentRow.tsx` 的 `ContextMenuTrigger render={...}` 同模式）。

下拉内容当前**只放一项**：「创建角色」。采用下拉形态是为后续入口（导入角色等）预留扩展位，不改变任何现有行为。

### 参考
- 唯一现存 DropdownMenu 用例：`packages/app/src/features/debug-tools/DebugMenu.tsx:93-141`（`DropdownMenu` > `Trigger render={<Button/>}` > `Content` + `Item`）。
- 组件原语：`packages/app/src/components/ui/dropdown-menu.tsx`。

### 目标文件
- `packages/app/src/features/agent-session-list/index.tsx`（替换 173-179 的 `SidebarGroupAction` 结构）
- i18n：菜单项文本**复用** `agent-session-list.createAgentTooltip`（Change 2 会把文案从「创建搭档」改为「创建角色」）；trigger 按钮的 `title` 也用同一 key。不新增 key——菜单项 label 与按钮 tooltip 文本一致即可。

---

## Change 2 — 全量改名「搭档」→「角色」

### 设计
将所有用户可见的「搭档 / Partner / 搭檔」文案统一为「角色」（en: Role；zh-TW: 角色）。覆盖三个 locale 文件中所有含该语义的 key。

### 完整改名清单（跨 zh-CN / en / zh-TW 三套 locale，对应行以 zh-CN 为基准）

| key | zh-CN 现 → 新 | en 现 → 新 | zh-TW 现 → 新 |
|-----|---------------|------------|----------------|
| `agent-dialog.createTitle` | 创建搭档 → 创建角色 | Create Partner → Create Role | 建立搭檔 → 建立角色 |
| `agent-dialog.editTitle` | 编辑搭档 → 编辑角色 | Edit Partner → Edit Role | 編輯搭檔 → 編輯角色 |
| `agent-dialog.namePlaceholder` | 搭档名称 → 角色名称 | Partner name → Role name | 搭檔名稱 → 角色名稱 |
| `agent-dialog.nameRequired` | 请输入搭档名称 → 请输入角色名称 | Please enter a partner name → Please enter a role name | 請輸入搭檔名稱 → 請輸入角色名稱 |
| `agent-session-list.createAgentTooltip` | 创建搭档 → 创建角色 | Create Partner → Create Role | 建立搭檔 → 建立角色 |
| `agent-session-list.emptyAgents` | 暂无搭档 → 暂无角色 | No partners defined → No roles defined | 暂無搭檔 → 暂無角色 |
| `agent-session-list.groupLabel` | 创作搭档 → 角色 | Creative Partners → Roles | 創作搭檔 → 角色 |
| `agent-session-list.confirmDeleteAgent` | …删除搭档「{name}」…该搭档下… | …partner… → …role… | …搭檔… → …角色…（两处） |
| `text-selection.agentPlaceholder` | 选择搭档 → 选择角色 | Select Partner → Select Role | 選擇搭檔 → 選擇角色 |

> `confirmDeleteAgent` 中「搭档」出现两次（主语与「该搭档下的会话」），均需替换。

### 目标文件
- `packages/i18n/src/locales/zh-CN.ts`（基准）
- `packages/i18n/src/locales/en.ts`
- `packages/i18n/src/locales/zh-TW.ts`

### 备注
key 名（`agent-dialog.*`、`emptyAgents`、`confirmDeleteAgent` 等）**不改**，只改 value。避免破坏代码中的引用。

---

## Change 3 — Agent dialog 权限分组 + 文案调整

### 文案变更
| key | zh-CN 现 → 新 | en 现 → 新 | zh-TW 现 → 新 |
|-----|---------------|------------|----------------|
| `agent-dialog.toolsLabel` | 工具权限 → 权限 | Tool Permissions → Permissions | 工具權限 → 權限 |
| `tool.load_skill` | 加载技能 → 使用技能 | Load Skill → Use Skill | 載入技能 → 使用技能 |

### 权限分组（核心）

将原来 11 个独立工具 chip，按语义归并为 **2 个分组 + 4 个独立项**：

| 分组/独立项 | 绑定的底层 tool id | i18n（新增） |
|------------|-------------------|-------------|
| **读取文件**（分组） | `read_file` + `list_files` + `search_content` 三者绑定 | `agent-dialog.permRead` = 读取文件 / Read Files / 讀取檔案 |
| **写入文件**（分组） | `write_file` + `edit_file` + `move_file` + `copy_file` 四者绑定 | `agent-dialog.permWrite` = 写入文件 / Write Files / 寫入檔案 |
| 追加日志（独立） | `append_changelog` | 复用 `tool.append_log` |
| 使用技能（独立） | `load_skill` | `tool.load_skill`（已改文案）|
| 渲染卡片（独立） | `render_card` | 复用 `tool.render_card` |
| 生成图片（独立） | `generate_image` | 复用 `tool.generate_image` |

#### 分组交互
- 分组 chip 的选中态 = **全部成员 id 都在 `formData.tools` 中**；部分成员选中视为未选中（当前不存在半选态 UI，且默认全选，故不会出现部分态；实现时若出现部分态，按「未选中」显示，点击则全选该组）。
- 点击分组 chip：未选中 → 把该组全部成员 id 加入；已选中 → 移除全部成员 id。
- 点击独立项：行为不变（单独 add/remove）。

#### 数据存储不变（UI-only grouping）
`formData.tools`、`AgentProfile.tools`、frontmatter `tools:` 数组、server contract `Type.Array(Type.String())`、runtime `session-runtime.ts:157-160` 的精确 id 匹配——**全部保持细粒度 tool id**。分组纯粹是 `ToolPicker` 渲染层把多个 id 的 toggle 行为绑定在一起。

> 为什么不改存储层：runtime 通过精确字符串匹配查找 tool id；若存储分组 id（如 `read`），要么 runtime 要做 id 展开，要么 contract 要加新 enum，两者都引入额外风险与复杂度，且无运行时收益。UI-only 分组零风险且完全等价。

#### i18n 清理
分组后，原本用于 7 个被归并工具的独立 label key（`tool.read_file`、`tool.write_file`、`tool.edit_file`、`tool.list_files`、`tool.search_content`、`tool.move_file`、`tool.copy_file`）不再被 `ToolPicker` 引用。**删除这 7 个 key**（三个 locale），避免歧义；保留前确认无其它消费方（实现时 grep 验证）。

> ⚠️ 注意 `tool.read_file`/`tool.write_file` 的现值恰好就是「读取文件/写入文件」，与分组名相同。故分组 label 必须用**新 key** `agent-dialog.permRead`/`permWrite`，不能复用旧 key——否则语义从「单个工具」变成了「分组」，旧 key 的消费方若残留会产生歧义。

### 目标文件
- `packages/app/src/features/agent-session-list/AgentDialog.tsx`（`ToolPicker` 143-172，`toggleTool` 54-61）
- `packages/app/src/lib/tool-registry.ts`（新增分组元数据或 grouping helper；保留 `ALL_TOOLS`/`ALL_TOOL_IDS`/`getToolLabel`）
- `packages/i18n/src/locales/{zh-CN,en,zh-TW}.ts`（改 `toolsLabel`、`tool.load_skill`；新增 `agent-dialog.permRead`/`permWrite`；删除 7 个归并 key）

---

## Change 4 — lastRoute 迁移 localStorage + 关闭清理

### 现状
用户在某 project 内停留的子页面路由，经 IPC 写入 electron-store 的 `openProjects[].lastRoute`（与 locale/model 等应用级设置共用同一 `settings.json`）。这违反「应用级设置」与「项目级 UI 状态」的关注点分离，且每次路由变化都触发一次跨进程 IPC 写盘。

### 设计
把 lastRoute 的持久化后端从 electron-store 迁移到 renderer `localStorage`，遵循本项目 `floating-chat/store.ts` 已建立的 per-project localStorage 模式。

### 新增（renderer 侧）
lastRoute 的内存缓存 (`ProjectState.lastRoute`) 与 `setProjectLastRoute` action 都在 `app-store.ts`（全局 store），且 `App.tsx`、`ProjectScope.tsx` 跨层消费它。因此持久化 helper 应与 `app-store` 同目录：**`packages/app/src/stores/last-route-storage.ts`**（不放在 `features/agent-session-list/` 下——按 AGENTS.md 的 store 作用域规则，它不是 agent-session-list feature 的内部状态）。

该文件导出：
- `getLastRoute(projectId): string | null`
- `setLastRoute(projectId, route): void`
- `clearLastRoute(projectId): void`

key 格式：`spherse:last-route:<projectId>`，value = route 字符串。读写均加 `typeof localStorage === "undefined"` 守卫（测试/SSR 安全；现有 `app-store.test.ts` 已 stub `localStorage`）。

### 改动
1. `app-store.ts` 的 `setProjectLastRoute`：写 `setLastRoute(projectId, route)` 而非 `window.electronAPI.setProjectLastRoute`。
2. `restoreProjects`（`app-store.ts:43-50`）：从 `getLastRoute(id)` 回填 `ProjectState.lastRoute`，而非从 IPC 返回值取。
3. `App.tsx` `handleCloseProject`（75-87）：在现有 `clear*` 调用旁新增 `clearLastRoute(projectId)`。**这是本轮真正的清理 bugfix**——lastRoute 迁到 localStorage 后，关闭项目若不清理，会在 localStorage 留下孤儿 key。

### 删除（electron/main 侧 + IPC 契约）
- `packages/app/electron/ipc/project.ts`：删 `set-project-last-route` handler（68-70），从 `restore-projects` 返回结构移除 `lastRoute` 字段（39、43）。
- `packages/app/electron/settings.ts`：删 `updateProjectLastRoute`（170-177）；`OpenProjectEntry` 移除 `lastRoute?` 字段（6-12）。
- `packages/app/shared/electron-api.ts`：删 `setProjectLastRoute` 方法（38）。
- `packages/app/electron/preload.ts`：删对应 `set-project-last-route` invoke（27-28）。

> `app-store.ts` 中的 `ProjectState.lastRoute`（内存缓存）保留——它仍用于导航回填，只是持久化后端换了。

### 测试
- `app-store.test.ts`：更新 stub，断言 lastRoute 走 localStorage 而非 IPC；新增关闭项目后 localStorage key 被清除的 case。

---

## Change 5 — 聊天历史懒加载（最新 10 turn + 顶部「加载更多」）

### 现状
`streaming-store.ts:217-225` 在 attach 时一次性 `getSessionMessages` 拉取**全部**历史（`SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC`，无 LIMIT），`parseHistoryMessages` 全量处理后 `MessageList` 全量渲染。长会话首屏卡顿且内存占用高。

### 定义
**turn** = 一条 user 消息 + 其后所有非 user 消息（assistant / toolResult），直到下一条 user 消息。这与 `chat-session-reducer.ts:271-279` 的 run-boundary 判定一致，也是前端展示的单位（`parseHistoryMessages` 会把 toolResult 合并进前一个 assistant 消息，所以每个 turn 在 UI 上是「user 气泡 + 一个 assistant 气泡」）。

### 设计：API 层分页（cursor-based，turn 计数）

#### 关键约束：双调用路径隔离
`getSessionMessages` 被**两条路径**共用：
1. **显示 REST 端点**（`streaming-store` → `/sessions/:id/messages`）——本次分页改造目标。
2. **agent 运行时上下文恢复**（`session-runtime.ts:72` `restoreSession` → `agent.state.messages = getSessionMessages(...)`）——必须保持**全量加载**，因为 LLM 需要完整对话上下文。

**方案**：保留 `getSessionMessages(sessionId)` 原样（全量，给 runtime 用）；新增独立的分页方法给显示路径。两条路径彻底解耦，互不影响。

#### Core 层（`packages/core/src/store/session.ts`）
新增方法：
```ts
getRecentTurns(
  sessionId: string,
  turns: number,         // 想取的 turn 数（默认 10）
  beforeId?: number,     // 游标：取 id < beforeId 的（首次不传 = 取最新）
): { messages: any[]; hasMore: boolean }
```
实现：
1. SQL `SELECT * FROM messages WHERE session_id = ? AND id < ? ORDER BY id DESC LIMIT (足够大的 N)` 取出 `beforeId` 之前的倒序行。
2. 在 JS 层按 turn 边界（`role === "user"` 开启新 turn）切片，取满 `turns` 个 turn。
3. 反转为 ASC 返回；`hasMore` = 切片后仍有剩余行。
4. 首次调用（`beforeId` 缺省）：先查 `SELECT MAX(id) FROM messages WHERE session_id=?` 作为起点。

> **取数策略**：一次性 `SELECT * FROM messages WHERE session_id = ? AND id < ? ORDER BY id DESC` 取出 `beforeId` 之前的**全部**行，在 JS 层按 turn 边界切片取满 `turns` 个完整 turn（从最新往旧数），丢弃剩余行。
>
> 不设每批行数上限、不做分批游标拉取。理由：(1) agent loop 保证每个 turn 收敛，10 个 turn 的消息总量有界，全量取出这一段在内存与 IO 上都安全；(2) 任何上限系数（如 `turns * 8`）都有截断最早 turn 的风险——一旦行数达到上限就停止取数，会导致当前页最旧的那个 turn 显示不全，体验不可接受。全量取出后按 turn 边界切片，能保证每个返回的 turn 都是完整的。

#### Server 层
`GET /api/projects/:projectId/agents/:agentId/sessions/:id/messages`：
- 新增 query params：`?turns=<n>`、`?before=<msgId>`（均可选）。
- 无 params 时：**保持向后兼容**，返回全量（裸数组），等价旧行为。
- 带 params 时：返回 `{ messages: [...], hasMore: boolean }` 信封。

> **Breaking change 提示**：带分页参数时响应结构从裸数组变对象。这是首次改 messages 信封形态。contract 测试（`packages/server`）需覆盖两种形态。

contract（`packages/server/src/contracts/sessions.ts`）：
- `sessionMessagesResponse`（现 `Type.Array(Type.Unknown())`）保留为全量响应。
- 新增 `sessionMessagesPageResponse = Type.Object({ messages: Type.Array(Type.Unknown()), hasMore: Type.Boolean() })`。

manager（`project-manager.ts:110-114`）：新增 `getRecentSessionHistory(agentId, sessionId, turns, beforeId)` 转调 store 新方法。

#### App 层
- `lib/api.ts`：`getSessionMessages` 增加可选 `{ turns?, before? }`，返回类型联合（全量数组 / 分页信封），或新增 `getSessionMessagesPage(...)` 方法（实现时择一，倾向新增独立方法避免返回类型歧义）。
- `streaming-store.ts`：attach 时只拉最新 10 turn；session 状态新增 `hasMore: boolean`、`oldestLoadedId: number | null`、`loadingMore: boolean`；新增 `loadMore(sessionId)` action，调分页接口、prepend 到 `messages`（`mergeHistoryMessages` 已支持 history 在前）。
- `MessageList.tsx`：消息列表**顶部**显示「加载更多」按钮（`hasMore` 为真且未在加载时显示），点击触发 `loadMore`；加载中显示禁用/loading 态。
- `useChatScroll`：**prepend 时保持 scroll 锚点**——prepend 前记录 `scrollHeight`，prepend 后 `scrollTop += (newScrollHeight - oldScrollHeight)`，避免视图跳到底部。

#### 边界
- 新会话（无历史）：`messages=[]`，`hasMore=false`，不显示按钮。
- 全部加载完：`hasMore=false`，隐藏按钮。
- 流式新消息：走现有 WS 事件链，append 到末尾，不影响分页状态。
- 空结果但 `beforeId` 合法：`messages=[]`，`hasMore=false`。

### 目标文件
- `packages/core/src/store/session.ts`（+`getRecentTurns`）
- `packages/core/src/project-manager.ts`（+分页透传方法）
- `packages/core/src/store/session.test.ts`（+单测：turn 边界、hasMore、cursor、空会话）
- `packages/server/src/contracts/sessions.ts`（+`sessionMessagesPageResponse`）
- `packages/server/src/routes/sessions.ts`（query params + 分支返回）
- `packages/app/src/lib/api.ts`（+分页 client 方法）
- `packages/app/src/features/chat/streaming-store.ts`（初始 10 turn + `loadMore` + 分页状态）
- `packages/app/src/features/chat/MessageList.tsx`（顶部加载更多按钮）
- `packages/app/src/features/chat/hooks/useChatScroll.ts`（prepend scroll 锚点保持）

---

## 非目标（本轮不做）
- 下拉菜单的后续扩展项（导入角色等）——仅预留入口形态。
- `removeOpenProject(projectPath)`（按 path 的死代码，settings.ts:143-150）的清理——与本轮无关。
- MessageList 虚拟化——分页已能解决首屏问题；虚拟化是独立的后续话题。
- 权限分组的存储层改造——明确不做（见 Change 3 论证）。

## 测试策略
- **core**：`getRecentTurns` 单测覆盖 turn 边界、cursor、空会话、部分 turn、hasMore 边界。
- **server**：contract 测试覆盖全量（无 params）与分页（带 params）两种响应形态。
- **app**：`app-store.test.ts` 更新（lastRoute localStorage + 关闭清理）；`tool-registry`/`AgentDialog` 如有 helper 则补单测。
- **i18n**：`npm run verify` 的 i18n check 确保三套 locale key 对齐。
- **E2E**：按 AGENTS.md，改动涉及 chat/session、store、server API，优先跑 `chat` 相关 spec 与 `file-tree`（验证侧栏改名未破坏导航）；合并前跑 `verify:e2e`。

## 风险
- **server contract 形态变化**：分页返回信封是新形态。靠「无 params 走旧路径」保持向后兼容，降低风险。
- **prepend scroll 还原**：是前端最易出 bug 的点，需在 `useChatScroll` 加测试。
- **lastRoute 迁移的存量数据**：旧版本写到 electron-store 的 `lastRoute` 在升级后不再读取。影响极小（用户当前页丢失一次），不做迁移脚本。
