# 会话状态弹窗：本轮缓存命中率与消息统计

## 背景

Manager 需求：给「会话状态」dialog 增加当前会话统计信息——本轮缓存命中率、用户消息数、总消息数。只做当前轮次统计，不做历史轮次。

## 数据来源核实（结论：无需新增 store schema / event 字段）

- pi-ai `Usage`（`node_modules/@earendil-works/pi-ai/dist/types.d.ts`）：`input` / `output` / `cacheRead` / `cacheWrite` / `totalTokens`。
- **`input` 语义已排除 cacheRead（及 cacheWrite）**，各 provider 归一化一致：
  - anthropic-messages：`input` ← `input_tokens`（Anthropic API 本身将 cache_read/cache_creation 单列）；`totalTokens = input + output + cacheRead + cacheWrite`
  - openai-completions：`input = max(0, prompt_tokens - cached_tokens - cache_write_tokens)`
  - openai-responses-shared：`input = max(0, input_tokens - cached_tokens - cache_write_tokens)`
  - faux：`input = max(0, promptTokens - cacheRead)`
- `assistant/message` 事件持久化完整 `AssistantMessage`（含 `usage`，`packages/core/src/session/events.ts`），因此统计可直接从 messages 派生，冷路径 `deriveMessages(readEvents)`、热路径 live buffer 均可用。

## 公式

- **本轮** = 最后一条 role 为 user 的消息（含）到末尾；若无 user 消息，降级为整个 messages 数组（与 `extractLastUsageTotalTokens` 扫全量的行为对齐）。
- **缓存命中率** = `cacheRead / (cacheRead + input)`，分母即本轮实际读取的上下文 token（cacheWrite 属首次写入，不计入分母）。
  - 本轮无任何含 usage 的 assistant 消息（老会话 / 尚无回复）→ `null`
  - 本轮 `cacheRead + input == 0`（除零）→ `null`，UI 显示「未知」，**不伪造估算值**
- 汇总口径：本轮所有 assistant 消息的 usage 逐字段求和；usage 缺失字段按 0 计。

## 消息计数（会话级）

- `userMessageCount`：role=user 且非 compaction digest；`messageCount`：全部消息（user/assistant/toolResult）。
- retried/withdrawn：`deriveMessages` 已在 fold 阶段丢弃（abandonedSeqs），live buffer 每次 retry/withdraw 后 `syncBufferFromLog` 同步，两条路径均不会被污染。
- compaction digest 识别：复用 `compaction.ts` 的 `isDigestMessage`（`<compaction-digest` 标记，`wrapDigestContent` 确定性产出、`sanitizeDigestContent` 中和 LLM digest 内的伪造标签），与 `planCompaction` 计数 prompt 的既有口径一致。取舍：用户手输该标记会被误判为 digest——与 planCompaction 同等局限，接受。

## 变更

- core `session/status.ts`：新增纯函数 `computeTurnStats(messages)`（放 status.ts，被 `computeSessionStatus` 与 `AgentRunner.getStatus` 共用）；导出 `SessionStatus` 扩展字段
- core `context/compaction.ts`：导出 `isDigestMessage`
- contracts `sessions.ts`：`sessionStatus` additive 追加 `cacheHitRate`（number|null）、`turnInputTokens` / `turnCacheReadTokens` / `turnCacheWriteTokens` / `turnOutputTokens` / `userMessageCount` / `messageCount`（数字缺省 0）
- app `SessionStatusDialog.tsx`：命中率（百分比 1 位小数 + 分子/分母原始数字小字）、本轮四项 token、会话用户消息数/总消息数；未知沿用 `session.statusUnknown`
- i18n：三 locale 新增 key，zh-CN canonical 带注释；文案写「本轮缓存命中率」不写「总」
- server 路由零改动（透传 + parseContract）

## 测试

- core `status.test.ts`：`computeTurnStats` 覆盖两轮只看最后一轮、0%/100%/无 usage null/除零 null、无 user 消息降级、digest 不计 user 数、events→deriveMessages→stats 的 retried/withdrawn 排除、legacy 无 usage 全 0
- `session-manager.test.ts`：两处 `toEqual` 断言补新字段（含 usage 汇总与计数）
- contracts `api-contracts.test.ts`：sessionStatus 新字段正/负向
- app `SessionStatusDialog.test.tsx`（新增）：有值 / null 显示未知 / 加载失败

## 不做

历史逐轮统计、图表、成本金额、chat wire 协议、SessionEventLog schema、新 event 类型、trigger/审批逻辑、导出。
