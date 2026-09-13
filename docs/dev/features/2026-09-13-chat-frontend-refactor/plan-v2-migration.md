# Chat 前端消费协议 v2 实施计划

对应 [followup-v2-migration.md](./followup-v2-migration.md)。本次范围 M1–M4 + M6（M5 依赖 09-05 PR5 的 control 落库 / 快照收缩，未合入 dev，留待汇合后；遗留清理同）。每阶段测试全绿再进入下一阶段。

## Stage 1：model（M1 + M3）

- [ ] `decode.ts` 升级为帧分类 `DecodedFrame`（event / session-ready / replay-events / replay-done / ignored）
- [ ] `agent-event-parse.ts` 将 `user_message` / `turn_retried` 映射为 live 事件（含 seq/clientId/source/triggerName）
- [ ] `entry-reducer.ts` state 增加 `seqByMessageId` 绑定；live 语义升级：
  - `user_message` 落 UserEntry、按 clientId 结算乐观 entry、trigger 轮 live 成组
  - `turn_retried` 按 `abandonedSeqs` 移除；`turn_withdrawn` 按 wire seq 截断
  - `message_end` seq 幂等（重放在先则丢弃 wire 侧内容）、建立 messageId→seq 绑定
  - `message_start` / `message_update` 命中绑定即 skip；`findReusableStreamIndex` 有 messageId 时不再回退尾部 window
  - 游标推进：`user_message` / `message_end.seq` / `agent_end.seq` / `turn_retried` / `turn_withdrawn`
- [ ] `applyPersistedEvents`：user/message、assistant/message、tool/result（含 transient 同 toolCallId 的 merge + owner 配对）、turn/withdrawn 区间、turn/retried、compaction/applied（excludedSeqs 移除）、游标推进
- [ ] `dropTransientProjections`：重放完成后清除无 seq 的运行中投影（由快照重建）
- [ ] `settleOptimistic` 单一实现：clientId 精确匹配优先，重放路径按 unique text 兜底
- [ ] 测试：decode / parseAgentEvent / live v2 / persisted / history settle

## Stage 2：runtime（M2）

- [ ] `session-recovery.ts`：onOpen 冷启动（cursor < 0）直接 HTTP 对账，warm 连接等待首帧判定；首帧 `session_ready` → 重放路径（`applyPersistedEvents` → `finishReplay`），否则 legacy HTTP 对账；重放期间普通帧缓冲、重放完成后 flush；close/cancel/backoff 语义保持
- [ ] `session-link.ts`：`onFrame(DecodedFrame)`、url 携带 `since`、`onOpen(since)` 把实际发送的 since 透传给 recovery
- [ ] `session-lifecycle.ts`：recovery host 接线（applyPersistedEvents 前 flush 队列、finishReplay 落 dropTransient、setHistory ready）
- [ ] `session-store.ts`：暴露 `flushPending`（queue.flushNow）
- [ ] 测试：recovery 两分支与顺序契约、link since 与帧路由、store 重放集成

## Stage 3：M4 多端语义验证

- [ ] store 集成测试：clientId 结算（含重连时 replay text 兜底）、其他端 turn_retried 移除、trigger echo live 成组

## Stage 4：M6

- [ ] reducer property：随机 (live + replay + history) 交错流 → seq 幂等、绑定一致、重放合并 == 全量重建、按 seq 截断正确
- [ ] E2E：mock v2 server 下断线重连重放（断线期间 run 已完成 / run 进行中）

## Stage 5：收尾

- [ ] `npm run verify`
- [ ] 受影响 E2E：`chat-streaming-resilience` / `chat-retry` / `chat-withdraw` / `floating-chat` / `chat-history-render` / `ui-sdk`
- [ ] doc-sync：architecture/chat.md、backlog、followup 状态
