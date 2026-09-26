# 项目内全局搜索（聊天 + 文件名）设计

- 日期：2026-09-26
- 状态：已确认，待实施

## 背景与目标

项目内缺少跨会话的内容检索能力。新增当前项目范围的搜索功能：

- 搜索范围：聊天消息内容（用户与助手的文本消息）+ 项目文件名
- 入口一：project panel 空白处右键菜单 →「搜索」
- 入口二：`Cmd/Ctrl+P` 快捷键
- 搜索框以全屏浮层（command palette 风格 Dialog）唤出
- 结果按「聊天」「文件」两组同屏展示
- 点击聊天结果 → 跳转对应会话并定位高亮到命中消息；点击文件结果 → 打开文件
- 搜索范围仅限当前项目

## 已确认的产品决策

1. 聊天搜索仅覆盖 `user/message` 与 `assistant/message` 的文本内容，不含 tool 调用参数与结果（噪音大、体积大、命中价值低）
2. 结果同屏分两组展示（不做 tab 切换）
3. 从未打开过的 legacy 会话（旧 messages 表、未迁移到 events）搜不到，可接受
4. 跳转参数：chat 路由加 `?messageId=<seq>`，值为 event seq 数字（与前端持久 entry id `e${seq}` 同源）
5. `Cmd/Ctrl+P` 拦截浏览器/Electron 默认打印行为（preventDefault）

## 决策

| 决策点 | 结论 |
|---|---|
| 文件名搜索 | 纯前端：复用现有 `GET /file-tree` 全量列表（`useProjectFileTree`）+ 本地模糊匹配（沿用 `SearchFileField` 的多词 substring AND 语义），不加后端 |
| 聊天搜索后端 | core `SessionStore` 新增 SQL LIKE 预过滤 + JS 精确匹配两段式：SQL `events.data LIKE` 作预取（LIKE 会命中 JSON 结构文本，仅当预取用），JS 层解析 message、抽取纯文本后再匹配并生成 snippet，杜绝结构误命中 |
| 废弃消息过滤 | 与历史视图 `deriveHistoryEntries` 语义一致：仅排除 abandoned seq（`turn/retried` / `turn/withdrawn`）；compaction 不影响 UI 视图故不过滤。对有命中的 session 单独查 control 事件（行数极少），复用 `collectAbandonedSeqs` |
| 大小写 | SQLite LIKE 对 ASCII 大小写不敏感，中文不敏感于大小写；JS 二段匹配统一 lower-case 比较。不引入 FTS（中文分词不可靠、个人数据量 LIKE 足够） |
| 结果上限 | server 返回上限 50（query `limit` clamp 1..100）；SQL 预取每 agent 上限 400 行（常量），防止极端 LIKE 命中拖垮 |
| 排序 | 各 agent 命中合并后按 `time` 倒序，截断到 limit |
| API 形态 | `GET /api/projects/:projectId/sessions/search?q=&limit=` 挂在 sessions 路由域；`q` trim 后为空 → 直接返回空结果（不 400） |
| contracts | `sessions.ts` 域内新增 `sessionSearchHit` / `sessionSearchResponse` schema 与 Static 类型，按 contracts 红线全量导出 |
| 跳转定位 | 路由式：`/project/:projectId/chat/:sessionId?messageId=<seq>`。ChatPage 读参传 `locateSeq` 给 Chat；定位成功或判定失败后以 `replace` 清掉参数（避免滚动位置恢复逻辑反复触发）。seq 0 合法，判空只允许 `NaN/null` 判定，禁用 falsy 写法 |
| 返回栈隔离 | `?messageId` 属临时定位参数：项目内自定义返回栈（`use-project-navigation.ts` 以 `pathname+search` 为 key）与 `lastRoute` 记录（`ProjectScope`）都会因「push 带参 → replace 清参」产生只差参数的相邻栈条目，back 时重新带回 messageId 造成定位循环。新增共享工具 `lib/route-params.ts` 的 `stripMessageId(pathname, search)`，两处记录 key 前统一剥离 messageId |
| 自动加载历史 | 目标 seq 早于 `history.oldestSeq` 且 `hasMore` 时循环自动 `loadMore`（每次 20 条）直到覆盖；`hasMore` 耗尽仍无目标 seq → 静默放弃并清参（seq 已被废弃等场景） |
| 消息 DOM 锚点 | `UserBubble` / `AssistantBubble` 根元素加 `data-entry-seq` 属性（新增可选 prop 传入），定位 hook 用 `container.querySelector` 找锚点 |
| 滚动行为 | 定位用原生 `scrollIntoView({ block: "center" })`；col-reverse 容器下浏览器按布局位置计算，无需特判。首次进入会话时 useChatScroll 的恢复/置底逻辑先执行，定位在 loadMore 完成后覆盖，可接受短暂跳动 |
| 高亮 | 定位后给锚点元素加临时 class（`ring-2 ring-primary ring-offset-2 rounded-lg` 常量写在源码中供 tailwind 扫描），2s 后移除 |
| 搜索浮层 | 复用 base-ui `Dialog` 组件体系（z-50 毛玻璃 backdrop），顶部居中 command palette 布局；开关进 `app-ui-store`（`globalSearchOpen`），与 `SettingsModal` 同模式，但渲染挂 `ProjectScope`（搜索为项目级能力）。加 sr-only `DialogTitle` 满足 a11y |
| 快捷键注册 | `ProjectScope` 内 `useEffect` + `window.addEventListener("keydown")`（仓库既有散装模式，无统一注册中心）；`(metaKey\|\|ctrlKey) && key==='p'` → preventDefault + open。ProjectScope 卸载（离开项目）时关闭搜索框 |
| 右键菜单 | `ProjectPanel` 的 `<aside>` 用 `ContextMenuTrigger render={<aside/>}` 包裹（render prop 避免 div 包裹破坏布局）。base-ui trigger 对 contextmenu 事件 `stopPropagation`，文件树行/会话行/智能体行已有内层菜单不受影响，仅空白区域（padding、分组间隙、面板底部、skill 行等无内层菜单处）触发 |
| 菜单项 | 单项「搜索」+ 快捷键提示（mac `⌘P`，其他 `Ctrl P`，按 `navigator.userAgentData?.platform ?? navigator.platform` 判定） |
| 结果项交互 | 聊天项：会话标题（无标题 fallback 与 `SessionRow` 一致）+ snippet + 助手名/时间；文件项：文件名 + 全路径。点击即 navigate 并关闭浮层。键盘 ↑↓ 在展平列表中移动选中、Enter 打开、Esc 关闭（Dialog 自带） |
| 防抖 | 输入 300ms debounce 后才发聊天搜索请求（React Query `enabled: q 非空`）；文件匹配本地即时 |
| 查询缓存 | query key `["projects", projectId, "session-search", q]`，`staleTime: Infinity` 与仓库一致；浮层关闭不清缓存（同一关键词重开即出） |
| i18n | 新增 `global-search.*` key，en / zh-CN / zh-TW 三目录补齐 |

## 契约

### HTTP

`GET /api/projects/:projectId/sessions/search?q=<keyword>&limit=<n>`

- `q`：trim 后为空或缺失 → `{ results: [] }`
- `limit`：clamp 1..100，默认 50
- 响应经 `parseContract(schemas.sessionSearchResponse, ...)`

### contracts schema（`packages/contracts/src/sessions.ts`）

```ts
const sessionSearchHit = Type.Object({
  agentId: Type.String(),
  sessionId: Type.String(),
  sessionTitle: Type.Optional(Type.String()),
  seq: Type.Integer(),
  role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
  snippet: Type.String(),
  time: Type.Number(),
});
sessionSearchResponse: Type.Object({ results: Type.Array(sessionSearchHit) });
```

`packages/contracts/src/index.ts` 导出 `SessionSearchHit` / `SessionSearchResponse` 类型。

注意：无标题会话 `sessions.title` 为 SQL NULL，`Type.Optional` 只接受 undefined/缺失，NULL 会打穿 `parseContract`——组装响应时必须映射 `sessionTitle ?? undefined`（同 `rowToSessionInfo` 惯例）。

### 路由参数

`/project/:projectId/chat/:sessionId?messageId=<seq>`（seq 为 event seq 数字）

## 各层实现

### core

**`packages/core/src/session/search.ts`（新增，纯函数）**

- `extractSearchableText(content: unknown): string`：content 为 string 直接返回；为 block 数组时拼接 `type === "text"` 的 `text` 字段（`\n` 连接）
- `matchMessageData(query: string, dataJson: string): { role: "user" | "assistant"; snippet: string } | null`：解析 `data.message`，抽取文本，lower-case 子串匹配；命中则以匹配位置为中心截取约 100 字符 snippet（空白折叠为空格，越界加省略号）；未命中返回 null

**`packages/core/src/store/session.ts`（SessionStore 扩展）**

```ts
searchMessages(query: string, limit: number): MessageSearchHit[]
```

1. SQL 预取（LIKE 转义 `%`/`_`/`\`，`ESCAPE '\'`）：

```sql
SELECT e.session_id, e.seq, e.type, e.data, e.time, s.title AS session_title
FROM events e JOIN sessions s ON s.id = e.session_id
WHERE e.type IN ('user/message','assistant/message')
  AND s.status = 'active'
  AND e.data LIKE ? ESCAPE '\'
ORDER BY e.time DESC
LIMIT ?
```

2. JS 二段：逐行 `matchMessageData` 过滤并生成 snippet
3. 废弃过滤：对有命中的 sessionId 查 `type IN ('turn/retried','turn/withdrawn')` 的 events（构造最小 SessionEvent 后复用 `collectAbandonedSeqs`），剔除 abandoned seq 的命中
4. 返回 `{ sessionId, sessionTitle, seq, role, snippet, time }[]`（按 time 倒序）

**`packages/core/src/project-manager.ts`**

```ts
searchProjectMessages(query: string, limit: number): MessageSearchHit[]
```

遍历 `projectStore.agents`（跳过 `sessionNeedsMigration` 无关——该方法只查 events 表，legacy session 天然无 events 命中），各 store 调 `searchMessages`（预取上限 400），合并、按 time 倒序、附 `agentId`、截断到 limit。

### contracts

`sessions.ts` 加 schema（见上），`index.ts` 加类型导出。

### server

`packages/server/src/routes/sessions.ts` 加 `GET /api/projects/:projectId/sessions/search`：q trim / limit clamp → `projectManager.searchProjectMessages` → `parseContract`。

### app

**`lib/api.ts`**：`searchSessions(q: string, limit?: number): Promise<SessionSearchResponse>`。

**`stores/app-ui-store.ts`**：`globalSearchOpen: boolean`、`openGlobalSearch()`、`closeGlobalSearch()`。

**`features/global-search/`（新增 feature）**

- `GlobalSearchDialog.tsx`：Dialog（`showCloseButton={false}`，顶部居中 `sm:max-w-xl`，`max-h-[70vh]` 内滚）；受控 open = store 状态
  - Input（autoFocus）+ debounce 300ms → `debouncedQuery`
  - 聊天结果：`useQuery(sessionSearch key, enabled: q 非空)`；文件结果：`useProjectFileTree` + 本地 `fuzzyMatch`（多词 substring AND，从 `SearchFileField` 语义抽出本地实现，不去改动 SearchFileField）
  - 两组各渲染 header（`global-search.chatResults` / `fileResults`）+ 项列表；聊天组显示前 20、文件组前 10
  - 展平索引 + `activeIndex` 状态：↑↓ 移动、Enter 打开、hover 同步选中
  - 点击聊天项：`navigate(\`/project/${projectId}/chat/${sessionId}?messageId=${seq}\`)` + close；文件项：`navigate(\`/project/${projectId}/content?path=${encodeURIComponent(path)}\`)` + close
  - 状态：加载中 / 无结果 / 空输入初始提示，均走 i18n
- `queries/keys.ts`：加 `sessionSearch: (projectId, q) => [...]`

**`features/project-panel/index.tsx`**：aside 包 ContextMenu（render prop），菜单单项「搜索」→ `openGlobalSearch()`，`ContextMenuShortcut` 显示 `⌘P` / `Ctrl P`（按 `navigator.platform` 判定）。

**`layouts/ProjectScope.tsx`**：keydown 注册 Cmd/Ctrl+P → `openGlobalSearch()`；卸载 cleanup `closeGlobalSearch()`；渲染 `{globalSearchOpen && <GlobalSearchDialog />}`。

**聊天定位**

- `pages/ChatPage.tsx`：`searchParams.get("messageId")` → `locateSeq = Number(messageId)`（NaN → null）传给 `Chat`；`onLocated` 回调 `setSearchParams` 删除 messageId（replace）
- `features/chat/index.tsx`：接收 `locateSeq` / `onLocated`，接入新 hook
- `features/chat/hooks/useLocateMessage.ts`（新增）：
  - 输入：`{ containerRef, client, sessionId, agentId, locateSeq, onLocated }`
  - 从 `useChatSessionStore` 订阅 entries / hasMore / oldestSeq / loadingMore / history.status / history.error
  - effect 1（未定位且目标更早）：`hasMore && !loadingMore && oldestSeq != null && oldestSeq > locateSeq` → `loadMore`
  - effect 2（覆盖检测）：entries 含 `seq === locateSeq` → 双 rAF 后 `container.querySelector(\`[data-entry-seq="${locateSeq}"]\`)` → `scrollIntoView({ block: "center" })` + 高亮 class（2s 移除）→ `onLocated()`
  - effect 3（放弃，满足其一即 `onLocated()` 清参）：
    - `history.status === "ready" && !hasMore` 且仍无目标 seq（历史耗尽）
    - `oldestSeq != null && locateSeq >= oldestSeq` 且 entries 无目标 seq（目标本应落在已加载区间却不存在——搜索快照后该消息被 live 撤销删除等场景）
    - `history.error`（历史加载失败，避免悬挂）
  - `locateSeq` 变化时重置「已定位」标记
  - 已知边界：目标会话正在流式输出时 `useChatScroll` 的「新用户消息置底」分支可能在定位后抢占视口，概率低，v1 接受
- `UserBubble` / `AssistantBubble`：新增可选 `entrySeq?: number` prop，根元素输出 `data-entry-seq={entrySeq}`；`MessageList` 的 `renderUser` / `renderBubble` 传入（bubble 从 `entryId` 解析 `/^e(\d+)$/`）
- `lib/route-params.ts`（新增）：`stripMessageId(pathname, search)` 剥离定位参数；`use-project-navigation.ts` 记录栈 key、`ProjectScope` 记录 lastRoute 两处统一使用

### i18n（en / zh-CN / zh-TW）

```
global-search.placeholder      搜索聊天与文件… / Search chats & files…
global-search.search           搜索 / Search
global-search.chatResults      聊天 / Chats
global-search.fileResults      文件 / Files
global-search.noResults        没有找到结果 / No results
global-search.searching        搜索中… / Searching…
global-search.initialHint      输入关键词搜索当前项目的聊天记录与文件名 / …
```

无标题会话 fallback 复用 `agent-session-list` 既有 fallback 逻辑（时间串），抽共享或重复实现以现状最小改动为准。

## 测试

| 层 | 测试 | 要点 |
|---|---|---|
| core | `src/__tests__/session-search.test.ts` | 纯函数：文本抽取（string / blocks / 混合）、snippet 边界、LIKE 转义字符（`%` `_` `\`）、大小写 |
| core | `src/__tests__/store/session-search.test.ts`（或并入现有 store 测试） | SessionStore：命中 user/assistant 不命中 tool/result；abandoned（withdrawn/retried）命中被剔除；archived session 不命中；跨 session 按 time 倒序；limit 截断；ProjectManager 合并多 agent |
| server | `src/__tests__/sessions-search.test.ts` | 路由契约：q 传递与 trim、limit clamp、空 q 空结果、响应 schema 校验（mock projectManager，模式同 `sessions-project-list.test.ts`） |
| app | bubble 锚点：`data-entry-seq` 渲染；`useLocateMessage` 的覆盖判定与放弃分支（mock store）；搜索弹窗分组渲染与键盘选择（轻量） |

## 不做 / 已知边界

- 搜索结果中高亮命中词（v2）
- tool 调用参数/结果搜索（v2，可加开关）
- legacy 会话（未迁移 messages 表）搜索
- FTS5 / 拼音 / 模糊拼音匹配
- 文件内容搜索（已有 agent 工具 `search_content`，用户侧暂无入口）
- LIKE 预取已知漏召回边界：查询词含 `"` / `\` / 换行等会被 JSON 转义的字符时，LIKE 匹配不到落库的转义文本，JS 二段无法捞回（中文不受影响）
- 预取上限（每 agent 400 行）发生在 JS 过滤之前：查询词恰为 `text`/`type`/`role` 等 JSON 结构词时上限可能被结构命中耗尽，表现为「无结果」而非截断
- 流式会话中定位可能被「新用户消息置底」滚动抢占（见 useLocateMessage 已知边界）
- 桌面 Safari 的 Cmd+P preventDefault 行为未验证（主力平台为 Electron/Chromium，移动 PWA 无影响）

## review 记录

2026-09-26 sub agent review：无 critical。important 3 项已落入设计（返回栈剥离 messageId、useLocateMessage 放弃分支补全、sessionTitle NULL→undefined 映射）；medium/minor 中 sr-only DialogTitle、`userAgentData.platform` 判定平台已采纳，其余以「已知边界」标注。
