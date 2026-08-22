# LLM 参与的会话压缩（LLM Compaction）设计

- 日期：2026-08-23
- 分支：`feat/llm-compaction`
- 状态：设计已确认，待实施
- 前置：`docs/dev/features/2026-08-21-session-event-log/`（compaction/applied 事件 + fold restart point 语义已合入）
- 改动面：`packages/core`（compaction capability + context/compaction.ts）为主，事件 schema 向后兼容扩展

## 背景与动机

现有压缩（`capabilities/compaction`）在 tokens > 75% context window 且超过 keepRecentPrompts=20 / maxTurns=50 门槛后触发，digest 由 `generateDigest` **机械拼接**生成：每条消息截 500 字符、工具调用只留 name + 两个短 arg 值、**工具输出完全丢弃**。信息损失大——文件路径、关键决定、用户偏好在摘要里基本不可恢复，压缩后的会话表现为"失忆"。

本 feature 将 digest 生成替换为 **LLM 一次性 summary 调用**：压缩时把待压缩历史渲染成 token 可控的文本 transcript，交给当前 agent 同款模型生成结构化 Markdown 摘要，替代机械拼接。事件模型、fold、restore 语义完全不变，仅 `digestContent` 的来源升级。

## 已确认的关键决策

| # | 决策 | 内容 |
|---|---|---|
| 1 | 同步执行 | 摘要调用在 afterTurn hook 内同步完成，期间 session 保持 busy（压缩罕见，不值得异步复杂度） |
| 2 | 同款模型 | 使用 `agent.state.model`（agent profile 覆盖或全局默认），不引入独立 utility model 配置 |
| 3 | maxTurns | 50 → 40（keepRecentPrompts=20 不变） |
| 4 | 摘要输入 | 不发原始 `Message[]`，渲染为**纯文本 transcript**：工具输出替换为「截断预览 + 占位符」（前 ~300 字符），天然规避 toolCall/toolResult 配对约束 |
| 5 | 失败回退 | LLM 失败 → 跳过本轮压缩（warn，下一轮 afterTurn 自然重试）；tokens > 90% window 时仍失败 → 回退机械 digest，防 window 溢出 |
| 6 | 可观测 | `compaction/applied` 事件新增可选字段 `digestSource: "llm" | "mechanical"` |

## §1 总体流程

```
afterTurn(agent, eventLog)
  ├─ deriveMessageEntries → messages
  ├─ readCurrentTokens → currentTokens（systemPrompt + 全部消息）
  ├─ planCompaction(messages, { currentTokens, contextWindow,
  │                             keepRecentPrompts: 20, maxTurns: 40 })
  │    └─ shouldCompact / anchorIndex / tail（split 严格落在 user message 边界）
  ├─ sanitizeToolCallPairs(tail) → tail 内孤儿 toolResult 剔除（seq 进 excludedSeqs）
  ├─ [新增] buildTranscript(headMessages, previousDigest?)
  │    └─ 纯文本 transcript（见 §2）
  ├─ [新增] summarize(transcript, model, streamFn)
  │    ├─ 成功 → digest = LLM 输出，digestSource = "llm"
  │    ├─ 失败 && currentTokens ≤ 0.9 × contextWindow → return（跳过本轮，不 append 事件）
  │    └─ 失败 && currentTokens > 0.9 × contextWindow → digest = generateDigest(head)，digestSource = "mechanical"
  └─ eventLog.append("compaction/applied", { anchorSeq, digestContent, excludedSeqs, digestSource })
```

fold（`session/fold.ts`）对 `digestSource` 不敏感——`wrapDigestContent(digestContent)` 照旧合成 `<compaction-digest>` user message。

## §2 Transcript 渲染（新模块 `context/compaction-transcript.ts`）

摘要输入不使用原始 `Message[]`（那样等于把整个 context window 再发一遍，且要维护配对合法性），渲染规则：

```
[previous summary]:
<上一次 digestContent，若有——增量压缩时作为开头段>

[user]: <原文，截断 MAX_MESSAGE_CHARS=500>
[assistant]: <回复文本>
[tool read_file(path.md) → 返回]:
  <输出前 300 字符>…（工具输出已截断，此处曾有一次文件读取）
[assistant]: <继续回复，引用了读取结果>
```

- **user / assistant 文本**：沿用现有 `extractUserText` + 500 字符截断
- **toolCall**：`toolName(argSummary)`，argSummary 复用 `extractToolArg`（≤2 个短字符串值）
- **toolResult**：`[tool {name}({args}) → 返回]:\n  {前 300 字符}…（工具输出已截断）`；占位符保住"这里发生过什么类型的操作"，预览保住"数据大致是什么"——assistant 后续消息通常只引用结论不重复数据，300 字符预览足够 summarizer 判断语义
- **stopReason 为 error/aborted 的 assistant 消息**：整条跳过（与 sanitize 语义一致）
- transcript 总量按 tokens 预算裁剪：若预估超过 `contextWindow × 0.5`（摘要输入不应自身撑爆），**从最旧的消息开始丢弃**（保留 `[...更早的 {n} 条消息已省略...]` 标记行），previous summary 段始终保留——增量语义下旧信息的真相源是 digest 不是原始消息

## §3 Summary 调用

```ts
const streamFn = modelCatalog.getChatStreamFn();   // 裸 streamFn：无 decorators、无 tools
const context: Context = {
  systemPrompt: SUMMARY_SYSTEM_PROMPT,
  messages: [{ role: "user", content: transcript }],
};
// 消费 AssistantMessageEventStream 至 done；stopReason !== "completed" 视为失败
```

- **裸调用理由**：agent 实例的 streamFn 带 capability decorators（usage 记录等副作用），摘要调用不应计入会话的模型用量统计链路（usage 仍会产生于 provider 层，但不动 agent state）
- **模型**：`agent.state.model`；model 未配置（agent 等待模型配置状态）→ 视同失败走回退分支
- **超时**：60s 硬超时（AbortSignal）。超时/网络错误/provider 报错统一 `logger.warn` 后按 §1 分支处理
- **输出约束**：SUMMARY_SYSTEM_PROMPT 要求输出 Markdown，必须保留——
  1. 用户的目标、偏好与明确指令
  2. 关键决定及其理由（做了什么选择、放弃了什么）
  3. 涉及的文件路径、数据文件与产物位置（`*.data.json`、生成的 HTML、图片）
  4. 未完成事项与用户期待
  5. 丢弃：寒暄、工具原始输出细节、与后续工作无关的探索过程
- 输出长度指导：≤ 800 tokens
- **温度**：低（如 temperature 0.2），经 `getChatStreamFn({ temperature: 0.2 })` 传入，不影响 agent 自身采样配置

## §4 依赖注入

```ts
compactionCapability(deps: {
  projectStore: ProjectStore;
  modelCatalog: Pick<ModelCatalog, "getChatStreamFn">;   // 新增
  logger?: Logger;
})
```

`factory.ts` 装配点传入已有的 `modelCatalog` 实例，一行改动。

## §5 事件 schema 向后兼容扩展

```ts
"compaction/applied": {
  anchorSeq: number;
  digestContent: string;
  excludedSeqs: number[];
  digestSource?: "llm" | "mechanical";   // 缺省视为 "mechanical"（历史事件）
};
```

- fold / restore / server contract 不需要读此字段（纯观测），仅日志与未来调试工具消费
- server contracts 若对 `compaction/applied` 有 schema，补可选字段即可

## §6 孤儿 turn 防御（测试加固）

live tail 的完整性由三重机制保证，本次补齐显式测试：

1. **split 边界**：`findPromptSplit` / `findTurnSplit` 均收敛到 user message index，anchor 必然落在完整 agent turn 结束之后——maxTurns=40 计数的是 assistant 消息数，split 永不落在 toolCall/toolResult 配对中间
2. **sanitize 兜底**：`sanitizeToolCallPairs` 剔除 tail 内无配对 toolCall 的 toolResult、stopReason 异常的 assistant 及其孤儿结果
3. **excludedSeqs 闭环**：被 sanitize 剔除的消息 seq 全部进 `excludedSeqs`，fold 时跳过——不出现"事件存在但消息被排除一半"的中间态

新增测试用例（`capabilities/compaction` 与 `context/compaction`）：

- split 恰落在 pair 中间时（构造异常输入），sanitize 后 tail 无孤儿 toolCall / toolResult
- tail 首条消息是 user message（边界不变量）
- 被剔除消息的 seq 与 `excludedSeqs` 一一对应，fold 结果与 sanitize 后的 tail 一致
- maxTurns=40 生效（第 41 个 assistant turn 触发、40 个以内不触发）

## §7 回退行为细节

| 场景 | 行为 |
|---|---|
| LLM 成功 | digestSource="llm"，正常 append |
| LLM 失败，tokens ≤ 90% window | **不 append 事件**，本轮放弃压缩；下一轮 afterTurn 重新评估（消息更多，仍会超阈值 → 重试摘要） |
| LLM 失败，tokens > 90% window | digestSource="mechanical"，用 `generateDigest` 兜底 append——宁可失忆也不能 window 溢出导致会话不可用 |
| 模型未配置 | 同 LLM 失败分支 |

连续失败的风险：每轮 turn 都会尝试一次 LLM 摘要并失败，直到 tokens 破 90% 走机械兜底——可接受的收敛路径，无需重试预算。

## §8 验证计划

- 单元：transcript 渲染（截断、占位符、previous digest 段、token 预算裁剪）、planCompaction maxTurns=40、summary prompt 组装
- 集成（mock streamFn）：成功路径 append `digestSource:"llm"`；失败路径不 append；90% 兜底路径 append `"mechanical"`；fold 输出与现状完全一致
- 既有测试回归：`context/compaction.test.ts`、`capabilities/compaction`、`session/fold.test.ts`
- 手动：长会话跑真模型观察摘要质量与 token 曲线
