# LLM 参与的会话压缩（LLM Compaction）设计

- 日期：2026-08-23
- 分支：`feat/llm-compaction`
- 状态：设计已确认，待实施
- 前置：`docs/dev/features/2026-08-21-session-event-log/`（compaction/applied 事件 + fold restart point 语义已合入）
- 改动面：`packages/core`（compaction capability + context/compaction.ts）为主，事件 schema 向后兼容扩展

## 背景与动机

现有压缩（`capabilities/compaction`）在 tokens > 75% context window 且（prompts > 20 或 turns > 50 任一超限）时触发，digest 由 `generateDigest` **机械拼接**生成：每条消息截 500 字符、工具调用只留 name + 两个短 arg 值、**工具输出完全丢弃**。信息损失大——文件路径、关键决定、用户偏好在摘要里基本不可恢复，压缩后的会话表现为"失忆"。

本 feature 将 digest 生成替换为 **LLM 一次性 summary 调用**：压缩时精确复刻 agent 真实请求前缀并追加摘要指令（命中 provider prompt cache），交给当前 agent 同款模型生成结构化 Markdown 摘要，替代机械拼接。事件模型、fold、restore 语义完全不变，仅 `digestContent` 的来源升级。

## 已确认的关键决策

| # | 决策 | 内容 |
|---|---|---|
| 1 | 同步执行 | 摘要调用在 afterTurn hook 内同步完成，期间 session 保持 busy（压缩罕见，不值得异步复杂度） |
| 2 | 同款模型 | 使用 `agent.state.model`（agent profile 覆盖或全局默认），不引入独立 utility model 配置 |
| 3 | maxTurns | 50 → 40（keepRecentPrompts=20 不变） |
| 4 | 摘要输入 | **精确复刻 agent 真实请求前缀**（同 systemPrompt + tools + `convertToLlm(fold 视图消息)` + 末尾追加摘要指令），命中 provider prompt cache（Anthropic ~0.1×、OpenAI 系 ~0.5×），不渲染 transcript、不做任何截断（截断即前缀失配） |
| 5 | 失败回退 | LLM 失败 → 跳过本轮压缩（warn，下一轮 afterTurn 自然重试）；tokens > 90% window 时仍失败 → 回退机械 digest，防 window 溢出 |
| 6 | 可观测 | `compaction/applied` 事件新增可选字段 `digestSource: "llm" | "mechanical"` |

## §1 总体流程

```
afterTurn(agent, eventLog)
  ├─ deriveMessageEntries → messages
  ├─ readCurrentTokens → currentTokens（systemPrompt + 折叠视图全部消息：
  │   digest 合成消息 + 上次压缩后保留的消息；物理事件不重读，即下一轮请求的真实体量）
  ├─ planCompaction(messages, { currentTokens, contextWindow,
  │                             keepRecentPrompts: 20, maxTurns: 40 })
  │    └─ shouldCompact / anchorIndex / tail（split 严格落在 user message 边界）
  ├─ sanitizeToolCallPairs(tail) → tail 内孤儿 toolResult 剔除（seq 进 excludedSeqs）
  ├─ [新增] summarize(foldMessages + 摘要指令, model, streamFn, sessionId)
  │    └─ 请求前缀复刻（见 §2）：成功 → digest = LLM 输出，digestSource = "llm"
  │    ├─ 失败 && currentTokens ≤ 0.9 × contextWindow → return（跳过本轮，不 append 事件）
  │    └─ 失败 && currentTokens > 0.9 × contextWindow → digest = generateDigest(messages.slice(0, anchorIndex + 1))，
  │         digestSource = "mechanical"
  └─ eventLog.append("compaction/applied", { anchorSeq, digestContent, excludedSeqs, digestSource })
```

fold（`session/fold.ts`）对 `digestSource` 不敏感——`wrapDigestContent(digestContent)` 照旧合成 `<compaction-digest>` user message。

## §2 摘要输入：请求前缀复刻（命中 prompt cache）

摘要调用**复刻 agent 最后一轮的真实请求前缀，并追加摘要指令**，以命中 provider 侧 prompt cache：

```
systemPrompt: agent.state.systemPrompt        // 与 agent 请求逐字节一致
tools:        agent.state.tools               // 同上（前缀从 position 0 起算，含 tools）
messages:     agent.convertToLlm(foldMessages) // fold 视图（附件已是占位符稳态）
              + [{ role: "user", content: 摘要指令 }]   // 唯一新增部分
options:      { sessionId, signal }           // sessionId → OpenAI prompt_cache_key 亲和；signal → 60s 超时
```

### 为什么能命中（pi-ai 已铺好机制）

- **Anthropic**：pi-ai `anthropic-messages` 自动在 system + tools + 最后一条 user 消息打 `cache_control: ephemeral` 断点；lookup 取最长前缀匹配——摘要请求的前缀（system+tools+完整历史）恰是 agent 上一轮请求的已缓存前缀，历史部分按 ~0.1× 计价，仅指令部分全价
- **OpenAI 系**：pi-ai 将 `options.sessionId` 转 `prompt_cache_key`（缓存分片亲和）；自动前缀缓存 ≥1024 tokens 命中 ~0.5×
- **Gemini**：隐式前缀缓存（≥4096 tokens 自动）

### 与 transcript 方案的成本对比

设 C = 全上下文 input 价格：transcript（截断工具输出至 ~30% tokens 全价）≈ 0.3C 恒定；前缀复刻命中时 0.1–0.5C、未命中 1.0C（无缓存的自定义 OpenAI-compatible provider）。压缩罕见（~40 turn 一次），期望成本与质量（零信息损失）均优，且代码更简。机械 digest（`generateDigest`）保留作为 §7 的溢出兜底，transcript 渲染方案废弃。

### 硬性约束（实现注意）

- **输入源必须是 eventLog fold 视图 + `agent.convertToLlm()`**，不可用 `agent.state.messages` 原文——理由与机制：
  1. **附件时序**：`sanitizer.finalize()`（把带附件的 user 消息替换为占位符文本）在 runner 的 `finally` 块中执行，**晚于 `applyAfterTurnHooks()`**——afterTurn 时刻 `state.messages` 仍带 base64 图片；而 fold 视图落盘的已是占位符版本。摘要若发 base64，既贵又与后续轮次前缀失配
  2. **占位符是稳态**：用户日常使用中，附件轮的下一轮起（live 的 finalize 后 / restore 的 fold）LLM 看到的就是占位符——这个损耗早已发生且必然发生，摘要复刻占位符版本才能与"下一轮真实请求"逐字节一致；反之再变换回 base64 既重复付费又破坏缓存
  3. `convertToLlm`（含 attachment projector：剥 `_attachments` 元数据字段与无 data 的 image block）作用于 fold 视图消息，输出即下一轮请求的精确前缀
- **不可截断**：不在 anchorIndex 处截、不替换 toolResult 内容、不重排——任何字节差异即失配
- **不可在摘要上下文中暴露 tools 执行能力**：tools 仅为前缀匹配随请求发送，摘要指令明确"不要调用工具，直接输出摘要"；streamFn 层面无 agent loop，不会真正执行
- 摘要指令要求：重点总结较早的对话（近期消息将以原文保留在上下文中）；整合首条已有的 `<compaction-digest>`（增量压缩时它是旧信息的唯一真相源）；**先判别会话性质再按对应优先级保留**——任务型保留用户目标/偏好、关键决定及理由、文件路径与产物位置、未完成事项；情感陪伴/角色扮演型保留关系进展、情绪主线与反复出现的话题、用户分享的个人事实、玩笑/昵称/承诺、未闭合的情感线索（且明确不得当作"无关探索"丢弃）；输出 Markdown ≤ 3000 tokens
- **输出侧防御**（LLM 输出不可信）：
  - **digest 包裹结构完整性**：fold 将 `digestContent` 包进 `<compaction-digest>…</compaction-digest>`——LLM 输出若含 `<compaction-digest` / `</compaction-digest>` 字样会撕裂包裹结构（与 backlog「system-prompt XML 包裹对闭合标签不健壮」同类问题）。存盘前把输出中出现的 `<compaction-digest` 替换为 `<compaction-digest'`（或等效转义）
  - **退化输出视为失败**：`stopReason === "completed"` 但输出为空或过短（< 50 字符）→ 按失败走 §7 回退分支，不 append 空摘要
  - 摘要语言跟随用户消息的主导语言
- system prompt 热重载与摘要调用不竞争：afterTurn 在 `prompt()` 返回后、下一次 `applyReload` 之前同步执行，systemPrompt 与刚结束的轮次必然一致

## §3 Summary 调用

```ts
const streamFn = agent.streamFunction;
const context: Context = {
  systemPrompt: agent.state.systemPrompt,
  tools: agent.state.tools,
  messages: [...agent.convertToLlm(foldMessages), instructionMessage],
  // foldMessages = deriveMessages(eventLog.events)——附件已是占位符文本（稳态），
  // 经 convertToLlm（含 attachment projector）后与下一轮真实请求逐字节一致
};
// streamFn(model, context, { sessionId, signal })——sessionId 透传以命中 OpenAI prompt_cache_key 亲和
// 消费 AssistantMessageEventStream 至 done；stopReason 为 "error"/"aborted" 视为失败
// （pi-ai 成功值为 "stop"，非 "completed"）
```

- **直接复用 agent 实例的 `streamFunction`**：decorator 链（time-perception 的时间前缀注入等）在 agent 真实请求中生效，摘要复用同一实例即天然复刻全部出站变换，前缀逐字节一致（含时间感知 agent）；composeStreamFn 包装层的 `maxRetries: 1` 也随之一致。代价是采样参数继承 agent 配置（无法单独设低温）——可接受，同 agent 同行为。能力不需要 modelCatalog 依赖
- **模型**：`agent.state.model`（与历史轮次同款——prompt cache 命中的前提之一）；model 未配置 → 视同失败走回退分支
- **超时**：60s，`options.signal`（AbortSignal）实现——已验证 pi-ai `ProviderRequestOptions.signal` 存在（备选 `timeoutMs`）。超时/网络错误/provider 报错统一 `logger.warn` 后按 §1 分支处理
- **sessionId 来源**：TurnHooksFactory 签名为 `(agentId, sessionId) => hooks`（`runtime.ts` 装配时逐 capability 传入），compaction capability 当前忽略这两个参数，本次接住 sessionId 透传给 streamFn options
- **输出约束**：见 §2 摘要指令；≤ 3000 tokens
- **温度**：继承 agent 采样配置（streamFunction 已焙入）——不再单独设低温

## §4 依赖注入

```ts
compactionCapability(deps: {
  logger?: Logger;
})
```

摘要调用经 `agent.streamFunction` 复用 agent 实例已有的装配，能力不再需要 modelCatalog 依赖。

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

- 单元：planCompaction maxTurns=40、摘要指令组装（增量 digest 整合要求）、前缀复刻的消息组装（`convertToLlm` 输出 + 追加指令、不截断不变换）、digest 输出防御（闭合标签转义、空/过短输出判失败）
- 集成（mock streamFn）：成功路径 append `digestSource:"llm"`；失败路径不 append；90% 兜底路径 append `"mechanical"`；fold 输出与现状完全一致
- 既有测试回归：`context/compaction.test.ts`、`capabilities/compaction`、`session/fold.test.ts`
- 手动：长会话跑真模型观察摘要质量与 token 曲线
