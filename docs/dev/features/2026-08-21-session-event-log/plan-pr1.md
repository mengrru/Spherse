# 实施计划 PR1：事件日志存储替换（行为不变）

- 设计：同目录 `design.md`
- 状态：已在 `feat/session-event-log` 实现
- 目标：新会话落 events 表，fold 重建，retry/compaction 换事件落点；legacy 会话在首次可写 restore 时自动迁移；**用户可见行为与迁移前一致**（新会话对话、恢复、retry、compaction、分页全链路不变）
- 提交策略：任务分组提交，每组结束 `npm run verify`；合并前 `verify:e2e`

## 任务 1 事件词汇表 + SessionEventLog

- 新建 `packages/core/src/session/events.ts`：`SessionEvent` 信封、`SessionEventMap`（PR1 的 7 个事件，`branch/created`/`message/recalled` 留到 PR2）、`MESSAGE_EVENT_TYPES`；版本记录在 events 表的 `schema_version` 列
- 新建 `packages/core/src/session/event-log.ts`：`SessionEventLog` 类——内存 events 数组 + `append`/`appendBatch`（内存追加 → 同步事务写入 → 失败回滚内存 → 提交后通知订阅者，listener 异常静默隔离）、`events` 只读视图、`subscribe(listener): () => void`
- 测试 `event-log.test.ts`：append 顺序/seq 连续性、非法 seq 拒绝、subscribe 容错与退订

## 任务 2 store 层 events 表

- `packages/core/src/store/session.ts`：
  - events 表 DDL：`(session_id, seq)` 联合主键 + `type` + `data`(JSON) + `time` + `schema_version`
  - sessions 表加列：`parent_session_id`、`fork_seq`、`migrated_at`（PR1 先加列占位，PR2 消费）
  - `readEvents(sessionId)` / `appendEvents(sessionId, events)`（单事务批量）/ `maxSeq(sessionId)`
  - **删除** messages/compactions 表的写方法（`appendMessage`/`deleteMessage`/`recordCompaction`）；保留全部读方法（`getSessionMessages*`/`getMessagesAfter`/`getRecentTurns`/`getLatestCompaction`）供 legacy 读路径与迁移
- 测试：events 读写往返、seq 主键冲突拒绝、legacy 读方法不受影响

## 任务 3 fold + repair（纯函数）

- 新建 `packages/core/src/session/fold.ts`：
  - `deriveMessages(events): AgentMessage[]`——重启点投影（compaction/applied → digest + anchor 之后并跳过 excludedSeqs；turn/retried → 跳过 abandonedSeqs）与消息事件投影；父日志解析留到 PR2
  - `repairLog(events): SessionEvent[]`——open turn 检测 + 尾部未应答 toolCall 合成 `tool/result`(isError) + `turn/end {reason: "aborted"}`；无 turn 事件的日志返回空
- `synthesizeInterruptedToolResults` 逻辑并入 `repairLog` 后从 `compactor.ts` 删除
- 测试 `fold.test.ts`：确定性随机合法事件序列的 fold 投影、compaction/retry 行为，以及 repair 的合成/不动/幂等场景；PR1 未实现增量缓存，repair 测试与 fold 测试同文件

## 任务 4 AgentRunner 改造

- `agent-runner.ts`：
  - 持有 `SessionEventLog` 替代 `MessageLog`；`syncBufferFromLog` 用 `deriveMessages(events)` 重建 pi buffer
  - `sendMessage`：原子追加 `user/message` + `turn/start` 后调用 `prompt()`；persist middleware 改为事件翻译（message_end/toolResult/run 结束 → append 对应事件）
  - `retryLastTurn`：改为 `append turn/retried {abandonedSeqs}`（守卫条件不变：尾部 assistant `stopReason === "error"`）
  - `initForRestore`：readEvents → repair（合成事件经 append 持久化）→ fold → initialLog 赋值；**未迁移会话抛 `MigrationRequiredError`**（新错误类型，errors.ts）
  - `createSession`（经 SessionManager）：创建后即写 log（空 events）
- compaction capability（`capabilities/compaction/transform.ts`）：`maybeCompactLog` 落点改为 `append compaction/applied {anchorSeq, digestContent, excludedSeqs}`，保留 `sanitizeToolCallPairs` 的 tail 净化语义；`planCompaction` 计划逻辑与 token 水位不动；compactor.ts（logFromRows/logFromCompaction）删除
- kernel `message-log.ts`：随 MessageLog 退役删除（确认无其它消费者后）
- 测试：agent-runner.test.ts 全面改写——restore 后连续两轮、abort 后 restore（repair 生效）、retry 后 restore（abandonedSeqs 生效）、compaction 后 restore（锚点生效）、重复 compaction 不过度包含（对齐原有用例语义）

## 任务 5 迁移原语 + restore 边界

- 新建 `packages/core/src/session/legacy-migrate.ts`：`migrateLegacySession(agentStore, sessionId)`——先跑旧路径修复（孤儿 toolCall 合成，复用 repair 的消息级逻辑）→ messages 行转消息事件 + 最新 compaction → compaction/applied → 单事务 appendEvents + `migrated_at` → 幂等 no-op
- `session-manager.ts`：`restoreSession` 在构造可写 Runner 前统一执行幂等 legacy 迁移
- `project-manager.ts`：`getSessionHistory`/`getRecentSessionHistory` 对 events 会话走事件投影（seq 窗口），迁移前 legacy 会话走旧读路径
- 测试 `legacy-migrate.test.ts`：转换正确性、幂等、迁移后 fold == 旧全量重放、含 compaction 锚点、含孤儿 toolCall 的旧会话迁移后配对完整

## 任务 6 server 对齐

- contracts：迁移保持 core 内部实现，不新增 server endpoint、session 状态字段或 ApiClient 方法
- `MigrationRequiredError` 仅作为 core 内部防御错误，不导出或映射到 HTTP/WS 契约；生产 restore 路径会先自动迁移
- 测试：session contract 与 legacy 历史读；迁移不增加 endpoint、409 错误或客户端状态

## 任务 7 E2E 与文档

- E2E：chat 基本流程、恢复、retry、断线重连属于受影响场景；本分支尚未新增 event-log 专项 E2E，合并前需按影响面补跑
- 文档：`docs/official/data-conventions.md`（events 表结构、legacy 只读语义）、`docs/official/architecture.md`（event log 替代 message snapshot 一段）、backlog 更新
- `npm run verify` + 受影响面 E2E（chat/session）+ 合并前 `verify:e2e`

## 验收标准

- 新会话全链路（创建/对话/恢复/retry/compaction/分页/删除）行为不变，DB 中只有 events 表在写入
- 旧会话：迁移前历史可读，首次打开聊天、静默发送或 trigger 复用时自动迁移并继续执行
- `synthesizeInterruptedToolResults`、`logFromRows`、`logFromCompaction`、`recordCompaction`、messages 表写路径全部删除
- 性质测试「restore fold == 活跃态镜像」通过
