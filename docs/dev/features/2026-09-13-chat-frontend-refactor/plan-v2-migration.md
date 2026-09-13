# Chat 前端消费协议 v2 实施计划

对应 [followup-v2-migration.md](./followup-v2-migration.md)。本次范围 M1–M4 + M6（M5 依赖 09-05 PR5 的 control 落库 / 快照收缩，未合入 dev，留待汇合后；遗留清理同）。每阶段测试全绿再进入下一阶段。

状态：已实施（`661f2f2` + review 修复 `4d70bda`）。

## Stage 1：model（M1 + M3）

- [x] `decode.ts` 升级为帧分类 `DecodedFrame`（event / session-ready / replay-events / replay-done / ignored）；`replay_events` 逐条解析，未知事件跳过而非整批丢弃
- [x] `agent-event-parse.ts` 将 `user_message` / `turn_retried` 映射为 live 事件（含 seq/clientId/source/triggerName）
- [x] `entry-reducer.ts` state 增加 `seqByMessageId` 绑定；live 语义升级：
  - `user_message` 落 UserEntry、按 clientId 结算乐观 entry（不使用文本兜底）、trigger 轮 live 成组
  - `turn_retried` 按 `abandonedSeqs` 移除并清绑定；`turn_withdrawn` 按 wire seq 截断（无匹配 seq 时回落 last-user 截断）
  - `message_end` seq 幂等（重放在先则丢弃 wire 侧内容）、建立 messageId→seq 绑定，非 assistant 消息也推进游标
  - `message_start` / `message_update` 命中绑定即 skip；`findReusableStreamIndex` 有 messageId 时按 `streamId` 精确匹配
  - run 级身份：`agent_start` 清空 `seqByMessageId` 与 entry `streamId`，transient entry id 冲突时分配本地唯一 id（hub 每个 run 从 `m1` 重数）
  - 游标推进：`user_message` / `message_end.seq` / `agent_end.seq` / `turn_retried` / `turn_withdrawn`
- [x] `applyPersistedEvents`：user/message、assistant/message、tool/result（含 transient 同 toolCallId 的 merge + owner 配对）、turn/withdrawn 区间、turn/retried、compaction/applied（**仅推进游标**，与用户确认的偏差）、游标推进
- [x] `dropTransientProjections`：重放完成后清除无 seq 的运行中投影（由快照重建）
- [x] `settleOptimistic` 单一实现：`findOptimisticUserIndex`——live 按 clientId 精确匹配，重放 / HTTP 首页按 unique text 兜底
- [x] 测试：decode / parseAgentEvent / live v2 / persisted / history settle

## Stage 2：runtime（M2）

- [x] `session-recovery.ts`：冷启动（无 since）直接 HTTP 对账，warm 连接等待首帧判定；首帧 `session_ready` → 重放路径（`applyPersistedEvents` → `finishReplay`），否则 legacy HTTP 对账；重放期间普通帧缓冲、重放完成后 flush；close/cancel/backoff 语义保持
- [x] `session-link.ts`：`onFrame(DecodedFrame)`、url 携带 `since`、`onOpen(since)` 把实际发送的 since 透传给 recovery
- [x] `session-lifecycle.ts`：recovery host 接线（applyPersistedEvents 前 flush 队列、finishReplay 落 dropTransient、setHistory ready）；`getSince` 要求 `history.status === "ready"` 且 `cursor >= 0`，否则继续冷对账
- [x] `session-store.ts`：暴露 `flushPending`（queue.flushNow）
- [x] 测试：recovery 两分支与顺序契约、link since 与帧路由、store 重放集成

## Stage 3：M4 多端语义验证

- [x] store 集成测试：clientId 结算（含重连时 replay text 兜底）、其他端 turn_retried 移除、trigger echo live 成组

## Stage 4：M6

- [x] reducer property：随机 (live + replay + history) 交错流 → seq 幂等、绑定一致、重放合并 == 全量重建、按 seq 截断正确；生成器覆盖 agent_start / tool/result / compaction / retry 同 id / withdraw 对拍
- [x] E2E：mock v2 server 下断线重连重放（断线期间 run 已完成 / run 进行中且 replay∩snapshot 重叠）

## Stage 5：收尾

- [x] `npm run verify`
- [x] 受影响 E2E：`chat-streaming-resilience` / `chat-retry` / `chat-withdraw` / `floating-chat` / `chat-history-render` / `ui-sdk` / `project-close` / 新增 `chat-v2-replay`
- [x] doc-sync：architecture/chat.md、glossary、backlog、followup 状态

## 遗留（待 09-05 PR5 合入）

- [ ] M5：control 落库事件消费（pending 投影按 requestId 幂等）、快照收缩适配
- [ ] 删除 `TriggerEventBridge` 的 `refreshHistory` 调用；评估 legacy 冷对账删除条件
