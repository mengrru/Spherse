# 实施计划 PR2：会话分支 + 消息撤回

- 设计：同目录 `design.md`
- 状态：待实施
- 说明：本文仅作为方向性参考，不是强制执行方案。实施前需结合 PR1 实际代码重新评审数据模型与交互语义，尤其需要重新选择物理复制 fork 或父前缀引用 fork，并验证 recall 事件在分支创建时的继承与冻结规则；评审结论可直接改写本计划
- 前置：PR1 已在 feature 分支实现（events 表 + fold + restore 自动迁移）
- 目标：在事件日志上长出分支与撤回 feature

## 任务 1 词汇表扩展 + fold 分支拼接

- `events.ts`：`branch/created {parentSessionId, forkSeq}`、`message/recalled {boundarySeq}` 入 Map；`branch/created` 加入非投影事件集
- `fold.ts`：增加父日志解析——首事件 `branch/created` → 递归取父事件数组裁剪到 `forkSeq` → 将子本地 seq `n` 映射为虚拟 `forkSeq + 1 + n` → 按重启点和投影规则处理；`message/recalled.boundarySeq` 是第一条被撤回消息，最后一次 recall 隐藏 `[boundarySeq, recallEventSeq)` 内的旧消息，但继续投影 recall 之后的新消息
- `repairLog`：open turn 扫描不跨父前缀（父前缀必然 turn 边界收尾，天然满足；补防御性断言）
- 测试：分支 fold（父前缀 + 子事件）、父后续增长不影响子、嵌套 fork（祖孙三层）、recalled 重启点、last-wins 多重启点组合

## 任务 2 core 分支/撤回原语

- `SessionEventLog`：分支构造路径仍遵守物理日志从 seq 0 开始，子 log 首事件 `branch/created` 使用本地 seq 0；虚拟 seq 仅在父子拼接投影层生成
- `SessionStore`：`createBranchedSession(agentId, parentSessionId, forkSeq)`（写 parent_session_id/fork_seq 列）；`getSessionLineage(sessionId)`（父 id/seq）
- `AgentRunner`：`initForFork(deps, agentId, parentSessionId, forkSeq)`——校验 forkSeq 是 turn 边界（指向 turn/end 或干净末尾）→ 建子 session + log → 立即可聊；`recallMessages(boundarySeq)`——对齐 turn 边界 → append → syncBuffer
- `SessionManager` / `ProjectManager`：`forkSession(agentId, sessionId, forkSeq)`、`recallMessages(agentId, sessionId, boundarySeq)`、`listLineage`
- **legacy 会话 fork**：复用 restore 边界的自动迁移语义，迁移后再 fork
- 测试：fork 后父子独立演化（父 retry/compaction 不影响子）、子 compaction 锚父前缀（anchorSeq < forkSeq）、删父（archive）后子可读可聊、recall 后继续对话、二次 recall last-wins、fork 边界校验拒绝（forkSeq 非边界抛 ValidationError）

## 任务 3 server 契约与路由

- contracts：`POST .../sessions/:id/branch`（body: `{ forkSeq }` → `{ sessionId }`）、`POST .../sessions/:id/recall`（body: `{ boundarySeq }`）；session 列表响应加 `parentSessionId`/`forkSeq`（lineage 展示）
- 路由 + WS：无新 WS 消息（分支/撤回是 HTTP 动作）；撤回后前端重拉历史（现有 history 拉取即可）
- 测试：contract 测试 + routes 单测（branch/recall、409/404/422 错误路径）

## 任务 4 前端 UI

- **撤回**：user 消息气泡菜单加「撤回到这里」→ 确认 dialog（i18n 三语）→ 调 recall → 该消息及之后消息从 UI 消失（chat-history 投影按服务端返回为准，撤回后历史直接变短）→ composer 聚焦
- **分支**：user 消息气泡 hover 菜单「从这里分支」→ 调 branch → 跳转子会话聊天页；session 列表子会话带「分支自 X」badge（lineage）；删除按钮对有子的会话提示「子分支不受影响」
- **自动迁移**：旧会话打开、静默发送或 trigger 复用时由服务端 restore 边界自动迁移，不增加前端 CTA 或迁移状态
- i18n：zh-CN 基准注释 + zh-TW/en
- 测试：chat-history 投影（撤回后隐藏）、lineage badge；结构测试按现有模式

## 任务 5 E2E + 文档

- E2E 新增 spec：`session-branch-recall.spec.ts`——对话数轮 → 从中段 fork → 两会话各自继续对话互不影响 → 原会话撤回到首轮 → 继续对话；`session-migration.spec.ts`——旧格式 DB（fixture 预置 legacy 会话）→ 打开时自动迁移 → 继续对话 → fork
- 文档：`docs/official/`（分支/撤回用户语义、迁移流程）、backlog 更新（含旧分支 `feat/core-event-log-refactor` backlog 条目改写指向本目录）
- `npm run verify` + `verify:e2e` 收尾

## 验收标准

- 从任意 user 消息处 fork 出的子会话可独立对话，父后续演化（对话/retry/compaction）不影响子
- 撤回后模型上下文从撤回点重放，会话可继续；UI 彻底隐藏被撤回内容
- 旧格式会话：首次可写 restore 自动迁移，随后可直接分支/撤回；迁移幂等
- legacy messages 表全程零写入；分支零拷贝（无消息行复制）
