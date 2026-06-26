# 实施计划 — 体验优化 Round 2

- 关联 design：`docs/dev/features/2026-06-25-experience-optimization-round2/design.md`
- 模式：subagent-driven（每 task 独立交付 + 验证）

## Task 概览与依赖

```
Task 1 (agent UI + i18n)  ─┐
Task 2 (lastRoute)         ├── 三者可并行
Task 3 (chat 分页后端)     ─┘
                            │
Task 4 (chat 分页前端) ◄── ┘  依赖 Task 3
```

---

## Task 1 — 侧栏 agent 入口与权限 UI（Changes 1 + 2 + 3）

> 三项变更共享 i18n locale 文件与 agent-session-list feature 目录，合并为一个 task 避免 file conflict。

### 改动文件
| 文件 | 改动 |
|------|------|
| `packages/i18n/src/locales/zh-CN.ts` | 改名 9 key（搭档→角色）；`toolsLabel`→权限；`tool.load_skill`→使用技能；新增 `agent-dialog.permRead`/`permWrite`；删除 7 个归并 tool.* key |
| `packages/i18n/src/locales/en.ts` | 同上（en 值） |
| `packages/i18n/src/locales/zh-TW.ts` | 同上（zh-TW 值） |
| `packages/app/src/lib/tool-registry.ts` | 新增分组元数据结构（`PERMISSION_GROUPS`：读取文件 = `[read_file, list_files, search_content]`，写入文件 = `[write_file, edit_file, move_file, copy_file]`）；导出分组 + 独立工具列表；`ALL_TOOLS`/`ALL_TOOL_IDS` 保留 |
| `packages/app/src/features/agent-session-list/AgentDialog.tsx` | `ToolPicker` 改为渲染 2 分组 + 4 独立项；分组 toggle 绑定多 id；`toggleTool` 适配分组语义 |
| `packages/app/src/features/agent-session-list/index.tsx` | `SidebarGroupAction` 的 `PlusIcon` 包进 `DropdownMenu`（`DropdownMenuTrigger render={...}` 复用 SidebarGroupAction 外观）；菜单项「创建角色」→ `setDialog({kind:"create-agent"})` |

### 实施顺序
1. **i18n 先行**：三个 locale 文件一次性完成所有改动（改名 + 文案 + 新增 permRead/permWrite + 删 7 key）。先 grep 确认 7 个待删 key 无 i18n 以外的消费方。
2. **tool-registry 重构**：新增 `PERMISSION_GROUPS` 常量 + derived `INDEPENDENT_TOOLS`；从 `ALL_TOOLS` 的 grouped 成员移除 label 引用（保留 id 供存储）。
3. **AgentDialog ToolPicker**：按分组结构渲染；分组 chip 选中态 = 全部成员 id ∈ `formData.tools`；toggle 分组 = 批量 add/remove 成员 id。
4. **index.tsx 下拉菜单**：参考 `DebugMenu.tsx` 的 DropdownMenu 模式；trigger 用 `DropdownMenuTrigger render={<SidebarGroupAction .../>}`。

### 分组交互规则（实现细节）
- 分组 chip 选中态：全部成员 id 都在 `formData.tools` 中 → 选中；否则 → 未选中（无半选态）。
- 点击未选中分组 → `formData.tools` 加入全部成员 id。
- 点击已选中分组 → 移除全部成员 id。
- 独立项行为不变。

### 验证
```bash
npm run lint --workspace=packages/app
npm run lint --workspace=packages/i18n
npm run verify   # i18n check 确保三 locale key 对齐
```
手动验证：打开 agent dialog → 权限区显示 2 分组 + 4 独立 chip；切换分组 chip → 3/4 个底层 tool 同步切换；侧栏「+」按钮点击 → 下拉菜单出现「创建角色」。

---

## Task 2 — lastRoute 迁移 localStorage + 关闭清理（Change 4）

> 与 Task 1/3 文件零重叠，可完全并行。

### 改动文件
| 文件 | 改动 |
|------|------|
| `packages/app/src/stores/last-route-storage.ts` | **新建**：`getLastRoute`/`setLastRoute`/`clearLastRoute`；key = `spherse:last-route:<projectId>`；`typeof localStorage === "undefined"` 守卫 |
| `packages/app/src/stores/app-store.ts` | `setProjectLastRoute`：改写 localStorage 而非 IPC；`restoreProjects`：从 `getLastRoute(id)` 回填 `lastRoute`；移除对 `window.electronAPI.setProjectLastRoute` 的调用 |
| `packages/app/src/App.tsx` | `handleCloseProject`：新增 `clearLastRoute(projectId)` 调用（与现有 `clear*` 并列） |
| `packages/app/electron/ipc/project.ts` | 删 `set-project-last-route` handler（68-70）；`restore-projects` 返回结构移除 `lastRoute`（39, 43） |
| `packages/app/electron/settings.ts` | 删 `updateProjectLastRoute`（170-177）；`OpenProjectEntry` 移除 `lastRoute?` 字段（6-12） |
| `packages/app/shared/electron-api.ts` | 删 `setProjectLastRoute` 方法（38） |
| `packages/app/electron/preload.ts` | 删 `set-project-last-route` invoke（27-28） |
| `packages/app/src/stores/app-store.test.ts` | 更新 stub：断言 lastRoute 走 localStorage 而非 IPC；新增关闭项目后 localStorage key 被清除的 case |

### 验证
```bash
npm run lint --workspace=packages/app
npm test --workspace=packages/app -- app-store
```
手动验证：进项目 → 导航到 content 页 → 刷新应用 → 恢复后停在 content 页（localStorage 生效）；关闭项目 → DevTools Application → `spherse:last-route:<id>` key 不存在。

---

## Task 3 — 聊天分页后端（Change 5: core + server）

> 与 Task 1/2 文件零重叠，可完全并行。Task 4 依赖本 task。

### 改动文件
| 文件 | 改动 |
|------|------|
| `packages/core/src/store/session.ts` | 新增 `getRecentTurns(sessionId, turns, beforeId?)`：一次性取 `id < beforeId`（或全部）的倒序行 → JS 层按 turn 边界（`role==="user"` 开启新 turn）切片取满 `turns` 个 → 反转 ASC → `{messages, hasMore}`。保留 `getSessionMessages` 原样给 runtime |
| `packages/core/src/store/session.test.ts` | 新增单测：turn 边界正确、cursor（beforeId）正确、空会话、turns 多于实际 turn 数、hasMore 边界 |
| `packages/core/src/project-manager.ts` | 新增 `getRecentSessionHistory(agentId, sessionId, turns, beforeId?)` 转调 store |
| `packages/server/src/contracts/sessions.ts` | 新增 `sessionMessagesPageResponse = Type.Object({ messages: Type.Array(Type.Unknown()), hasMore: Type.Boolean() })`；保留原 `sessionMessagesResponse` |
| `packages/server/src/routes/sessions.ts` | `GET .../sessions/:id/messages`：读 `?turns` + `?before` query params；无 params → 全量裸数组（向后兼容）；有 params → 调 `getRecentSessionHistory` 返回 `{messages, hasMore}` 信封 |

### getRecentTurns 实现要点
- 首次调用（`beforeId` 缺省）：`SELECT MAX(id) FROM messages WHERE session_id=?` 取起点。
- 取数：`SELECT * FROM messages WHERE session_id=? AND id < ? ORDER BY id DESC`，**全量取出** beforeId 之前的所有行（不加 LIMIT——agent loop 保证 10 turn 数据量有界）。
- turn 切片：倒序遍历，遇到 `role==="user"` 开新 turn，收满 `turns` 个 turn 后截断。
- `hasMore` = 截断后仍有剩余行。
- 返回前反转为 ASC。

### 验证
```bash
npm run lint --workspace=packages/core
npm run lint --workspace=packages/server
npm test --workspace=packages/core    # session store 单测
npm test --workspace=packages/server  # contract 测试
```

---

## Task 4 — 聊天分页前端（Change 5: app/renderer）

> 依赖 Task 3（需要 core `getRecentTurns` + server 分页 endpoint 就绪）。

### 改动文件
| 文件 | 改动 |
|------|------|
| `packages/app/src/lib/api.ts` | 新增 `getSessionMessagesPage(agentId, sessionId, { turns, before })` → 调 `?turns=&before=` → 返回 `{messages, hasMore}`。保留原 `getSessionMessages` 不变 |
| `packages/app/src/features/chat/streaming-store.ts` | attach 时改调 `getSessionMessagesPage(agentId, sessionId, { turns: 10 })`；session 状态新增 `hasMore`/`oldestLoadedId`/`loadingMore`；新增 `loadMore(sessionId)` action：调分页接口（`before: oldestLoadedId`）→ prepend 结果到 `messages`（`mergeHistoryMessages` 已支持 history 在前）→ 更新 `oldestLoadedId`/`hasMore` |
| `packages/app/src/features/chat/MessageList.tsx` | 顶部渲染「加载更多」按钮：`hasMore && !loadingMore` 时显示；点击 → `loadMore`；`loadingMore` 时显示 loading 态 |
| `packages/app/src/features/chat/hooks/useChatScroll.ts` | prepend 时保持 scroll 锚点：prepend 前记录 `scrollHeight`，prepend 后 `scrollTop += (newScrollHeight - oldScrollHeight)` |

### prepend scroll 锚点实现要点
- 在 `loadMore` 触发前（或 messages 变化的 effect 中），记录容器 `scrollHeight`。
- 新 messages prepend 后（`useEffect` 依赖 messages 长度变化 + 一个 `isPrepending` flag），读新 `scrollHeight`，差值加回 `scrollTop`。
- 非 prepend 的 messages 变化（流式新消息）不受影响——仍走现有 auto-scroll-to-bottom 逻辑。

### 边界处理
- 新会话（无历史）：`messages=[]`, `hasMore=false` → 不显示按钮。
- 全部加载完：`hasMore=false` → 隐藏按钮。
- 流式新消息：走 WS 事件链 append 末尾，不影响分页状态（`oldestLoadedId`/`hasMore`）。

### 验证
```bash
npm run lint --workspace=packages/app
```
手动验证：打开有 >10 turn 历史的会话 → 首屏只显示最新 10 turn + 顶部「加载更多」；点击加载更多 → prepend 旧 turn 且 scroll 位置不跳；新消息流式到达 → append 到底部分页状态不变。

---

## 执行顺序建议

1. **并行启动** Task 1 + Task 2 + Task 3（三者文件零重叠）
2. Task 3 完成后启动 **Task 4**
3. 全部完成后跑 `npm run verify` + 选择性 E2E（chat spec + file-tree spec）
