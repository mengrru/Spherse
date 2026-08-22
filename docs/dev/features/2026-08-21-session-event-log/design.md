# Session Event Log + 会话分支/撤回 设计

- 日期：2026-08-21
- 分支：`feat/session-event-log`
- 状态：PR1 已在 `feat/session-event-log` 实现；PR2 设计待实施（计划见同目录 plan-pr1.md / plan-pr2.md）
- 前置：`docs/dev/features/2026-08-19-core-kernel-refactor/`（微内核已合入）、`docs/dev/bugfix/2026-08-20-restore-orphaned-toolcall/`（repair 雏形已合入）
- 参考：已废弃分支 `feat/core-event-log-refactor`（其 P1 实现为本文的参考实现；P2 dispatcher 被微内核 EventPipeline/TurnHooks 取代，不再相关；P3 类型收归另行立项）
- 数据兼容：新会话走 events 表；旧 `messages`/`compactions` 表退役为只读，legacy 会话在首次可写 restore 时由 core 自动、幂等迁移

## 背景与动机

存储层从「消息快照」（`message_end` 时完整消息 JSON 写入 messages 表）迁移到「append-only 事件日志」。新内核（#19/#20）已解决状态单源（kernel MessageLog）、横切组合（EventPipeline/TurnHooks/streamDecorators）问题；event log 解决的是**历史作为数据**：

- **第一个消费者：会话分支 + 消息撤回**。snapshot 模型下 retry 破坏性删行、compaction 丢弃前史、撤回 truncate——被编辑掉的历史物理不存在，无法从任意历史节点 fork；event log 里它们都是 append 单条事件的非破坏性编辑（git 语义：branch 是引用不是拷贝）
- 顺带消灭 snapshot 模型的固有缺陷：崩溃孤儿 toolCall 的事后修复（现 `synthesizeInterruptedToolResults`）、审批 pending 崩溃残留的收敛基线（restore 合成 toolResult 自然收敛 UI 卡片）
- 为 roadmap 后续（圆桌事件多路 merge、回放调试）铺 vocabulary，但本次不为其设计任何字段

### 旧分支（feat/core-event-log-refactor）的处置

- 其 P1（events 表 + fold + repair + LiveSession 改造）在旧架构上实现，文件已结构性过时，仅作参考实现
- 其 P2（dispatcher waterfall）被微内核取代，废弃
- 其 P3（core 自有消息类型 + contracts 精确 schema）与本 feature 正交，迁移完成后另行立项

## 已确认的关键决策

| # | 决策 | 内容 |
|---|---|---|
| 1 | 分支建模 | **方案 A**：branch = 对父 log 前缀的引用（`parent_session_id` + `fork_seq`），fork 零拷贝 |
| 2 | 撤回 UI | 彻底隐藏；事件层留折叠占位余地（见 §撤回） |
| 3 | fork 粒度 | turn 边界（forkSeq 必须指向 `turn/end` 或干净收尾的 log 末尾） |
| 4 | PR 切分 | PR1 存储替换 + 自动迁移；PR2 分支 + 撤回 |
| 5 | legacy 迁移 | `SessionManager.restoreSession` 在所有可写恢复入口自动迁移；客户端不感知迁移状态 |

## §1 事件信封与词汇表

```ts
export interface SessionEvent<T extends SessionEventType = SessionEventType> {
  type: T;
  seq: number;   // 当前物理 session log 内从 0 连续递增，seq = 数组下标
  time: number;  // Unix epoch ms
  data: SessionEventMap[T];
}

export interface SessionEventMap {
  "turn/start":         {};
  "turn/end":           { reason: "completed" | "aborted" | "error" };
  "user/message":       { message: AgentMessage };
  "assistant/message":  { message: AssistantMessage };
  "tool/result":        { message: ToolResultMessage };
  "compaction/applied": {
    anchorSeq: number;
    digestContent: string;
    excludedSeqs: number[]; // sanitizeToolCallPairs 从保留 tail 排除的消息事件
  };
  "turn/retried":       { abandonedSeqs: number[] };
  // PR2 新增：
  "branch/created":     { parentSessionId: string; forkSeq: number };  // 子 log 首事件
  "message/recalled":   { boundarySeq: number };
}
```

设计取舍（沿用旧分支已验证的结论）：

- **不存 streaming chunk**：UI 重放基于完整消息，chunk 只走 WS 直播不落盘。`model-visible ⟺ logged` 不变量不受损
- **`tool/call` 不单独成事件**：toolCall 块内嵌在 `assistant/message`，单独存冗余；`tool/result` 独立因其时间上晚于 assistant 消息
- **turn/retried 带 `abandonedSeqs`**：显式记录被放弃的消息事件 seq，fold 精确跳过（比旧分支首版 `boundarySeq` 更准——retry 只放弃尾部失败的 assistant 消息，不是整个 turn 前缀）
- 词汇表由 `SessionEventMap` 单点定义；后续圆桌等消费者在此显式扩展字段与版本适配，不使用隐式 declaration merging
- PR2 分支拼接后另行生成虚拟 seq：父前缀保留原 seq，子本地 seq `n` 映射为 `forkSeq + 1 + n`；数据库中的子日志仍从 seq 0 开始

## §2 存储

```
.spherse/agents/{slug}/sessions.db
  ├── sessions   （保留：列表元数据；新增 parent_session_id / fork_seq / migrated_at 列）
  └── events     （新增：session_id + seq 联合主键，type TEXT，data JSON，time INTEGER）
```

- **写路径只有 events 表**：messages/compactions 表写方法全部删除，无双写过渡期；旧表只由迁移前历史读取与迁移原语访问
- better-sqlite3 同步写：`append()` 返回即已耐久（WAL）。写入序：内存追加 → 同步事务校验并 INSERT → 失败时回滚内存 → 整批提交后逐事件通知订阅者；listener 异常静默隔离，不影响已提交事实
- 读取方法：`readEvents(sessionId)`、`appendEvents(sessionId, events)`（迁移用单事务批量）、`maxSeq(sessionId)`
- sessions 表新列：`parent_session_id TEXT NULL`、`fork_seq INTEGER NULL`、`migrated_at INTEGER NULL`；legacy 判定还要求 events 为空且旧 messages 存在，空白新会话不需要迁移

## §3 fold——恢复即投影

PR1 已实现 `deriveMessages(events): AgentMessage[]`。PR2 将增加父日志解析与虚拟 seq 映射，再把拼接结果交给同一投影规则。

规则（自上而下扫描一遍 + 尾部投影）：

1. **拼接（PR2）**：若子日志首事件是 `branch/created`，递归取父 `seq <= forkSeq` 的前缀，再将子本地 seq 映射到父前缀之后；否则自身即全量
2. **找最后一个重启点**（whole-value 事件，last-wins）：
   - `compaction/applied` → 消息投影从 `[digest 消息, ...anchorSeq 之后的消息]` 开始，并跳过 `excludedSeqs`
   - `turn/retried` → 跳过 `abandonedSeqs` 列出的消息事件
   - `message/recalled` → 对最后一次 recall，保留 `boundarySeq` 之前的消息，隐藏 `[boundarySeq, recallEventSeq)` 内的旧消息，并继续投影 recall 事件之后的新消息（PR2）
3. **投影**：`user/message` / `assistant/message` / `tool/result` → 消息数组
4. **性能**：PR1 每次 fold 扫描当前内存事件数组，尚未实现增量缓存或持久化 checkpoint；长会话优化另行立项

digest 消息构造：`{ role: "user", content: wrapDigestContent(digestContent) }`——与现 compactor 行为一致。

## §4 repair——崩溃自愈（演进自已合入的 synthesizeInterruptedToolResults）

restore 时发现 open turn（有 `turn/start` 无后续 `turn/end`）：为日志尾部最后一个含 toolCall 的 assistant 消息中未应答的 toolCall 追加合成事件——`tool/result {message: "工具被中断，未执行", isError: true}` + `turn/end {reason: "aborted"}`（持久化，幂等：二次 restore 无 open turn 自然不触发）。无 turn 事件的日志（迁移产物）不触发 repair。

分支边界安全：forkSeq 锁定 turn 边界 ⇒ 父前缀必然干净收尾，repair 扫描不会跨父前缀产生误合成。

## §5 会话生命周期改造（AgentRunner）

- **MessageLog 退役**：`AgentRunner` 改持 `SessionEventLog`（内存 events 数组 + SQLite 同步写门面）。fold 是 durable state 的重建来源；restore、retry 和 compaction 等重启点后显式同步到 `agent.state.messages`，正常活跃 turn 由 pi 维护内存状态
- **sendMessage**：原子追加 `user/message` + `turn/start`，随后把已准备的 user message 交给 `prompt()`；不在每次追加后重新 fold
- **pi 事件翻译**（persist middleware 换落点）：`message_end`(assistant) → `assistant/message`；toolResult → `tool/result`；run 结束 → `turn/end {reason}`
- **retryLastTurn**：从 pop + 删行改为 `append turn/retried {abandonedSeqs: [失败 assistant 消息的 seq]}`；历史可回看重试前内容
- **compaction**：`maybeCompactLog` 的落点从 `recordCompaction` + 内存 compactLog 改为 `append compaction/applied {anchorSeq, digestContent, excludedSeqs}`；计划逻辑（planCompaction）不动，`excludedSeqs` 固化 `sanitizeToolCallPairs` 对保留 tail 的净化结果。锚点可能在父前缀（虚拟 seq 直接可用，PR2 场景）
- **initForRestore**：`logFromRows`/`logFromCompaction` 退役（compactor.ts 随之删除），改为 readEvents → repair → fold → 赋值
- **legacy 边界**：生产路径由 `SessionManager.restoreSession` 先自动迁移；`AgentRunner.initForRestore` 的 `MigrationRequiredError` 仅是 core 内部不变量守卫。迁移前 HTTP 历史读取仍可走 legacy 只读路径

## §6 分支（PR2）

- **创建**：`forkSession(agentId, sessionId, forkSeq)`——校验 forkSeq 是 turn 边界 → 子 session 行（`parent_session_id` + `fork_seq`）→ 子物理 log 以本地 `seq = 0` 写入首事件 `branch/created`；fold 时映射到虚拟 `seq = forkSeq + 1` → 子会话立即可聊
- **父后续增长不影响子**：子 fold 只读父 `≤ forkSeq` 前缀；父自己的 compaction/retry 事件 seq > forkSeq，子不可见
- **子的 compaction 锚进父前缀**：anchorSeq 用虚拟 seq，digest 落子 log，无需特判
- **嵌套分支**：fold 递归拼接，不做展平优化；深度有实际边界（用户操作产生）
- **UI**：user 消息气泡 hover 出「从这里分支」按钮（forkSeq = 该 user 消息所属 turn 的 `turn/end` seq）→ 创建后跳转子会话；session 列表平铺 + lineage 标记（父/子 badge），不做树状图
- **删除语义**：删父会话 = 归档父行，子不受影响（子已物化的前缀事件仍在父行内，但子 fold 依赖读父 events——**父 archive 不删 events 数据**，仅列表隐藏；物理清理推迟到「分支删除」单独立项）

## §7 撤回（PR2）

- **动作**：`recallMessages(sessionId, boundarySeq)`——`boundarySeq` 表示第一条被撤回的 user message，校验其所属 turn 边界后追加 `message/recalled {boundarySeq}`
- **fold**：保留该 seq 之前的消息，隐藏从该 user message 到本次 `message/recalled` 事件之间的旧消息；recall 之后新追加的消息正常投影，因此会话可继续
- **折叠占位余地**：事件数据已含完整信息（撤回点 + 被撤消息仍在 log 中），未来改占位渲染只需 UI 投影层读取 `message/recalled` 事件渲染「已撤回 N 条」标记，无需 schema 变更或数据迁移
- **撤回后可继续对话**：撤回 = 重启点，模型上下文从保留前缀继续，用户可改写消息重发；新事件位于 recall 事件之后，不受旧区间隐藏规则影响
- **UI**：user 消息气泡「撤回到这里」→ 确认（提示不可恢复模型上下文）→ 该消息及之后的消息隐藏、composer 聚焦

## §8 legacy 自动迁移（PR1）

```ts
migrateLegacySession(agentStore, sessionId): MigrationResult
```

- 迁移前先跑旧路径修复（synthesizeInterruptedToolResults 逻辑）保证旧消息序列配对完整，再转事件
- 旧 messages 行按原序 → `user/message` / `assistant/message` / `tool/result`；最新 compaction 锚点 → `compaction/applied`（digest 取旧 digestContent）
- **不合成 turn 事件**：迁移产物无 turn 事件是合法状态（fold 只投影消息；repair 只在有 open turn 时触发）
- 单事务：全部事件 + `migrated_at` 时间戳一次提交；旧表数据原样保留；幂等（已迁移直接 no-op）
- **内部边界**：`SessionManager.restoreSession` 在所有可写恢复入口统一执行幂等迁移，因此打开聊天、静默发送和 trigger 复用旧会话都会惰性升级后继续运行；迁移不暴露客户端 API 或状态字段

## §9 server / app 影响

- **server contracts**：迁移不新增 HTTP/WS contract；PR2 新增 `POST /sessions/:id/branch`、`POST /sessions/:id/recall`。WS 直播流协议不改（事件翻译在 AgentRunner 内，WS payload 仍是 pi 事件透传）
- **`getRecentTurns` 分页**：events 会话按 seq 窗口投影 turn；legacy 会话保留旧 messages 游标路径（只读不冲突）。HTTP 响应 shape 不变（`entries`/`hasMore`/`oldestId`——oldestId 语义变为 seq）
- **app**：撤回/分支按钮、lineage 标记；旧会话打开时由服务端 restore 自动迁移，streaming-store 的历史拉取不变（shape 兼容）

## §10 测试策略

- **fold 性质测试**：随机生成合法事件序列，断言「restore fold == 活跃态内存镜像」；重启点（compaction/retried/recalled）各自行为
- **repair**：open turn + 孤儿 toolCall 合成、完整 turn 不动、无 turn 事件（迁移产物）不动、fork 边界不跨父前缀
- **迁移**：旧消息序列 → 事件序列、幂等、迁移后 fold == 旧全量重放（含 compaction 锚点）
- **分支**：fork 后父子独立演化互不影响、子 compaction 锚父前缀、嵌套 fork、删父后子可读
- **撤回**：撤回后 fold、继续对话、二次撤回 last-wins
- **契约测试**：当前由 core 真实 runtime 测试钉住 restore 自动迁移；server/desktop 真实边界测试仍待补充
- **E2E**：chat 基本流程、断线恢复、retry、旧会话自动迁移、分支创建后双会话独立对话、撤回后继续对话（PR2 收尾跑 `verify:e2e`）

## 明确不做（本次）

- streaming chunk 落盘、projection 注册表
- 圆桌的 agentId 归属 / 事件多路 merge（词汇表留缝）
- 分支树状 UI、分支删除/物理清理
- 旧分支 P3 类型收归 + contracts 精确 schema（正交，另行立项）
- run-state 下沉（圆桌前置，followup #1）

## 风险与对策

| 风险 | 对策 |
|---|---|
| pi `agent.state.messages` accessor 赋值语义与 fold 同步边界 | 单向同步不变式已有（现 syncBufferFromLog），性质测试锁住「restore 后连续两轮对话」 |
| compaction digest 内嵌 pi 类型 | P1 原样内嵌（现状即如此）；类型收归立项时统一处理 |
| 事件 schema 演进 | events.data 是 JSON 列，每条持久化记录带 `schema_version` 列（v1 起步，读侧拒绝未来版本） |
| E2E 快照对消息顺序敏感 | repair 合成事件改变崩溃场景期望输出，同步更新 fixture |
| 旧会话用户无感升级 | restore 边界自动执行幂等迁移；旧数据永不删除（最坏情况回退读路径） |
