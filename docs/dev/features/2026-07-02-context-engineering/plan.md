# Context Engineering 重构 — 实施计划

> 关联设计：`design.md`
> 模式：subagent-driven（每个 Task 可独立交付、独立测试）
> 验收基线：`npm run lint && npm test --workspace=packages/core` 全绿

## 任务依赖图

```
Group A (并行，无相互依赖):
  T1 ContextBlock + Serializer
  T2 Token 估算器
  T4 SessionStore DB 层
  T6 load-skill XML + AGENTS.md
        │
Group B (依赖 A):
  T3 read-context-files 重构  ← T1
  T5 Compaction 逻辑          ← T2
        │
Group C (集成，依赖全部):
  T7 SessionRuntime 集成       ← T1,T2,T3,T4,T5
```

---

## Group A — 基础层（可并行）

### T1. ContextBlock 类型 + Serializer

**目标**：把 system-prompt section 类型化为 discriminated union，统一渲染成 XML。

**文件**：
- 新增 `packages/core/src/context/blocks.ts`
- 新增 `packages/core/src/context/serialize.ts`
- 新增 `packages/core/src/__tests__/context/serialize.test.ts`

**要点**：
- `ContextBlock` union（4 个 kind）+ `ContextFile` 接口 + 4 个 builder 函数（空 content 时 builder 仍返回 block，由 serializer 决定是否渲染——保持 builder 单一职责）。
- `serializeSystemPrompt(blocks: ContextBlock[]): string`：每个 block 包对应 XML tag；`<skill-item .../>` 自闭合；block 间用空行分隔；`<context-file path>` 保留现有转义约定。
- builder 做基本校验：content 为纯空白字符串 → 返回 `null`（由调用方过滤），避免空 XML tag。

**测试**：
- 每个 kind 单独序列化 → XML 快照。
- 多 block 组合（全部 kind）→ 完整快照。
- 空白 content → builder 返回 null，serializer 跳过。
- skill-catalog 多 skill / 零 skill。
- 特殊字符转义（`<`、`>`、`&`）在 content 内。

**依赖**：无。

---

### T2. Token 估算器

**目标**：近似 token 计数，供 compaction 触发判断（追求单调性，不追求精确）。

**文件**：
- 新增 `packages/core/src/context/token-estimate.ts`
- 新增 `packages/core/src/__tests__/context/token-estimate.test.ts`

**要点**：
- `estimateTokens(input: string | Message[], model?: Model): number`。
- 字符串模式：CJK 字符按 ~1.5 字/token，拉丁按 ~4 字/token，加权混合。
- Message[] 模式：遍历各 message 的 content（text/thinking/toolCall/toolResult），抽 text 后按字符串模式估算并求和。
- `model` 参数预留（本期按 provider 用不同系数，但默认系数即可用）。

**测试**：
- 单调性：更长文本 → 更大估算。
- 纯中文 vs 纯英文 vs 混合 → 系数差异合理。
- Message[]（user/assistant/toolResult 各一）→ 求和正确。
- 空字符串 / 空 Message[] → 0。

**依赖**：无。

---

### T4. SessionStore DB 层

**目标**：messages 表加 `prev_message_id` 链表列，新增 compactions 表，扩展 CRUD。

**文件**：
- 修改 `packages/core/src/store/session.ts`
- 修改/新增对应测试（`packages/core/src/__tests__/store/session-store.test.ts` 或现有位置）

**要点**：
- `applyMigrations` 增量：`messages` 加 `prev_message_id INTEGER`（可空）；新建 `compactions` 表（见 design §8.2）。
- `appendMessage(sessionId, message, prevMessageId?)`：返回新 row id（`number`）；事务内写入 `prev_message_id`。
- `recordCompaction(sessionId, { anchorMessageId, digestContent, tokenEstimate })`：插入 compactions 表。
- `getLatestCompaction(sessionId)`：返回最新一条 compaction 记录或 null。
- `getMessagesAfter(sessionId, anchorId)`：返回 `Array<{ id, message }>`，`id > anchorId`。
- `getSessionMessagesWithIds(sessionId)`：现有 `getSessionMessages` 的带 id 版（返回 `Array<{ id, message }>`）。
- 保留 `getSessionMessages`（无 id）供其它调用方兼容，内部委托 `getSessionMessagesWithIds` 再 `.map(r => r.message)`。

**测试**：
- prev_message_id 链表写入（首条 NULL，后续正确指向前驱）。
- compactions 表 CRUD（record → getLatest → 字段正确）。
- getMessagesAfter 边界（anchorId 不存在、无后续消息）。
- getSessionMessagesWithIds 与 getSessionMessages 结果一致。
- 旧库迁移：无 prev_message_id 列 → 迁移后查询不报错（NULL 兜底）。

**依赖**：无。

---

### T6. load-skill XML 包裹 + AGENTS.md 文档

**目标**：小批量收尾——skill 全文 tool result 加结构化标签；AGENTS.md 登记 tag 注册表。

**文件**：
- 修改 `packages/core/src/tools/load-skill.ts`
- 修改 `AGENTS.md`

**要点**：
- `load-skill.ts:34` 的 `# Skill: ${skill.name}` 改为 `<skill-content name="${skill.name}">\n${skill.instructions}\n</skill-content>`；`## Skill Files` 段保留在标签内或紧跟其后（保持模型可读）。
- AGENTS.md 新增一节"上下文 XML tag 注册表"，搬运 design §5.2 的注册表 + 一句"所有 system-prompt section 用 XML 包裹，不用 markdown 边界"。

**测试**：
- 现有 load-skill 测试适配新格式（snapshot 更新）。

**依赖**：无。

---

## Group B — 逻辑层（依赖 A）

### T3. read-context-files 重构

**目标**：从返回拼接字符串改为返回结构化 `ContextFile[]`，XML 包裹移交 serializer。

**文件**：
- 修改 `packages/core/src/engine/read-context-files.ts`
- 修改 `packages/core/src/__tests__/engine/read-context-files.test.ts`

**要点**：
- 返回类型 `Promise<ContextFile[]>`（`ContextFile` 从 `context/blocks.ts` 导入）。
- 移除 `## Pre-loaded Context` 和 `<context-file>` 字符串拼接（交给 T1 serializer）。
- 保留所有路径安全校验（`resolveProjectPath`）+ 权限校验（`canRead`）+ 静默跳过逻辑。
- 空结果返回 `[]`。

**测试**：
- 现有用例适配：断言返回 `ContextFile[]` 结构（path + content）而非字符串。
- 路径穿越跳过、权限拒绝跳过、文件不存在跳过、空输入返回空数组。

**依赖**：T1（`ContextFile` 类型）。

---

### T5. Compaction 逻辑

**目标**：纯启发式压缩的核心计算——planner + digest 生成 + 瞬态裁剪。

**文件**：
- 新增 `packages/core/src/context/compaction.ts`
- 新增 `packages/core/src/__tests__/context/compaction.test.ts`

**要点**：
- `planCompaction(messages, model, { keepRecentTurns=6, thresholdRatio=0.7 }): CompactionPlan`：
  - `shouldCompact`：`estimateTokens(systemPrompt + messages)` 需作为参数传入或 planner 内部不估 systemPrompt（**决策：planner 接收已估算的 `currentTokens` 数值，避免 planner 依赖 systemPrompt 字符串**——更纯、更易测）。签名调整为 `planCompaction(messages, { currentTokens, contextWindow, keepRecentTurns, thresholdRatio })`。
  - `anchorIndex`：从末尾向前数 `keepRecentTurns` 个 user 消息，定位 anchor；anchor 之前全部进 digest。
  - `digest`：`generateDigest(messages.slice(0, anchorIndex + 1))` → role `"user"` 合成消息。
  - `tail`：`messages.slice(anchorIndex + 1)`。
- `generateDigest(messages: Message[]): Message`：按 design §7.4 规则生成 `<compaction-digest>` 文本；ToolResult 按 toolName 子分类（read/write/list/search/skill/error）生成状态行；ThinkingContent 全丢。
- `applyTransientPruning(messages: Message[]): Message[]`：丢弃非最新 assistant 的 ThinkingContent；超长 tool result 截断头尾。

**测试**：
- shouldCompact：token 未超阈值 → false；超阈值 → true。
- anchorIndex：keepRecentTurns=2 时正确保留最后 2 个 user turn。
- generateDigest：含 user/assistant/toolCall/toolResult/thinking 各类型 → 各归入正确 section（User requests / Actions / Errors），ThinkingContent 不出现。
- toolResult 子分类：read_file 留 path+status、list_files 整条丢弃、error 进 Errors。
- tail 完整保留（引用相等）。
- digest role 为 "user"。
- applyTransientPruning：非最新 assistant thinking 被丢；最新 assistant thinking 保留；超长 tool result 被截断。

**依赖**：T2（`estimateTokens`）。

---

## Group C — 集成层

### T7. SessionRuntime 集成

**目标**：把前面所有成果接入 session-runtime，实现 XML 装配 + transformContext + 持久化 compaction + restore。

**文件**：
- 修改 `packages/core/src/session-runtime.ts`
- 新增/修改 `packages/core/src/__tests__/session-runtime.test.ts`（或现有测试位置）

**要点**（按方法分）：

1. **新增 `liveMessageDbIds: Map<string, number[]>`** 字段 + 生命周期管理（createSession 初始化空数组、destroySession 清除）。

2. **buildAgent 重构**（design §6.4）：
   - 组装 `ContextBlock[]` → `serializeSystemPrompt(blocks)` 替代字符串拼接。
   - `readContextFiles` 改用 T3 新签名（返回 `ContextFile[]`）。
   - 构造 `Agent` 时传入 `transformContext` 钩子（闭包捕获 agent 自身引用）。

3. **transformContext 接线**（design §7.2 调用点 1）：
   ```ts
   transformContext: async (messages) => {
     const plan = planCompaction(messages, { currentTokens, contextWindow, ... });
     return plan.shouldCompact ? [plan.digest, ...plan.tail] : applyTransientPruning(messages);
   }
   ```
   - `currentTokens` = `estimateTokens(systemPrompt) + estimateTokens(messages)`。
   - `contextWindow` = `model.contextWindow ?? 32768`。

4. **sendMessage 后置 compaction**（design §7.2 调用点 2）：
   - `message_end` 事件回调里用 `appendMessage(...)` 返回的 id 追加到 `liveMessageDbIds`。
   - `agent.prompt()` resolve 后调 `planCompaction`；若 `shouldCompact`：`recordCompaction` + 裁剪 `agent.state.messages` + 同步裁剪 `liveMessageDbIds`（digest 占位 0）。

5. **restoreSession 重构**（design §8.3）：
   - 有 compaction → `[digest, ...tail]` + liveMessageDbIds `[0, ...tailIds]`。
   - 无 compaction → `getSessionMessagesWithIds` + liveMessageDbIds ids。
   - restoreSession 与 createSession 都需初始化 liveMessageDbIds。

6. **边界**：contextWindow 缺失用 32768；compaction 失败不阻断 sendMessage（log warning，保留未裁剪 live buffer）。

**测试**：
- buildAgent：输出 system prompt 含 `<project-instructions>`/`<agent-profile>` 等 XML tag，不含 `## Available Skills` / `---`。
- buildAgent：无 skill / 无 context 文件时对应 block 省略。
- transformContext 接入：mock planner 返回 shouldCompact → 返回 `[digest, ...tail]`；返回 false → 调 applyTransientPruning。
- sendMessage 持久化：mock planner shouldCompact → 验证 recordCompaction 调用、agent.state.messages 裁剪、liveMessageDbIds 同步。
- sendMessage 不触发：shouldCompact=false → 不写 compactions、live buffer 不变。
- restoreSession：有 compaction 记录 → live buffer = [digest, ...tail]、liveMessageDbIds 正确。
- restoreSession：无 compaction 记录 → 全量恢复。
- liveMessageDbIds 与 agent.state.messages 始终同长。

**依赖**：T1（blocks/serialize）、T2（token-estimate）、T3（readContextFiles 新签名）、T4（SessionStore CRUD）、T5（compaction planner）。

---

## 执行顺序建议

1. **并行启动** T1、T2、T4、T6（Group A，4 个 subagent）。
2. **并行** T3（依赖 T1）、T5（依赖 T2）（Group B，2 个 subagent）。
3. **串行收尾** T7（Group C，依赖全部，1 个 subagent；最复杂，需完整设计上下文）。

每个 Task 完成后跑 `npm run lint --workspace=packages/core && npm test --workspace=packages/core` 验证；T7 完成后额外跑 server contract test（`npm test --workspace=packages/server`）确认 TurnContextSnapshot debug 路径未回归。
