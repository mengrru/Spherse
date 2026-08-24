# Trigger 复用会话"僵尸绑定"问题分析与修复

## 现象

同一 agent 上两个 `reusable_session` 模式的 trigger 同时触发（一个事件触发、一个 cron 触发），一个 trigger 正常执行并生成了可见 session，另一个"执行到一半停止"、session 列表里看不到对应会话，且 trigger log 显示 `success`。

## 排查结论（基于真实数据）

对出问题的项目数据库（`sessions.db`）与 `triggers/index.yml`、`triggers/logs.jsonl` 的分析：

1. 两个并发 run 都完整执行到了 `turn/end`，事件序列完整，trigger log 全部为 `success`，无 failed 记录——"执行到一半停止"是错觉。
2. "消失"的 session（`1f8de448-...`）在 `sessions` 表中状态为 `archived`。它在第一轮执行成功后曾在 UI 中被用户删除（删除即归档，`ProjectManager.deleteSession` → `SessionStore.archiveSession`）。
3. 删除会话不会清理 trigger 的 `boundSessionId`（僵尸绑定）。
4. `SessionManager.sessionExists` 的 SQLite 回落查询不过滤 `status`，归档会话被判定为"存在"，于是 executor 走 restore 分支继续往一个 UI 永远不显示（`listSessions` 只查 `active`）的会话里写消息。

即：任务真实在跑、交付物真实在写，只是全部发生在不可见的归档会话里。

## 暴露的缺陷

1. **`sessionExists` 不过滤归档状态**（`packages/core/src/session/session-manager.ts`）：`getSession` 返回任意状态的行，归档会话被当作可复用。
2. **trigger 成败判定不可靠**（`packages/core/src/trigger/executor.ts`）：
   - 只凭收到 `agent_end` 事件记 `success`。LLM 流中途失败时错误以 assistant 消息 `stopReason: "error"` 落进事件流，`prompt()` 正常 resolve、`agent_end` 照发，导致误报 success。
   - `emit("trigger_triggered")` 位于 try 块之外，listener 抛错时 promise 未处理拒绝、`finally` 不执行、`inProgress` 永不清除，该 trigger 在进程重启前永远无法再次触发。

## 修复方案

1. `SessionManager.sessionExists`：回落查询结果要求 `status === "active"`。这是核心自愈机制——`reusable_session` 归档绑定在下一次触发时判定失效，走"新建会话 + 重新绑定"既有路径。刻意**不做**删除会话时的显式解绑（`deleteSession` 不触碰 trigger 存储）：避免 `ProjectRuntime` 对 trigger capability 的耦合与多余写入路径，绑定留在磁盘上由运行时惰性治愈；UI 侧 trigger 表单短暂显示失效绑定 ID 属可接受代价。
2. `TriggerExecutor.fire` 的 `existing_session` 分支：restore 前用 `sessionExists` 校验 `targetSessionId`，目标不存在或已归档时抛错（进 catch 记 failed log + `trigger_failed`），不执行、不新建——堵住与 `reusable_session` 同构的归档目标僵尸路径。
3. `TriggerExecutor.fire`：
   - `emit("trigger_triggered")` 移入 try 块。
   - 在 `agent_end` 回调中按 `persistMiddleware` 同款逻辑检查最后一条 assistant 消息的 `stopReason`，`error` / `aborted` 视为本次执行失败，记 failed log（含 sessionId）并发 `trigger_failed`。

## 影响面

- core：`session-manager.ts`、`trigger/executor.ts`
- server/app：无接口变更；`existing_session` 目标失效时 trigger 面板可见 failed 日志，`reusable_session` 失效绑定在下一次触发时自动重绑
