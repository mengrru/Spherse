# 体验优化 Round 3 — 实施计划

- 日期：2026-06-29
- 状态：Draft
- 关联设计：`docs/dev/features/2026-06-29-experience-optimization-round3/design.md`

## 总览

7 项变更（Change 3「打断提示」与 Change 4「自动滚动重写」已移出本轮）。按「文件冲突域 + 依赖」拆分为 7 个 task（Task 0-6），分 4 个 Phase 执行。核心约束：
- **i18n 集中前置**（Task 0）：多个变更都改 `packages/i18n/src/locales/*.ts` 单文件，并行会冲突，故一次性完成所有 key 变更。
- **Chat 渲染层合并**（Task 6）：Change 1/2 共享 `types.ts` / `chat-session-reducer.ts` / `streaming-store.ts` / `MessageList.tsx` / `MessageItem.tsx`，必须由**单个 agent 串行**完成，不可拆分并行。

### 任务依赖图

```
Phase 0:  [Task 0: i18n keys]                          （前置，阻塞所有需 i18n 的 task）
              │
Phase 1:  [Task 1: z-index] [Task 2: 主题清除] [Task 3: 返回键]   （3 个独立，可并行，不碰 i18n/chat）
              │
Phase 2:  [Task 4: finder 打开] [Task 5: session 分页]            （2 个独立，可并行）
              │
Phase 3:  [Task 6: chat 渲染层 C1+C2]                              （单 agent 串行）
```

> Task 1/2/3 实际上连 i18n 都不依赖，可和 Task 0 并行。但为简化调度，统一 Phase 0 先行。

---

## 通用约定（每个 task 执行后必做）

1. **lint**：`npm run lint`（不通过则 `npm run lint:fix` 后复查）
2. **相关测试**：按 task 标注的测试命令运行
3. **不提交**：本计划不包含 commit；全部完成后由用户统一决定

---

## Phase 0 — i18n key 变更（前置，阻塞）

### Task 0: 批量新增/删除 i18n key

**变更**：Change 5 / 6 的文案。
**依赖**：无。
**文件冲突域**：仅 `packages/i18n/src/locales/*.ts`（3 个 locale 文件）。

**步骤**：
1. 在三套 locale（`zh-CN.ts` 基准、`en.ts`、`zh-TW.ts`）中：
   - **新增** `agent-session-list.loadMore`：zh-CN `加载更多` / en `Load more` / zh-TW `載入更多`
   - **删除** `activity-bar.revealInFinder`
   - **新增** `activity-bar.openProjectFolder`：zh-CN `打开项目文件夹` / en `Open Project Folder` / zh-TW `開啟專案資料夾`
2. 保持 key 在各自文件中的逻辑分组位置（`chat.*` 放 chat 区，`agent-session-list.*` 放该区，`activity-bar.*` 放 activity-bar 区）。
3. `zh-CN.ts` 的每条文案需带注释说明出现位置（AGENTS.md i18n 规范）。

**完成标准**：
- `npm run build --workspace=packages/i18n` 成功
- `npm run verify` 的 i18n check 通过（三套 locale key 对齐）

---

## Phase 1 — 独立 bugfix（3 个可并行，不碰 i18n/chat）

### Task 1: Change 7 — floating chat z-index 提升至 z-50

**依赖**：无。
**文件冲突域**：`packages/app/src/features/floating-chat/FloatingChatFrame.tsx`。

**步骤**：
1. `FloatingChatFrame.tsx:64`：`z-40` → `z-50`（根 div 的 className）。

**完成标准**：
- lint 通过
- 手动验证：浮窗拖到左侧 activity bar 区域不被遮挡；右键 activity bar 的 context menu 不被浮窗遮挡（若实测 context menu 被遮挡，记录现象，由人工决定是否调 overlay z-index）

---

### Task 2: Change 8 — 关闭项目时清除自定义主题

**依赖**：无。
**文件冲突域**：`packages/app/src/hooks/useCustomTheme.ts`。

**步骤**：
1. `useCustomTheme.ts:7-21`：把「移除旧 link」逻辑（现 `:10-11`）移到早退守卫（`:8`）**之前**：
   ```ts
   useEffect(() => {
     const existingLink = document.getElementById("custom-theme-link");
     if (existingLink) existingLink.remove();
     if (!projectRoot || !baseUrl || !projectId) return;
     // ... 创建并 append 新 link（原 :13-20 逻辑不变）
   }, [projectRoot, baseUrl, projectId]);
   ```

**完成标准**：
- lint 通过
- 手动验证：打开有自定义主题的项目 → 关闭项目 → 检查 `<head>` 中 `custom-theme-link` 已移除（欢迎页不再残留上个项目主题）

---

### Task 3: Change 9 — content browser 返回键回到上一页

**依赖**：无。
**文件冲突域**：`packages/app/src/lib/use-project-navigation.ts`。
**测试**：`npm test --workspace=packages/app`（若该 hook 无现成测试文件，新增 `use-project-navigation.test.ts`）。

**步骤**：
1. `use-project-navigation.ts:18-39`：把 history 栈从「只记 pathname」改为「记完整 location key（pathname + search）」：
   - 引入 `const key = location.pathname + location.search;`
   - effect（`:18-28`）的依赖数组与比较值改用 `key`（`stack[last] !== key` 时 push `key`）。
   - `back`（`:30-39`）：`stack.pop()` 后 `prev` 即完整 key，`navigate(prev)`；保留「prev 不在项目内则回退首页」兜底。
2. 新增单测覆盖：
   - 同 pathname 不同 search 的连续导航（`?path=A` → `?path=B`）→ back 回到 `?path=A`
   - 首次进入 back 回退首页（栈仅 1 条）

**完成标准**：
- lint 通过
- 新增/更新的 app 测试通过
- 手动验证：在 content browser 内打开文件 A → 打开文件 B → 点返回 → 回到文件 A（而非首页）

---

## Phase 2 — 独立 feature（2 个可并行）

### Task 4: Change 6 — 右键 avatar 改为「打开项目文件夹」

**依赖**：Task 0（i18n key 已就位）。
**文件冲突域**：`packages/app/electron/ipc/project.ts`、`packages/app/src/features/activity-bar/index.tsx`、`packages/app/src/stores/app-store.ts`。

**步骤**：
1. `electron/ipc/project.ts:63-65`：`shell.showItemInFolder(projectPath)` → `shell.openPath(projectPath)`。
2. `features/activity-bar/index.tsx:107-109`：i18n key `activity-bar.revealInFinder` → `activity-bar.openProjectFolder`。
3. `stores/app-store.ts:150-154`：action 名 `revealProject` → `openProjectFolder`（含 `shared/electron-api.ts:42` 的方法名 `revealInFinder` → `openProjectFolder`，及 `electron/preload.ts:22-23` 的 channel 名）。同步更新 `App.tsx` 中 `onReveal={revealProject}` 的引用（`:109` 附近）。
   - IPC channel 名 `reveal-in-finder` → `open-project-folder`，三处（ipc handler / preload / shared 类型）同步。

**完成标准**：
- lint 通过
- 手动验证：右键项目 avatar → 点「打开项目文件夹」→ 系统文件管理器打开该项目文件夹窗口（而非选中文件夹）

---

### Task 5: Change 5 — session list 分页加载（每 agent 10 条）

**依赖**：Task 0（i18n key 已就位）。
**文件冲突域**：`packages/core/src/store/session.ts`、`packages/core/src/project-manager.ts`、`packages/server/src/contracts/sessions.ts`、`packages/server/src/routes/sessions.ts`、`packages/app/src/lib/api.ts`、`packages/app/src/stores/project-data-store.ts`、`packages/app/src/features/agent-session-list/AgentGroup.tsx`。
**测试**：`npm test --workspace=packages/core`、`npm test --workspace=packages/server`、`npm test --workspace=packages/app`。

**步骤**：

**Core 层**：
1. `session.ts:76-91`：`listSessions` 的 SQL `ORDER BY` 加 `, id DESC`（tiebreaker，保证现有全量查询也确定性）。
2. 新增 `listSessionsPage(agentId, limit, offset): { items: SessionRow[]; hasMore: boolean }`：
   - SQL `SELECT * FROM sessions WHERE agent_id = ? AND status = 'active' ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`，limit 取 `limit + 1` 判断 hasMore（返回 > limit 则 hasMore=true，截断到 limit）。
3. `project-manager.ts:87-91`：新增 `listSessionsPage(agentId, limit, offset)` 透传。
4. `session.test.ts`：新增分页单测（limit/offset/hasMore/tiebreaker 不跳行）。

**Server 层**：
5. `contracts/sessions.ts`：新增 `sessionListPageResponse = Type.Object({ items: Type.Array(sessionInfo), hasMore: Type.Boolean() })`，保留原 `sessionListResponse`（裸数组）。
6. `routes/sessions.ts:7-15`：`GET /sessions` 接受可选 query `?limit=<n>&offset=<n>`；无 params → 裸数组（兼容），带 params → 信封 `{ items, hasMore }`。

**App 层**：
7. `lib/api.ts:69-73`：新增 `listSessionsPage(agentId, { limit, offset }): Promise<{ items: SessionInfo[]; hasMore: boolean }>`。
8. `project-data-store.ts`：
   - state 增 `sessionPaging: Record<string, { hasMore: boolean; offset: number }>`（按 agentId）。
   - `refreshSessions`（`:111-134`）：对每个 agent 调 `listSessionsPage(agentId, { limit: 10, offset: 0 })`，扁平化 items 存 `sessions`，写入各 agent paging `{ hasMore, offset: items.length }`。
   - 新增 `loadMoreSessions(projectId, agentId)`：取 `offset = sessionPaging[agentId].offset`，append items（按 session id 去重），更新 paging。
   - `createSession`/`deleteAgent` 后的 `refreshSessions` 复用首页刷新（重置回第一页）。
9. `AgentGroup.tsx:32-39`：session 列表底部，当 `sessionPaging[agentId]?.hasMore` 为真时显示「加载更多」按钮（`t("agent-session-list.loadMore")`），点击 `loadMoreSessions`；loading 态禁用。需要从 store 读取 paging（或经由 `useGroupedSessions` 透传 hasMore）。
   - 注意：`useGroupedSessions.ts` 当前只返回 sessions Map，需扩展以暴露 per-agent paging，或 `AgentGroup` 直接从 store 读 `sessionPaging`。

**完成标准**：
- lint 通过
- core/server/app 测试全部通过
- 手动验证：agent 下超过 10 个 session 时只显示前 10 + 「加载更多」按钮，点击追加下一批

---

## Phase 3 — chat 渲染层（单 agent 串行，C1+C2+C3）

### Task 6: Change 1 + 2 — chat 时间显示 / thinking 指示器

**依赖**：无额外 i18n key（thinking 指示器纯视觉，无文案）。
**文件冲突域**：`packages/app/src/features/chat/` 下 `types.ts`、`chat-session-reducer.ts`、`streaming-store.ts`、`MessageList.tsx`、`MessageItem.tsx`、新增 `ThinkingIndicator.tsx`、新增 `lib/format-time.ts`。
**测试**：`npm test --workspace=packages/app`。

> ⚠️ 此 task 由**单个 agent 按 C1 → C2 顺序**完成，两步共享文件，不可并行。

**步骤 C1 — 时间显示**：
1. `types.ts`：`ChatMessage` 增 `timestamp?: number`。
2. `chat-session-reducer.ts`：
   - `parseHistoryMessages`：推入对象带 `timestamp: message.timestamp`。
   - `message_end` 分支：从 `event.message.timestamp`（缺省回退 `Date.now()`）写入最终化 assistant 消息。
3. `streaming-store.ts`：
   - `sendMessage`：user 消息带 `timestamp: Date.now()`。
   - `connect` 的 `ws.onopen` initialMessage 路径：user 消息带 `timestamp: Date.now()`。
4. 新增 `lib/format-time.ts`：`formatMessageTime(ts)` → 同天 `HH:mm` / 同年 `MM-DD HH:mm` / 跨年 `YYYY-MM-DD HH:mm`。
5. `MessageList.tsx`：map 时计算 `showTime`（user 每条；assistant 仅当 `index === last` 或 `messages[index+1].role === "user"`），透传给 `MessageItem`。
6. `MessageItem.tsx`：props 增 `showTime?: boolean`；时间渲染在复制按钮旁（hover 显隐）。

**步骤 C2 — thinking 指示器**：
7. 新增 `ThinkingIndicator.tsx`：只渲染 3 个弹跳圆点（`animate-bounce` + 错峰 `animationDelay`），无气泡、无 agent name、无 i18n。
8. `MessageItem.tsx`：当 `message._streaming && message.content === ""` 时在气泡内渲染 `<ThinkingIndicator />` 替代空内容。
9. `MessageList.tsx`：map 之后，`streaming && lastMessage?.role === "user"` 时渲染独立的三点（覆盖 message_start 前的等待态）。
10. `MessageItem.tsx`：闪烁光标仅在 `message._streaming && message.content`（非空）时显示。

**完成标准**：
- lint 通过
- app 测试通过（含新增 reducer 单测）
- 手动验证：
  - 发送消息后到 message_start 前显示独立三点（无气泡）
  - message_start 后空 assistant 气泡内显示三点
  - 流式中有内容的气泡末尾有闪烁光标
  - 用户消息与 turn 收尾 assistant 消息旁显示时间

---

## 最终验证（全部 task 完成后）

1. `npm run lint`（全仓库）
2. `npm run build`（所有 package）
3. `npm test --workspace=packages/core`
4. `npm test --workspace=packages/server`
5. `npm test --workspace=packages/app`
6. `npm run verify`（lint + build + unit tests + i18n check）
7. `npm run verify:e2e`（合并前；优先跑 chat / session-list / content-browser 相关 spec）
8. 手动验证清单：
   - 主题关闭清除
   - finder 打开行为
   - floating chat 层级（pinned/unpinned）
   - chat 时间显示 / thinking 指示器
   - session list 分页加载更多
   - content browser 返回上一页（项目隔离）

## 文档收尾

完成后更新：
- `docs/dev/backlog.md`：勾选对应条目
- `docs/official/`：检查是否有架构/目录变更需同步（本轮无新增 package/工具，预计无需大改）
