# 体验优化 Round 3

- 日期：2026-06-29
- 状态：Draft（待 review）
- 关联：`docs/dev/features/2026-06-25-experience-optimization-round2`、`2026-06-24-ux-optimization-round1`、`2026-06-05-chat-experience-polish`

## 背景与目标

Round 2 之后，用户反馈集中在聊天交互细节、列表加载性能、若干入口行为与已知 bug。本轮在不改变核心架构的前提下，对 7 项体验问题做针对性优化（原始需求中的第 10 项「search & list files 过滤」经核实**已实现**，本轮跳过；第 3 项「打断提示」与第 4 项「自动滚动重做」经评估后**移出本轮范围**，见下文）。

## 变更清单

| # | 变更 | 类型 | 影响层 |
|---|------|------|--------|
| 1 | 聊天消息时间显示（user 每条 + assistant 仅 turn 末条）| feature | app/renderer |
| 2 | 发送后响应等待动画（thinking 指示器）| UX | app/renderer |
| 5 | Session list 分页加载（每个 agent 一次最多 10 条）| feature | core + server + app/renderer |
| 6 | 右键项目 avatar 改为「打开项目文件夹」| UX | app/main + app/renderer + i18n |
| 7 | Activity bar 与 floating chat 层级修正 | bugfix | app/renderer |
| 8 | 关闭项目时清除自定义主题 | bugfix | app/renderer |
| 9 | Content browser 返回键回到上一页 | bugfix | app/renderer |
| ~~3~~ | ~~手动打断后的「已停止生成」提示~~ | — | **移出本轮** |
| ~~4~~ | ~~自动滚动逻辑重做（1s 节流 + 半窗阈值）~~ | — | **移出本轮** |
| ~~10~~ | ~~search & list files 按 llm-read policy 过滤~~ | — | **已实现，跳过** |

> Change 3/4 移出原因：打断提示涉及 reducer/store/事件竞态，自动滚动涉及半窗阈值+节流交互，两者复杂度高且需充分验证，后续单独处理。
> Change 10 核实结论：`list-files.ts:33,53` 与 `search-content.ts:87` 已通过 `policy.canRead(relativePath)` 在遍历时过滤掉不允许的文件（含其子目录，因为 `continue` 早于递归），并有单测覆盖（`list-files.test.ts:103-115`、`search-content.test.ts:90-103`）。本轮不做改动。

---

## Change 1 — 聊天消息时间显示

### 现状
`MessageItem.tsx:17-69` 渲染消息但不显示任何时间。前端 `ChatMessage`（`types.ts:34-41`）**没有 timestamp 字段**——而后端 DB 已存储 `timestamp`（`session.ts:22`），`parseHistoryMessages`（`chat-session-reducer.ts:187-289`）在解析历史时**丢弃了 timestamp**（`:263-268` 推入的对象不含时间）；live 事件路径也未提取时间。

### 设计

#### 1. 数据：把 timestamp 贯通到 ChatMessage
- `types.ts`：`ChatMessage` 增加可选字段 `timestamp?: number`（毫秒 epoch）。
- **历史路径**：`parseHistoryMessages`（`:263-268`）推入对象时带上 `timestamp: message.timestamp`（DB 行已有该字段）。
- **live 路径**：
  - 用户发送消息：`streaming-store.ts` 的 `sendMessage`（`:295` 附近）在乐观追加 user 消息时设 `timestamp: Date.now()`。
  - assistant 消息：`message_end` 分支（`chat-session-reducer.ts:86-101`）从 `event.message` 提取 `timestamp`（runtime 持久化时已带），写入最终化的 assistant 消息；`message_start`/`message_update` 分支可留空（时间以 end 为准）。若 `event.message.timestamp` 缺失，回退 `Date.now()`。

> timestamp 只用于展示，不参与 reducer 的相等性判断以外的逻辑；`reduceSessionEvents` 现有「messages 引用未变即返回原 session」的短路不受影响（timestamp 变化会生成新 messages 数组，符合预期）。

#### 2. 展示：谁显示时间
规则（在 `MessageList` 渲染时计算 `showTime`，透传给 `MessageItem`）：
- **user 消息**：每条都在气泡下方显示自己的 `timestamp`。
- **assistant 消息**：仅当它是「turn 末条」时显示——即 `index === messages.length - 1`（最后一条），或 `messages[index + 1].role === "user"`（下一条是 user，开启新 turn）。

> 这样一个 turn = 一条 user 气泡（带时间）+ 若干 assistant 气泡（只有收尾那条带时间），与需求一致。正在流式的空 assistant 气泡由 Change 2 的 thinking 指示器接管，不显示时间。

#### 3. 格式
新增工具 `formatMessageTime(ts: number): string`（放 `features/chat/lib/format-time.ts`）：
- 同一天 → `HH:mm`（如 `14:30`）
- 同年不同天 → `MM-DD HH:mm`
- 跨年 → `YYYY-MM-DD HH:mm`

`MessageItem` 在气泡下方渲染一行 `<time className="text-[11px] text-muted-foreground mt-1 …">`，user 右对齐、assistant 左对齐（用 `text-end`/`text-start` 逻辑属性）。仅当 `showTime && message.timestamp` 时渲染。

### 目标文件
- `packages/app/src/features/chat/types.ts`（+`timestamp?: number`）
- `packages/app/src/features/chat/chat-session-reducer.ts`（`parseHistoryMessages` 带 timestamp；`message_end` 分支写 timestamp）
- `packages/app/src/features/chat/streaming-store.ts`（`sendMessage` user 消息带 `Date.now()`）
- `packages/app/src/features/chat/lib/format-time.ts`（新增）
- `packages/app/src/features/chat/MessageList.tsx`（计算 `showTime`）
- `packages/app/src/features/chat/MessageItem.tsx`（渲染时间）

---

## Change 2 — 发送后响应等待动画

### 现状
用户发送消息后，到第一个 `message_start`/`message_update` 到达之间，**没有任何反馈**（`streaming` 已为 true，但屏幕上只有 user 气泡）。`message_start` 会创建一个**空 assistant 气泡**（`chat-session-reducer.ts:68`），目前表现为「agent 名 + 空内容 + 闪烁光标」（`MessageItem.tsx:39`），体验割裂。

### 设计：统一的 ThinkingIndicator
新增组件 `features/chat/ThinkingIndicator.tsx`：assistant 对齐的气泡（`border bg-card`，复用 `data-chat-bubble`），显示 agent 名 + 3 个弹跳圆点（CSS `animate-bounce` + 错峰 `animation-delay`）。无文字（纯视觉），故无需 i18n。

`MessageList` 渲染规则（在 map 之后追加一个指示器，或替换末位空气泡）：
- 当 `streaming === true` 且满足以下任一：
  - 最后一条消息是 user（assistant 尚未 start），或
  - 最后一条是 assistant 且 `content === ""` 且 `_streaming` 且无 `_toolCalls`
- 则在列表末尾渲染 `<ThinkingIndicator agent={agent} />`，并**跳过渲染**末位那条空 streaming assistant 气泡（避免重复）。

一旦 `message_update` 带来真实文本（`content !== ""`），条件不再成立，ThinkingIndicator 消失，正常渲染带内容的 assistant 气泡（保留末尾闪烁光标）。

> 这同时消除了「空气泡 + 闪烁光标」的割裂态：空内容时不渲染光标，改由指示器表达「正在思考」。

### 目标文件
- `packages/app/src/features/chat/ThinkingIndicator.tsx`（新增）
- `packages/app/src/features/chat/MessageList.tsx`（条件渲染指示器 / 跳过末位空气泡）
- `packages/app/src/features/chat/MessageItem.tsx`（空内容时不显示闪烁光标——`message._streaming && message.content` 才显示光标）

---

## Change 5 — Session list 分页加载

### 现状
全量加载：`project-data-store.ts:111-134`（`refreshSessions`）对每个 agent 并行 `listSessions`，扁平化后存入 `projectData.sessions`；DB 层 `session.ts:76-91` `SELECT * FROM sessions ... ORDER BY updated_at DESC` **无 LIMIT**。`AgentGroup.tsx:32-39` 渲染全部 session。

### 设计：按 agent 分页（每次 10 条）

#### Core 层
`session.ts`：新增分页查询（保留原 `listSessions` 给需要全量的场景）：
```ts
listSessionsPage(agentId, limit: number, offset: number): { items: SessionRow[]; hasMore: boolean }
```
SQL：`SELECT * FROM sessions WHERE agent_id = ? AND status = 'active' ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`。
- **新增 `id DESC` 作为 tiebreaker**：`updated_at` 不唯一，单纯按它排序会导致分页跨页跳行/重复。`id DESC` 保证确定性。
- `hasMore`：再查一次 `SELECT COUNT(*)` 或取 `LIMIT+1` 判断（取 `LIMIT+1`，若返回 > limit 则 hasMore=true，截断到 limit）。

#### Server 层
`routes/sessions.ts:7-15`：`GET /sessions` 接受可选 query `?limit=<n>&offset=<n>`。
- 无 params → 保持裸数组（向后兼容）。
- 带 params → 返回信封 `{ items: SessionInfo[], hasMore: boolean }`。

contract（`contracts/sessions.ts`）：新增 `sessionListPageResponse = Type.Object({ items: Type.Array(sessionInfo), hasMore: Type.Boolean() })`，保留原 `sessionListResponse`（裸数组）。

manager（`project-manager.ts:87-91`）：透传分页方法 `listSessionsPage(agentId, limit, offset)`。

#### App 层
- `lib/api.ts`（`:69-73`）：新增 `listSessionsPage(agentId, { limit, offset })`，返回信封。
- `project-data-store.ts`：
  - state 增加 `sessionPaging: Record<string, { hasMore: boolean; offset: number }>`（按 agentId）。
  - `refreshSessions`：对每个 agent 取首页（`limit=10, offset=0`），扁平化存 `sessions`，写入各 agent 的 paging。
  - 新增 `loadMoreSessions(projectId, agentId)`：取 `offset = paging[agentId].offset`，append 到 `sessions`（按 id 去重），更新 paging。
  - `createSession`/`deleteAgent` 后的 `refreshSessions` 复用首页刷新逻辑（重置回第一页）。
- UI：`AgentGroup.tsx` 在组内 session 列表底部，当 `sessionPaging[agentId].hasMore` 为真时显示「加载更多」按钮，点击 `loadMoreSessions`；加载中禁用并显示 loading 态。

> agent 默认折叠（`use-collapsed-agents.ts`），故首屏只渲染 agent 头，但每个 agent 仍只加载首页 10 条 session，显著降低长项目的 IO/内存。

### 目标文件
- `packages/core/src/store/session.ts`（+`listSessionsPage`，`listSessions` 排序加 `id DESC`）
- `packages/core/src/store/session.test.ts`（+分页/hasMore/tiebreaker 单测）
- `packages/core/src/project-manager.ts`（+透传）
- `packages/server/src/contracts/sessions.ts`（+`sessionListPageResponse`）
- `packages/server/src/routes/sessions.ts`（query params + 分支返回）
- `packages/app/src/lib/api.ts`（+`listSessionsPage`）
- `packages/app/src/stores/project-data-store.ts`（`refreshSessions` 改首页 + `loadMoreSessions` + paging state）
- `packages/app/src/features/agent-session-list/AgentGroup.tsx`（加载更多按钮）
- `packages/i18n/src/locales/{zh-CN,en,zh-TW}.ts`（+`agent-session-list.loadMore`）

---

## Change 6 — 右键项目 avatar 改为「打开项目文件夹」

### 现状
`activity-bar/index.tsx:107-109` 的菜单项调 `onReveal` → `app-store.ts:150-154` → preload → `ipc/project.ts:63-65` 用 **`shell.showItemInFolder(projectPath)`**（在 Finder 里选中项目文件夹本身）。

### 设计
改为直接打开文件夹：
- `ipc/project.ts:63-65`：`shell.showItemInFolder` → `shell.openPath(projectPath)`（在系统文件管理器中打开该文件夹窗口）。
- 文案同步改名（语义已变，沿用旧 key 会误导）：删除 `activity-bar.revealInFinder`，新增 `activity-bar.openProjectFolder`：
  - zh-CN：`打开项目文件夹`
  - en：`Open Project Folder`
  - zh-TW：`開啟專案資料夾`
- `activity-bar/index.tsx:107-109`：i18n key 改为 `activity-bar.openProjectFolder`。`app-store.ts` 的 action 名 `revealProject` 可保留（内部命名，不影响用户），或一并改为 `openProjectFolder`（实现时择一，倾向改名保持一致）。

### 目标文件
- `packages/app/electron/ipc/project.ts`（`showItemInFolder` → `openPath`）
- `packages/app/src/features/activity-bar/index.tsx`（i18n key）
- `packages/app/src/stores/app-store.ts`（action 改名，可选）
- `packages/i18n/src/locales/{zh-CN,en,zh-TW}.ts`（删 `revealInFinder`、加 `openProjectFolder`）

---

## Change 7 — Activity bar 与 floating chat 层级修正

### 现状
两者都用 `z-40`：
- Activity bar：`activity-bar/index.tsx:52,59,60`（hover 边条 / pinned / unpinned 均 `z-40`），位于 app root（`relative`）内。
- Floating chat：`FloatingChatFrame.tsx:64` `fixed z-40`，经 `createPortal` 挂到 `document.body`（`FloatingChatContainer.tsx:34-55`），portal 包裹 div 无 z-index。

由于 z 值相同，叠放靠 DOM 顺序脆弱决定：floating chat 因后挂到 body 通常在上，但 activity bar 的 hover 展开/右键菜单（Radix portal）与之竞争，表现为层级错乱。

### 设计：明确 z-index 分层
- **Floating chat 提升到 `z-50`**（`FloatingChatFrame.tsx:64`：`z-40` → `z-50`），确保浮窗始终在 activity bar 之上。
- Activity bar 保持 `z-40`。
- 全局 overlay（dialog / context menu / tooltip）维持 shadcn 默认的高 z（`z-50` 及以上）。floating chat 与它们同处 `z-50` 层级时，靠 DOM 顺序（overlay portal 后挂）自然在上；若实测仍有遮挡，再把 overlay 提到 `z-[60]`。

> 实现时需实测确认：浮窗拖到左侧 activity bar 区域时不被遮挡；右键 activity bar 弹出的 context menu 不被浮窗遮挡。具体症状以实测为准。

### 目标文件
- `packages/app/src/features/floating-chat/FloatingChatFrame.tsx`（`:64` `z-40` → `z-50`）

---

## Change 8 — 关闭项目时清除自定义主题

### 现状
`hooks/useCustomTheme.ts:7-21`：effect 在 `projectRoot`/`baseUrl`/`projectId` 任一为空时 **`return` 早退**（`:8`），导致关闭项目（`ProjectScope` 卸载或 project 变 undefined，三参传 `""`/`undefined`）时，上一个项目的 `<link id="custom-theme-link">` **残留在 `<head>`**，其 CSS 变量继续作用于欢迎页/下一个项目，直到有新有效项目替换。

### 设计
把「移除旧 link」移到早退守卫**之前**，使关闭项目时也能清除：

```ts
useEffect(() => {
  const existingLink = document.getElementById("custom-theme-link");
  if (existingLink) existingLink.remove();   // ← 先清，无论后续是否早退

  if (!projectRoot || !baseUrl || !projectId) return;  // 关闭/无效：到此已清空

  // 创建并 append 新 link（原逻辑）
}, [projectRoot, baseUrl, projectId]);
```

单行顺序调整即可修复：有效项目切换时照常「移除旧的 + 加新的」；项目关闭时「移除旧的 + 早退（不加新的）」。

### 目标文件
- `packages/app/src/hooks/useCustomTheme.ts`（`:8-11` 顺序调整）

---

## Change 9 — Content browser 返回键回到上一页

### 现状
`lib/use-project-navigation.ts:18-39`：历史栈只记录 `location.pathname`。Content browser 的文件导航编码在 **query string**（`?path=<encoded>`，`ContentBrowserPage.tsx:20`），`pathname` 不变。因此文件 A → 文件 B（同 pathname 不同 search）时 effect（`:18-28`）不触发，栈里只有 `["/project/:id/content"]`。点返回：`stack.pop()` 后 `prev` 为 undefined → 回退到 `navigate(\`/project/${projectId}\`)`（首页）。

### 设计：记录完整 location（pathname + search）
- effect 依赖与推入值改为 **`location.pathname + location.search`**（完整 key）：
  - `:18-28` 的 deps 与比较改用 `const key = location.pathname + location.search;`
  - 栈推入 `key`，比较 `stack[last] !== key`。
  - `back`（`:30-39`）：pop 后 `prev` 是完整 key，`navigate(prev)`。
- 这样文件 A→B：栈 = [`…/content?path=A`, `…/content?path=B`]，返回 → `…/content?path=A`（上一页）。
- 仍保留「`prev` 不在项目内则回退首页」的兜底（`:34-37`）。

> 已知边角：该 hook 仅在 `ContentBrowserPage` 内使用，栈在进入 content browser 时才初始化，故「从 chat 进入 content 后点返回」会回退到首页（栈首条即 content 路由）。本变更聚焦修复「content 内文件间返回回首页」的核心 bug；跨页面返回（chat↔content）若后续需要，可演进为 app 级全局历史，不在本轮范围。

### 目标文件
- `packages/app/src/lib/use-project-navigation.ts`（`:18-39` 用完整 location key）

---

## 非目标（本轮不做）
- search/list files 过滤——已实现（见变更清单 #10）。
- 手动打断提示（「已停止生成」）——移出本轮，涉及 reducer/store/事件竞态，后续单独处理。
- 自动滚动重写（1s 节流 + 半窗阈值）——移出本轮，需充分验证。
- app 级全局导航历史（chat↔content 跨页返回）——见 Change 9 边角说明。
- session list 虚拟化——分页已解决加载量问题；虚拟化是独立后续话题。
- timestamp 在 message_start/update 阶段的精确回填——以 message_end 为准即可。

## 测试策略
- **app 单测**：
  - `chat-session-reducer` 测试：`parseHistoryMessages` 带 timestamp；`message_end` 写 timestamp。
  - `project-data-store`：`refreshSessions` 首页 10 条 + `loadMoreSessions` append + paging 状态。
  - `use-project-navigation`：同 pathname 不同 search 的 push/pop + 项目隔离。
- **core 单测**：`session.ts` 的 `listSessionsPage`（limit/offset/hasMore/`id DESC` tiebreaker）。
- **server contract**：`/sessions` 无 params（裸数组）vs 带 params（信封）两种形态。
- **i18n**：`npm run verify` 的 i18n check 确保三套 locale key 对齐（`agent-session-list.loadMore`、`activity-bar.openProjectFolder`）。
- **E2E**：本轮涉及 chat/session/store/server API/routing/activity bar，优先跑 `chat` 相关 spec（时间显示、等待动画）、session list、content browser 返回；合并前跑 `npm run verify:e2e`。
- **手动验证**：主题关闭清除（开项目→关项目→看 `<head>` link 移除）、finder 打开行为、floating chat 层级实测。

## 风险
- **session 分页的 `updated_at` 漂移**：session 活跃时 `updated_at` 变化可能跨页跳行；用 `id DESC` tiebreaker + offset 分页在「加载更多是手动低频操作」的场景下可接受，但首屏与加载更多之间若有 session 变活跃，顺序可能微动（不阻断使用）。
- **floating chat 层级**：pinned 时 z-50、unpinned 时 z-30，需实测 context menu/dialog 不被遮挡。
