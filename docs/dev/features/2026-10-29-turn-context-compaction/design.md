# Turn Context 暴露 compaction 事件信息设计

- 日期：2026-10-29
- 状态：实现中（A 阶段核实测试先行，快照缺口测试红灯）
- 来源：issue #159 派单（Task d857b6dd）

## 背景与目标

用户反馈 debug 工具（Turn Context 弹窗）里"没发现有压缩相关 log"。核实结论：**事件日志列表侧不缺失，缺口在 turn context 快照侧**。

1. 快照 `TurnContextSnapshot`（core `session/types.ts`、contracts `debug.ts`）只有 sessionId/capturedAt/systemPrompt/messages/tools，压缩后 messages 只剩 digest 文本，无法判断"何时压缩、压缩到哪、丢掉哪些 seq、摘要来源"。
2. 目标：快照暴露最近一次 `compaction/applied` 元数据 + 会话累计压缩次数；弹窗标题下增加一行压缩状态；下载 JSON 自动包含。

## 核实证据（A 阶段，先于实现完成）

### 事件链路是通的（列表侧不缺失）

- 真实压缩路径：每轮 `agent.prompt()` resolve 后 afterTurn hook 调 `maybeCompactLog`（`capabilities/compaction/transform.ts:12`），成功时 `eventLog.append("compaction/applied", { anchorSeq, digestContent, excludedSeqs, digestSource })`（`transform.ts:60-65`），信封 `{ seq, time }` 由 `SessionEventLog.appendBatch` 自动分配（`session/event-log.ts:32-38`）并同步写 SQLite events 表（`store/session.ts:231-258`）。
- 确定性测试 `agent-runner.test.ts` "compaction/applied is persisted and surfaced through the debug event read path"：构造 25 对消息 + `contextWindow=10` 触发真实压缩，断言事件 payload 完整、SQLite 持久化、`sessionRuntime.readSessionEventsAfter`（debug events 端点数据源）返回该事件。修复前即通过。
- UI 预览：`event-log-display.ts:91-92` 已渲染 `anchorSeq + digestContent` 片段（badge secondary，`event-log-display.ts:11`）。新增 `event-log-display.test.ts` 与 dialog 渲染测试，修复前即通过。

### 缺口证据（快照侧）

- 测试 "getTurnContext exposes the latest compaction metadata and count" 修复前红灯：`snapshot.compaction === undefined`。

### "平时看不到压缩 log" 的 blocker（逐条代码证据，与预核一致）

| Blocker | 证据 |
|---|---|
| 双门阈值：两条门都通过才继续——token 门（`currentTokens > 0.75×window`，严格大于）+ 计数门（非 digest user > 20 **或** assistant > 40，任一计数超限即过计数门）；任一门不过即静默 return | `context/compaction.ts:102`（`currentTokens > contextWindow * thresholdRatio`）、`:113`（`promptCount <= keepRecentPrompts && turnCount <= maxTurns` 时跳过）；`transform.ts:26-27` 不传参即走默认 20/40/0.75 |
| 锚点无效静默 return | `transform.ts:29-30`（`anchorSeq === undefined`） |
| LLM 摘要不可用且未过 0.9 硬限时仅 warn 后跳过 | `transform.ts:52-54`；摘要失败情形见 `capabilities/compaction/summarize.ts`（model/streamFunction 缺失、error/aborted、<50 字符退化、60s 超时、stream 抛错） |
| 任何异常被吞（仅 error log） | `transform.ts:77-79` |
| 快照接口要求活跃 runner | `session-manager.ts:176-180` `getTurnContext` 只查内存 sessions map，无 db 回退，未加载会话抛 `NotFoundError`→404；对比 events 端点有 db 回退（`session-manager.ts:195-202`） |

结论：真实会话很少达到双门阈值，看不到压缩事件多为**符合设计的正常现象**，非事件丢失。

## 决策

| 决策点 | 结论 |
|---|---|
| 快照字段 | `TurnContextSnapshot` 新增 `compaction: CompactionSnapshotMeta \| null` 与 `compactionCount: number`；meta = 最近一条 `compaction/applied` 的 `{ seq, anchorSeq, digestSource, excludedCount, digestLength, appliedAtMs }`，**不复制 digest 正文**（messages 里已有）；多条只暴露最近一条 |
| digestSource 可空性 | 事件 payload 中 `digestSource?` 可选（legacy 迁移事件可能缺省），快照统一 `("llm" \| "mechanical" \| null)`，缺省映射 `null`，不引入 optional 字段 |
| 派生位置 | core 纯函数 `compactionSummaryFromEvents(events)`（新文件 `session/compaction-snapshot.ts`）从事件信封+payload 派生，`AgentRunner.getTurnContext` 消费 `this.currentEvents`；对 legacy 数据做防御（非数组 excludedSeqs / 非字符串 digestContent 记 0，digestSource 缺省记 null），直测畸形输入锁定 |
| contracts | additive：`turnContextSnapshot` 新增两个**必需**字段（compaction 为 union[meta, null]），既有字段不动；严格 `parseContract` 对缺字段负向用例锁定。快照每次由 core 现构建，无旧 payload 兼容问题（符合"持久化格式兼容只针对已发布数据"红线：本字段不入库，不涉及迁移） |
| 弹窗状态行数据源 | **从已加载的 events 派生**（`event-log-display.ts` 新增 `compactionStatusFromEvents`），不额外请求快照：events 链路有 db 回退（冷会话也可用），快照链路要求活跃 runner；两者同源于同一事件日志，活跃会话下一致 |
| UI 侧防御 | `debugSessionEvent.data` 契约上是 `Unknown`，`compactionStatusFromEvents` 逐字段 typeof 守卫（数字/数组/字符串），非法输入与 core 侧同规则记 0 / null；两侧测试锁定相同的畸形输入→输出映射 |
| 状态行 UI | DialogHeader 下新增一行 `text-xs text-muted-foreground break-words min-w-0`，未压缩显示"未压缩"；有值显示 最近一次压缩 seq/锚点/来源/排除条数/摘要长度 + 累计次数；`digestSource` 为技术枚举值原样展示（llm/mechanical），null 显示 "—"；窄屏换行不溢出 |
| i18n | 走 i18n skill 流程更新三语 catalog；key：`debug.compactionNone` / `debug.compactionLast`（占位符 `{seq}` `{anchorSeq}` `{source}` `{excludedCount}` `{digestLength}`）/ `debug.compactionTotal`（占位符 `{count}`），三语占位符变量名一致 |
| 不做 | 不新增事件类型、不改 SessionEventLog/store schema、不改压缩阈值与 keep 策略、不做"本轮为何未压缩"运行时诊断通道（需新状态通道，独立任务）、不做历史压缩列表 UI、不改 chat wire 协议 |

## 各层实现

| 文件 | 变更 |
|---|---|
| `packages/core/src/session/types.ts` | + `CompactionSnapshotMeta`；`TurnContextSnapshot` + `compaction` / `compactionCount` |
| `packages/core/src/session/compaction-snapshot.ts` | 新纯函数 `compactionSummaryFromEvents` |
| `packages/core/src/session/agent-runner.ts` | `getTurnContext` 并入 compaction 摘要 |
| `packages/contracts/src/debug.ts` | + `turnContextCompactionMeta` schema；`turnContextSnapshot` additive 扩展；导出类型同步 |
| `packages/contracts/src/index.ts` | re-export 新类型 |
| `packages/app/src/features/debug-tools/event-log-display.ts` | + `compactionStatusFromEvents`（展示派生，含 count） |
| `packages/app/src/features/debug-tools/TurnContextDialog.tsx` | 标题下压缩状态行（events 加载后渲染） |
| i18n | `debug.compactionNone` / `debug.compactionLast` / `debug.compactionTotal`，三语，zh-CN canonical 逐条注释 |

## 测试

- core `agent-runner.test.ts`：无压缩 → null/0；一次压缩 → meta 逐字段等于事件派生值且无 `digestContent` 键；两次压缩 → count=2 且取最近一条；A1 的 debug 读取路径测试
- core `compaction-snapshot.test.ts`：纯函数直测 legacy/畸形输入（digestSource 缺省 → null、excludedSeqs 非数组 → 0、digestContent 非字符串 → 0）
- contracts `api-contracts.test.ts`：正向（compaction null / meta 各一）+ 负向（缺 compactionCount、compaction 类型错、digestSource 非法值）
- server `debug-routes.test.ts`：events 端点透传 compaction 事件；turn-context 端点新形状 200、缺字段 parse 失败 500（现有 events/400 用例不动，getTurnContext mock 随新用例同步为新形状）
- app：`event-log-display.test.ts`（preview/badge/状态派生：null、有值、两次取最近+count、畸形 data 防御）；`TurnContextDialog.test.tsx`（状态行 null/有值渲染、两条压缩事件 → count=2 取最近、compaction 事件行渲染；download 用例 mock 换新形状并断言 blob 内容含 `compaction`/`compactionCount`）

## 风险

- 严格 schema 落地后会红的三处测试基线：contracts 既有正向样本 `api-contracts.test.ts:578-588`（旧 5 字段缺新必需字段，必改）；server `debug-routes.test.ts` mock 与 app fixture 为建议性同步更新（app 直接 mock ApiClient 绕过 parseJsonResponse，不更新不会红，只为形状真实）
- `compactionStatusFromEvents`（UI）与 `compactionSummaryFromEvents`（core）语义平行实现：前者消费 wire 契约的 Unknown data、后者消费强类型事件；两侧对畸形输入的同规则输出由各自测试锁定，避免漂移
