# Restore 时补齐被中断的 toolCall（孤儿 toolCall 自愈）

- 日期：2026-08-20
- 影响文件：`packages/core/src/session/compactor.ts`、`packages/core/src/session/agent-runner.ts`

## 问题

会话在工具执行中途崩溃/退出时，assistant 消息（含 toolCall 块）已在 `message_end` 落库，但对应 toolResult 未落库。恢复路径存在两个缺口：

1. `initForRestore` 的无 compaction 分支 `logFromRows` 完全不做 sanitize；compaction 分支的 `sanitizeToolCallPairs` 只删孤儿 toolResult（有 result 无 call），**不补孤儿 toolCall**（有 call 无 result）
2. 恢复后该会话永久不可用：
   - 下次 `sendMessage` 时孤儿 toolCall 违反 provider 的 tool_use/tool_result 配对约束，请求被拒（pi-agent-core 文档明确该场景）
   - `retryLastTurn` 守卫 `stopReason === "error"` 不匹配（该 assistant 消息以 `toolUse` 正常结束），无法通过重试弹掉
   - 用户只能弃用该会话

## 方案

参考已废弃的 event log 分支（`feat/core-event-log-refactor`）中 `repairLog` 的思路，在新内核的最小落点上实现：

- **纯函数** `synthesizeInterruptedToolResults(log: MessageLog): AgentMessage[]`（`session/compactor.ts`）：
  - 扫描 log，收集全部已应答的 `toolCallId`，记录最后一个含 toolCall 的 assistant 消息
  - 对其中未应答的 toolCall 生成合成 toolResult（`isError: true`，文案 "The tool call was interrupted and did not execute."）
  - 只处理尾部 assistant 消息：正常运行下孤儿只可能出现在尾部（pi 的 loop 要求 toolResult 齐了才会进入下一轮）；中段孤儿属 DB 损坏，不在本次范围
- **接线**（`AgentRunner.initForRestore`）：构造 initialLog 后（两条路径统一）调用该函数，对每条合成消息 `appendMessage` 持久化并以真实 dbId `appendEntry`

## 设计取舍

- **持久化而非仅内存合成**：DB 自愈，所有读取方（UI 历史 `getRecentTurns`、status 计算、未来 compaction 锚点）看到一致故事；幂等——二次 restore 时 toolCall 已有应答，不再合成
- **不删除带孤儿 toolCall 的 assistant 消息**：无 compaction 路径保留 error assistant 消息是既有语义（retry-after-restore 依赖 `stopReason === "error"` 的最后一条消息存在），删除会破坏重试

## 验证

- `agent-runner.test.ts` 新增：部分应答场景（2 toolCall 1 result）合成 + 落库 + dbId 有效 + 二次 restore 幂等；完整应答场景不合成
- 全量 core 测试通过（model-providers UA 测试 1 例失败为 HEAD 存量问题，与本次无关）；server 测试失败数与 HEAD 完全一致（存量）
