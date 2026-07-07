# Context Engineering 重构

> 状态：design（待 review）
> 日期：2026-07-02
> 类型：refactor

## 1. 背景与现状

当前 Spherse 的 LLM 上下文由 `packages/core/src/session-runtime.ts` 的 `buildAgent()` 单点装配，但存在三个问题：

### 1.1 分隔约定不统一

system prompt 由字符串拼接而成，各 section 各自发明分隔方式：

| Section | 现状分隔 | 位置 |
|---|---|---|
| AGENTS.md + agent prompt | `\n\n---\n\n`（markdown 水平线） | `session-runtime.ts:195-197` |
| 技能目录 | `## Available Skills`（markdown H2） | `session-runtime.ts:204` |
| 预载文件 | `## Pre-loaded Context`（H2）+ `<context-file>` XML | `read-context-files.ts:36` |
| 工具结果 | 自由散文（`Successfully wrote…`） | 各 `tools/*.ts` |

唯一已用结构化边界是 `<context-file>`。顶层 section 边界依赖 markdown，与正文 markdown 冲突，且机器不可解析。

### 1.2 无压缩能力

全仓库搜索 `token|summar|truncat|compress|prune` 仅发现：

- `contextWindow`/`maxTokens` 作为模型元数据（`types.ts:109-110`），**从不用于上下文管理**。
- `truncate()`（`engine/log-agent-event.ts:6-10`）只截断**日志输出**，500 字符，对 LLM 上下文零影响。
- 没有任何 token 估算器、摘要器、消息裁剪、滑动窗口。

pi-agent-core 提供的两个压缩钩子**完全未接**（Spherse 在 `buildAgent` 构造 `Agent` 时只传 `initialState`/`sessionId`/`streamFn`，走的是 `defaultConvertToLlm` 的 identity 透传）：

- `transformContext`（`pi-agent-core types.d.ts:144-163`）—— docstring 明确写明用于 "Context window management (pruning old messages)"。
- `convertToLlm`（`types.d.ts:117-142`）—— AgentMessage[] → Message[] 的 LLM 边界转换。

### 1.3 缺乏类型化的上下文定义

"上下文有哪些类型"只散落在装配代码里，没有可执行、可测试的契约。

## 2. 目标与非目标

### 目标

1. **统一上下文类型定义**：用 `ContextBlock` discriminated union 把所有 system-prompt section 类型化。
2. **统一分隔约定**：全部 system-prompt section 改用语义化 XML 标签包裹，废弃 markdown 边界。
3. **接入压缩地基**：接上 `transformContext`，实现纯启发式（规则裁剪，不调 LLM）的基础压缩策略，让 long-running session 不爆上下文窗口。
4. **为未来压缩铺路**：compaction 持久化模型（compactions 表 + message 链表）+ token 估算能力，后续 LLM 摘要压缩只需在已搭好的骨架上替换 digest 生成实现。

### 非目标（本期不做）

- LLM 摘要压缩（digest 本期是规则生成，非 LLM 调用）。
- 前端 UI 变更（压缩对 UI 透明；TurnContextSnapshot 调试视图已存在，序列化格式变更不涉及 UI 改动）。
- `convertToLlm` 的 wire-level 改写（保持 identity 透传，仅预留接入点）。
- 自定义 AgentMessage 类型（不声明 `CustomAgentMessages`）。

## 3. 决策摘要

| 决策点 | 选择 | 理由 |
|---|---|---|
| 压缩地基深度 | C：标签 + 钩子接线 + 基础压缩策略 | 一步到位，后续只填实现 |
| 压缩执行方式 | 纯启发式裁剪（无 LLM） | 零额外 token 成本、可预测、无延迟 |
| 分隔约定 | 全 XML 统一 | 边界明确、机器可解析、与 Anthropic/Claude Code 一致 |
| 内部表示 | `ContextBlock` 类型化抽象 + 序列化器 | 类型即契约，XML 一致生成，compaction 按类型决策 |
| 持久化 | 原始消息非破坏留存 + 新建 compactions 表 + message 链表 | 历史可回溯、压缩可逆、append-only |
| live buffer | 压缩后裁剪 `agent.state.messages` | 内存有界、性能稳定 |
| compaction 落点 | 仅在 `sendMessage` resolve 后触发（`maybeCompact`） | `transformContext` 钩子的返回值不写回 `agent.state.messages`，无法持久化/裁剪 live buffer，每 turn 重复计算纯浪费；`sendMessage` 后兜底足以覆盖 long-running session 累积爆窗口场景。留作未来 turn 内爆窗口再加 |

## 4. 上下文类型定义（Taxonomy）

分两个域。

### 4.1 System-prompt 块（A 域）

session 构建时装配，全部 **sticky**（永不压缩）。

| ContextBlock kind | XML 标签 | 来源 | 现状对应 |
|---|---|---|---|
| `project-instructions` | `<project-instructions>` | AGENTS.md | 现为裸文本 |
| `agent-profile` | `<agent-profile>` | `profile.systemPrompt` | 现拼在 `---` 后 |
| `skill-catalog` | `<skill-catalog>`（内含 `<skill-item name="…" description="…"/>`） | `skill.list()` 的 name+desc | 现 `## Available Skills` |
| `preloaded-context` | `<preloaded-context>`（内含 `<context-file path="…">`） | `profile.context` 文件 | 现已用 XML |

### 4.2 对话消息（B 域）

pi-ai `Message` union 已类型化；digest 生成时按角色扁平化记录，**不细分 tool result 子类型**（最终落地的是简化版规则，见 §7.2）：

| 类型 | role | digest 行为 |
|---|---|---|
| UserMessage | user | `[user]: <首 ~500 字>` |
| Assistant 文本 | assistant | `[assistant]: <文本>` |
| Assistant toolCall | assistant 子项 | 文本后追加 `[called <name>: <关键参数>]`（文件工具记 path、move/copy 记 `source → destination`、search 记 query、load_skill 记 skill_name） |
| ThinkingContent | assistant 子项 | 丢弃（digest 不含） |
| ToolResult | toolResult | **整条丢弃**（digest 不含；toolCall 已记录动作意图） |
| **CompactionDigest** | 合成 user 消息 | 压缩产物本身，sticky |

## 5. 分隔约定（全 XML）

### 5.1 规则

- 每个 system-prompt section 用语义化 XML 标签包裹，**不再用 markdown H2 / `---` 做 section 边界**。
- 嵌套可重复块用 XML：`<context-file path="…">`、`<skill-item name="…" description="…"/>`（自闭合）。
- tag 名 = 类型 canonical 名，不加前缀（与 Claude Code 风格一致，可读性优先）。
- 工具结果：有结构价值的包 XML（如 `load_skill` 用 `<skill-content name="…">`）；短状态文本（`Successfully wrote…`）保持散文。
- digest 产物用 `<compaction-digest covers="messages 1..42">` 包裹，模型一眼可知是被压缩的历史。

### 5.2 tag 注册表

在 spec 与 AGENTS.md 登记"保留 tag 注册表"，避免后续命名冲突：

```
<project-instructions>      AGENTS.md 内容
<agent-profile>             agent profile 主体
<skill-catalog>             可用技能目录（仅 name+description）
  <skill-item .../>         单个技能条目（自闭合）
<preloaded-context>         预载文件区
  <context-file path="…">   单个预载文件
<skill-content name="…">    load_skill 工具返回的技能全文
<compaction-digest covers="…">  压缩历史摘要（合成消息）
```

## 6. ContextBlock 抽象与装配

### 6.1 新模块结构

```
packages/core/src/context/
├── blocks.ts          # ContextBlock discriminated union + builder 函数
├── serialize.ts       # serializeSystemPrompt(blocks): string
├── compaction.ts      # compactionPlanner + digest 生成 + 启发式裁剪
└── token-estimate.ts  # 近似 token 估算（provider-aware）
```

### 6.2 ContextBlock 类型（blocks.ts）

```ts
export type ContextBlock =
  | { kind: "project-instructions"; content: string }
  | { kind: "agent-profile"; content: string }
  | { kind: "skill-catalog"; skills: Array<{ name: string; description: string }> }
  | { kind: "preloaded-context"; files: ContextFile[] };

export interface ContextFile {
  path: string;       // 相对项目根的路径
  content: string;    // 文件全文
}
```

- builder 函数：`buildProjectInstructions(content)`、`buildAgentProfile(content)`、`buildSkillCatalog(list)`、`buildPreloadedContext(files)`。
- 每个 builder 做基本校验（content 可空 → 对应 block 可省略）。

### 6.3 序列化器（serialize.ts）

```ts
export function serializeSystemPrompt(blocks: ContextBlock[]): string;
```

按 §5 规则把 blocks 渲染成 XML 字符串。示例输出：

```xml
<project-instructions>
...AGENTS.md 内容...
</project-instructions>

<agent-profile>
...profile.systemPrompt...
</agent-profile>

<skill-catalog>
<skill-item name="create-ui-theme" description="…"/>
<skill-item name="write-html" description="…"/>
</skill-catalog>

<preloaded-context>
<context-file path="world/magic-system.md">
...文件内容...
</context-file>
</preloaded-context>
```

### 6.4 buildAgent 重构

`session-runtime.ts:194-214` 由字符串拼接改为：

```ts
const blocks: ContextBlock[] = [];
const agentsMd = await this.projectStore.readIndex();
if (agentsMd.trim()) blocks.push(buildProjectInstructions(agentsMd));
blocks.push(buildAgentProfile(profile.systemPrompt));
const skills = await this.projectStore.skill.list();
if (skills.length > 0) blocks.push(buildSkillCatalog(skills));
const files = await readContextFiles(projectRoot, profile.context, () => toolContext.llmPolicy);
if (files.length > 0) blocks.push(buildPreloadedContext(files));
const systemPrompt = serializeSystemPrompt(blocks);
```

### 6.5 readContextFiles 签名变更

`read-context-files.ts` 从返回 `string` 改为返回结构化 `ContextFile[]`（保留路径安全 + 权限校验），XML 包裹移交给 serializer。对应更新 `__tests__/engine/read-context-files.test.ts`。

## 7. Compaction 机制

### 7.1 共享 planner（compaction.ts）

核心纯函数：

```ts
export interface CompactionPlan {
  shouldCompact: boolean;
  anchorIndex: number;     // 截至此 index（含）的消息被压缩
  digest: string | null;   // 扁平化文本（未包 XML），调用方用 wrapDigestContent 包裹
  tail: Message[];         // anchorIndex 之后保留的消息
}

export function planCompaction(
  messages: Message[],
  options: {
    currentTokens: number;     // 由调用方算好传入（优先用 provider usage.totalTokens）
    contextWindow: number;     // 模型上下文窗口
    keepRecentTurns?: number;  // 默认 20
    thresholdRatio?: number;   // 默认 0.75
  },
): CompactionPlan;
```

- `shouldCompact`：`currentTokens > contextWindow * thresholdRatio`（默认 0.75）。
- `anchorIndex`：保留最近 `keepRecentTurns`（默认 20）个 user turn 不压缩；anchor 之前的全部进 digest。若 user 消息总数 `<= keepRecentTurns` 则不压缩。
- `digest`：扁平化规则文本（见 §7.2），由调用方 `wrapDigestContent` 包成 `<compaction-digest>` 后作为 `role: "user"` 合成消息。
- `tail`：`messages[anchorIndex+1 ..]`。

**为何传入 `currentTokens` / `contextWindow` 而非 `model`**：调用方（`LiveSession.readCurrentTokens`）已能拿到更准确的 token 数（优先用最后一条 assistant 消息的 `usage.totalTokens`，缺失时才回退启发式估算），把决策输入显式化也让 `planCompaction` 成为一个无外部依赖的纯函数，便于单测。

### 7.2 单一调用点：sendMessage 编排（持久化 + 裁剪）

压缩只在一处触发：`LiveSession.sendMessage` 里，`agent.prompt()` resolve 后调 `maybeCompact()`：

```ts
const currentTokens = this.readCurrentTokens();
const contextWindow = this.agent.state.model?.contextWindow ?? 32768;
const plan = planCompaction(this.agent.state.messages, { currentTokens, contextWindow });
if (plan.shouldCompact && plan.digest) {
  const anchorMessageId = this.liveMessageDbIds[plan.anchorIndex];
  const digestMessage = { role: "user", content: wrapDigestContent(plan.digest), ... };
  const postBuffer = [digestMessage, ...plan.tail];
  const postEstimate = estimateTokens(this.agent.state.systemPrompt) + estimateTokens(postBuffer);
  agentStore.sessions.recordCompaction(this.sessionId, {
    anchorMessageId,
    digestContent: plan.digest,                      // 扁平文本
    tokenEstimate: postEstimate,                     // 压缩后 live buffer 估算
  });
  this.agent.state.messages = postBuffer;
  this.liveMessageDbIds = [anchorMessageId, ...this.liveMessageDbIds.slice(plan.anchorIndex + 1)];
}
```

**为何不接 `transformContext` 钩子**：transformContext 在 pi-agent-core 的 `streamAssistantResponse` 中每次 LLM 调用前都触发（一个 agent 行为包含多个 turn，每 turn 一次）。在那里做压缩有两个问题：(1) 其返回值不写回 `agent.state.messages`，所以无法持久化或裁剪 live buffer，每 turn 重复计算纯浪费；(2) 真正需要兜底的"单 agent 行为内 turn 累积爆窗口"场景，等 `sendMessage` resolve 后的 maybeCompact 也能兜住（最坏多一次失败请求）。因此本期不接 transformContext，留作未来真的出现 turn 内爆窗口再加。

**为何需要并行 id 表**：pi-ai `Message` 类型没有 `prev_message_id` 字段（DB row 才有），内存消息对象无法自报 DB id。因此 `LiveSession` 维护 `number[]`（与 `agent.state.messages` 一一对应，digest 合成消息占位为 anchor 的 DB id）以支持 anchor 定位与 restore 重建（见 §8.5）。

- 此处 `agent.state.messages` 的 setter 会 `slice()` 副本（`pi-agent-core agent.js`），安全。
- 职责：写 compactions 表（持久化）+ 裁剪 live buffer（内存有界）。

**Digest 格式（扁平化，最终落地版）**：对 `[0 .. anchorIndex]` 范围的消息按角色生成逐行文本，再用 `wrapDigestContent` 包裹：

```
<compaction-digest>
Earlier conversation (summarized to save context):

[user]: <用户消息首 ~500 字>
[assistant]: <assistant 文本> [called read_file: world/magic.md] [called write_file: ch/ch1.md]
[user]: <下一条用户消息>
[assistant]: <...>
</compaction-digest>
```

规则：
- UserMessage → `[user]: <文本>`（每条截断至 ~500 字）。
- Assistant 文本 → `[assistant]: <文本>`。
- Assistant toolCall → 文本后追加 `[called <name>: <关键参数>]`：文件工具（read/write/edit_file）记 `path`/`file_path`；move_file/copy_file 记 `source → destination`；search_content 记 `query`；load_skill 记 `skill_name`；其余记首个参数。
- ThinkingContent → 全部丢弃。
- ToolResult → **整条丢弃**（toolCall 已记录动作意图，result 体量过大且多为可重生成的文件内容/搜索结果）。
- 保留对话顺序。

digest 作为 `role: "user"` 合成消息，能通过 `defaultConvertToLlm` 的 role 过滤（user/assistant/toolResult）送达 LLM。

**为何从设计初版的「结构化 ## User requests / ## Actions / ## Errors」简化为扁平 `[role]: text`**：初版设想按 tool result 子类型分别摘要，落地时发现 (1) 需要为每个工具维护子类型映射，扩展成本高；(2) ToolResult 体量大但信息密度低（多为可重读的文件内容），整条丢弃比逐类型截断更省 token 且更可预测；(3) 扁平 `[role]:` 格式对 LLM 同样可读，且实现简单。若后续发现丢失错误/状态信号影响 agent 决策，可在此骨架上替换 `generateDigest` 实现升级为结构化版本。

## 8. 数据模型

### 8.1 messages 表：新增 prev_message_id

```sql
ALTER TABLE messages ADD COLUMN prev_message_id INTEGER;
```

- `appendMessage` 时设为当前 session 最后一条 message 的 id，形成确定有序链表，独立于 timestamp。
- 可空：旧数据 NULL（按 `id` 排序兜底）；新数据必填（首条为 NULL）。

### 8.2 新增 compactions 表

```sql
CREATE TABLE IF NOT EXISTS compactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  anchor_message_id INTEGER NOT NULL,   -- 截至此 id（含）的消息已被压缩
  digest_content TEXT NOT NULL,         -- digest 消息的 JSON
  token_estimate INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
```

### 8.3 Session 恢复逻辑（restoreSession）

`session-runtime.ts:104` 现状：

```ts
agent.state.messages = agentStore.sessions.getSessionMessages(sessionId);
```

改为：

```ts
const latest = sessionStore.getLatestCompaction(sessionId);
if (latest) {
  const digest = JSON.parse(latest.digestContent);
  const tailRows = sessionStore.getMessagesAfter(sessionId, latest.anchorMessageId);
  agent.state.messages = [digest, ...tailRows.map(r => r.message)];
  this.liveMessageDbIds.set(sessionId, [0, ...tailRows.map(r => r.id)]);
} else {
  const rows = sessionStore.getSessionMessagesWithIds(sessionId);
  agent.state.messages = rows.map(r => r.message);
  this.liveMessageDbIds.set(sessionId, rows.map(r => r.id));
}
```

- 原始 messages 表全量不动（非破坏、可回溯）。
- compaction 记录 append-only，多次压缩可在表中累积（恢复只取最新一条）。
- restore 同步重建 `liveMessageDbIds` 并行表（见 §8.5）。

### 8.4 SessionStore 新增方法

```ts
appendMessage(sessionId, message): number;   // 返回新 row id（现状返回 void，改为返回 id）
recordCompaction(sessionId, record): void;
getLatestCompaction(sessionId): CompactionRecord | null;
getMessagesAfter(sessionId, anchorId): Array<{ id: number; message: Message }>;
getSessionMessagesWithIds(sessionId): Array<{ id: number; message: Message }>;  // 现有 getSessionMessages 的带 id 版
```

迁移：`prev_message_id` 加列（`applyMigrations` 已有列检查模式，见 `session.ts:44-47`）；`compactions` 表 `CREATE TABLE IF NOT EXISTS`。

### 8.5 liveMessageDbIds 并行表（SessionRuntime）

为支持 anchor 定位（§7.2）与 restore 重建（§8.3），SessionRuntime 维护：

```ts
private liveMessageDbIds: Map<string, number[]> = new Map();
```

- 与 `agent.state.messages` 一一对应、同序。
- digest 合成消息占位 `0`（非 DB 行）。
- 生命周期：`createSession` 初始化空数组；`restoreSession` 重建（§8.3）；`sendMessage` 的 `message_end` 用 `appendMessage` 返回的 id 追加；compaction 后同步裁剪（§7.2）；`destroySession` 清除。

## 9. Token 估算（token-estimate.ts）

```ts
export function estimateTokens(input: string | Message[]): number;
```

- 近似算法：按 CJK 密集（~1.5 字/token）与拉丁（~4 字/token）加权混合。不追求精确，追求单调性（比较用）。
- system prompt 与各 message 各自估算后求和。
- 不做 provider 区分（设计初版预留了 `_model` 参数但未实现差异化系数，已删除该死参数；未来需要精确计数可接 provider tokenizer API）。
- 单元测试覆盖单调性 + CJK/拉丁系数。

## 10. 修改范围

### 新增

| 文件 | 内容 |
|---|---|
| `packages/core/src/context/blocks.ts` | ContextBlock union + builders |
| `packages/core/src/context/serialize.ts` | serializeSystemPrompt |
| `packages/core/src/context/compaction.ts` | `planCompaction` + `generateDigest` + `wrapDigestContent` |
| `packages/core/src/context/token-estimate.ts` | estimateTokens |
| `packages/core/src/__tests__/context/*.test.ts` | 对应单元测试 |

### 修改

| 文件 | 变更 |
|---|---|
| `session-runtime.ts`（→ 后续拆分为 `session/live-session.ts`） | buildAgent 改用 ContextBlock 装配；sendMessage run 后调 `maybeCompact` 持久化裁剪；restore 按 compaction 还原。**不接 `transformContext`**（见 §3、§7.2） |
| `engine/read-context-files.ts` | 返回 `ContextFile[]` 而非 `string` |
| `store/session.ts` | 加 `prev_message_id` 列、compactions 表、相关 CRUD 方法；restore 逻辑 |
| `tools/load-skill.ts` | tool result 用 `<skill-content name="…">` 包裹 |
| `__tests__/engine/read-context-files.test.ts` | 适配返回值变更 |
| `AGENTS.md` | 登记 XML tag 注册表 + 上下文类型约定（§5.2） |

### 不变

- `types.ts`（AgentProfile / SkillDefinition 无需改）。
- 前端（压缩对 UI 透明）。
- `convertToLlm`（保持 identity 透传）。
- 其余 tool result 格式（write_file/edit_file 等短状态文本保持散文）。

## 11. 测试计划

| 测试文件 | 覆盖 |
|---|---|
| `context/serialize.test.ts` | 每个 block kind → XML 快照；空值/缺省省略；多 block 组合；转义 |
| `context/compaction.test.ts` | 阈值触发与不触发；anchor 选择（keepRecentTurns）；digest 内容规则（各 tool result 子类型裁剪）；ThinkingContent 丢弃；tail 完整保留；digest 为 user role |
| `context/token-estimate.test.ts` | 单调性；CJK vs 拉丁系数；Message[] 求和 |
| `__tests__/engine/read-context-files.test.ts`（改） | 返回 ContextFile[]；路径穿越跳过；权限拒绝跳过 |
| session-store 测试 | `prev_message_id` 链表写入；compactions 表 CRUD；`getMessagesAfter`；restore 按 compaction 还原 live buffer |
| session-runtime（→ live-session）测试 | buildAgent 输出 XML system prompt；sendMessage 后持久化裁剪；restore 含 compaction 分支 |

## 12. 不涉及 / 未来

- **LLM 摘要压缩**：本期 digest 是规则生成。未来替换 `generateDigest` 为 LLM 调用即可，骨架（planner + compactions 表 + transformContext + 裁剪）不变。
- **wire-level XML 注入**：未来可在 `convertToLlm` 里对 message 内容做 XML 包裹，本期保持 identity。
- **压缩可视化/可干预 UI**：未来可加"已压缩 N 轮"提示或手动解压。
- **更激进的压缩策略**：如按 tool type 差异化保留、语义聚类去重，留给后续迭代。
- **provider 精确 token 计数**：本期用估算；未来可接 provider tokenizer API。
