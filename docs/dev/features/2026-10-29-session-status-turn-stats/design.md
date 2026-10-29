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
  - 本轮无含 usage 细分的 assistant 消息（老会话 / 尚无回复 / 仅 totalTokens 的残缺 usage）→ `null`
  - 本轮 `cacheRead + input == 0`（除零）→ `null`，UI 显示「未知」，**不伪造估算值**；此时若 output 有实测值仍照常返回（不因命中率 null 而抹掉已知量）
- 汇总口径：本轮所有 assistant 消息的 usage 逐字段求和；「有 usage」的判定依据是 input/output/cacheRead/cacheWrite 任一为数字（pi-ai 各 provider 构造完整 Usage 对象，细分字段总同时出现；`totalTokens` 单独存在视为残缺，整体未知）。

## 消息计数（当前上下文范围，非完整历史）

- `userMessageCount`：role=user 且非 compaction digest；`messageCount`：全部消息（user/assistant/toolResult）。
- **统计范围是当前上下文消息缓冲**：compaction 后历史折叠为一条 digest（digest 计入 messageCount、不计入 userMessageCount），被 retried/withdrawn 丢弃的消息在 fold 阶段已排除（live buffer 每次 retry/withdraw 后 `syncBufferFromLog` 同步），因此**不是完整历史总数**，UI 标签写「上下文用户消息数 / 上下文总消息数」，不写「会话总」。
- retried/withdrawn 两条路径均不会被污染。
- compaction digest 识别：复用 `compaction.ts` 的 `isDigestMessage`（`<compaction-digest` 标记，`wrapDigestContent` 确定性产出、`sanitizeDigestContent` 中和 LLM digest 内的伪造标签），与 `planCompaction` 计数 prompt 的既有口径一致。取舍：用户手输该标记会被误判为 digest——与 planCompaction 同等局限，接受。
- 已知近似：mid-turn 调 status 时 pi-agent-core 会先把 streaming partial assistant 消息 push 进 buffer（agent-loop.js:284），`messageCount` 瞬时 +1（无 usage 细分，token 汇总不受污染）；legacy 未迁移会话直读 messages 表，历史版本写入形态若与现行有差（如 digest 行），计数可能偏差 ±1，迁移后即精确。

## 兼容边界（review M2 决议）

- Web 版本协商（`version-guard.tsx` + `compareAppVersion`）**无硬保证**：incompatible 可被用户 dismiss，且 guard fetch 失败时回退 `"ok"` 不阻断；桌面 Electron 同包发布无错位。
- 因此 contracts 新字段全部 `Type.Optional(Union([Number, Null]))`：旧 server payload 缺新字段时新 client 解析通过，旧指标照常显示、新指标显示「未知」；新 server 恒定发送全字段（core `computeTurnStats` 输出 number|null）。
- 无 usage 时四个 turn token 细分返回 `null`（未知），不返回 0 冒充实测；有 usage 时 0 即实测 0（pi-ai 各 provider 显式填 0）。

## 变更

- core `session/status.ts`：新增纯函数 `computeTurnStats(messages)`（放 status.ts，被 `computeSessionStatus` 与 `AgentRunner.getStatus` 共用）；导出 `SessionStatus` 扩展字段
- core `context/compaction.ts`：导出 `isDigestMessage`
- contracts `sessions.ts`：`sessionStatus` additive 追加 `cacheHitRate`、`turnInputTokens` / `turnCacheReadTokens` / `turnCacheWriteTokens` / `turnOutputTokens`（均 `Optional(number|null)`）、`userMessageCount` / `messageCount`（`Optional(number)`）
- app `SessionStatusDialog.tsx`：命中率（百分比 1 位小数 + 分子/分母原始数字小字）、本轮四项 token、上下文用户消息数/总消息数；未知沿用 `session.statusUnknown`
- i18n：三 locale 新增 key，zh-CN canonical 带注释；文案写「本轮缓存命中率」不写「总」
- server 路由零改动（透传 + parseContract）

## 测试

- core `status.test.ts`：`computeTurnStats` 覆盖两轮只看最后一轮、0%/100%/无 usage null/除零 null（保留实测 output）/仅 totalTokens 残缺 usage null、无 user 消息降级、digest 不计 user 数、events→deriveMessages→stats 的 retried/withdrawn 排除
- `session-manager.test.ts`：两处 `toEqual` 断言补新字段（含 usage 汇总与计数）
- contracts `api-contracts.test.ts`：sessionStatus 正/负向 + 旧 payload（缺新字段）通过
- server `sessions-status-contract.test.ts`（新增）：真实 createProject + 真实 SessionManager 冷路径 + 真实路由 inject，断言新字段端到端正确（补消费方契约测试缺口）；NotFoundError→404 对齐生产 setErrorHandler
- app `SessionStatusDialog.test.tsx`（新增）：有值 / null 全未知 / 旧 payload 缺字段旧指标可用新指标未知 / loading / error；数字期望用 `toLocaleString` 动态生成，不依赖机器 locale

## 不做

历史逐轮统计、图表、成本金额、chat wire 协议、SessionEventLog schema、新 event 类型、trigger/审批逻辑、导出。
