# Chat 前端重写：日志副本模型（Log-Replica）+ 分层渲染演进

- 日期：2026-09-03
- 状态：PR-A（协议先行）与 PR-B（app 副本切换）已实现；PR-C（渲染层 part 化）待立项（v2 合并稿；sub agent review 16 条已处理：resend 复合限定已落库失败对、ApprovalNoticeBridge/store 字段面/setStreaming 侧带传播补进兼容面、notices 清除补兜底、settle 所有权交接显式化、legacy 快照条目与事件 seq 命名空间隔离、ws-chat.ts 入改动清单等）
- 来源：合并评审稿 `design/chat-replica-rewrite-q2m8`（日志副本模型，15 条 review 反馈已处理，全部继承）与渲染层演进分析两个正交轴；相对评审稿的修订以【v2】标注，未标注处为全盘采纳。本稿取代评审稿，其分支不再合并（避免同目录冲突）
- 依赖：#81（runtime 重构）、#82（页覆盖回补 + investigation 文档与 backlog H1 条目）先行合并——本设计删除 #82 大部分产物，属预期演进；文中引用的 investigation 路径与 `coverLoadedWindow` 等符号在 #82 合并后生效
- 前置调研：`docs/dev/investigation/2026-09-02-chat-user-messages-cluster/README.md`（#82 分支）

## 背景与问题

现行 chat 前端的结构性缺陷分布在两个正交的轴上：

**状态轴（评审稿已诊断）**：主状态是投影（`ChatMessage[]`）而非事件知识。服务端早已 event-sourcing（`SessionEventLog` append-only + `deriveHistoryEntries` 投影），前端只能看到日志的两个有损视图——分页投影（REST）与瞬态事件（WS）——并用启发式缝合：内容全等匹配（`mergeHistoryMessages` 的 `historyUserContents`）、`_optimistic`/`_messageId` 标记、整个合并层。已修复的 user 消息堆叠与 H1 丢流式回复都是该缝合层的结构性缺陷。

**渲染轴（v2 补充诊断）**：`ChatMessage` 是 closed struct，13 个 `_` 前缀 flag 内联投递/错误状态；消息内容在入口被 `extractMessageText` 压成字符串（销毁了 wire 上 part 化的结构，工具调用又靠平行事件重建）；卡片分发 hardcode 三处（reducer 内联构造 / `chat-tool-projection` / `MessageItem` if 链），新增卡片类型 = 4 处 shotgun surgery；`MessageList` 以 index 为 key 且全链无 memo，流式期间每帧全列表重渲染、每条历史消息全文重跑 react-markdown。

**本质模型**：chat = 单一事实源（服务端 append-only 日志）+ 只读副本（客户端三区状态）+ 乐观写（pending intents）+ 纯投影渲染（fold → derive → registry）；「流式」是日志未落盘前缀的实时预览，「重连对账」是副本水位线追赶。渲染层更新呈双峰分布——热路径（最后一条消息的一个 text part，60fps 全量替换，无结构变化）与冷路径（结构变化，人类时间尺度）——正确的抽象应让**失效粒度对齐变化粒度**。

**两阶段策略**：Phase 1 重写状态层（协议 v2 + 副本状态机），UI 冻结面收窄为 props 契约 + DOM 钩子；Phase 2（§Phase 2 路线图）把渲染层从扁平 `ChatMessage[]` 契约迁到 part 化文档 + 注册表。`ChatMessage[]` 因此是**阶段性边界而非终态契约**，Phase 1 冻结期内禁止为其新增 `_` 字段。

## 决策

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 抽象 | 前端会话状态 = 三区副本 `SessionReplica = { durable, run, pending, notices }`。`durable` = 已确认事实（**原始条目** `(seq, message)` 有序集 + 窗口水位线，只做 seq 插入/删除，永不按内容合并）；`run` = 进行中 run 的瞬态块（块状态机）；`pending` = 乐观写意图（客户端 intentId，等待确认帧）；`notices` = 客户端本地注记（错误横幅 / withdraw 失败标记，跨重连存活）。渲染 = 单向派生 `render(durable) ++ render(run.blocks) ++ render(pending)`，durable 的派生**在视图层完成 run 作用域聚合**（见 #8） |
| 2 | 协议 | WS 升级为 v2：新增**确认帧**词汇 `message_settled { seq, message, intentId? }`（覆盖 user/message、assistant/message、tool/result 三类，按 `message.role` 区分）、`turn_withdrawn` 增 `upTo`、`turn_retried { seq, abandonedSeqs }`。瞬态词汇不变，唯 `message_end` 增可选 `seq`（见 #4）。【v2】命名落定 `message_settled`（与块生命周期术语对齐，评审稿开放问题 #2 关闭） |
| 3 | intentId | 客户端 WS `message` 帧增 `intentId`（客户端生成唯一 id，实现用 UUID）→ `SendMessageMeta.intentId` → 写入 `user/message` event data（additive 可选字段，与 `source`/`triggerName` 同模式，`EVENT_SCHEMA_VERSION` 不升版）→ `deriveHistoryEntries` 投影带出 → 确认帧回显，pending 按其确认。**REST 发送（`startDetachedRun` / ui-sdk 降级路径）不建 pending**，消息经确认帧到达（跨客户端可见性天然覆盖）；REST 契约不加 intentId |
| 4 | 确认帧发射点与顺序 | 【v2 修订，取代评审稿「瞬态先于 echo」的邻接配对】`AgentRunner.persistMiddleware` 现状即 append 先于 `next(event)`（agent-runner.ts:422-445），改造为：`appendMessageEvent` 返回带 seq 的 `SessionEvent`，瞬态 `message_end` 携带该 seq 下发（`next({ ...event, seq })`；persistMiddleware 是 pipeline 末位，capability middlewares 仍见原始 pi 事件），紧随其后发射 `message_settled`（同一 publish 链路，WS 保序）。客户端**对确认帧幂等 fold**：`message_end{seq}` 与 `message_settled{seq}` 是同一事实的两种帧型，先到者入 durable、后到者 no-op。`user/message` 在 `sendMessage` appendBatch 后、pipeline 创建前经 onEvent 直发 `message_settled`（无对应瞬态事件） |
| 5 | withdraw / retry 确认帧 | 改造：`AgentRunner.withdrawLastTurn` 返回 `{ seq, upTo }`（现返回 user seq；`upTo` = `turn/withdrawn` 自身事件 seq，撤回区间 `[seq, upTo)` 与 fold.ts `collectAbandonedSeqs` 语义一致），`SessionManager` 透传，hub 广播 `{ type: "turn_withdrawn", seq, upTo }`。`turn_retried` 在 `retryLastTurn` appendBatch 后经 onEvent 发射。withdraw 在 run 中被拒绝（不入 `runEvents`），重连客户端经 tier ② 追赶 |
| 6 | 断线续传（三层） | ① hub `runEvents` replay（短缺口；确认帧随 buffer 记录重放）；② `GET .../sessions/:id/events?since=&limit=`（确认帧词汇，cap 200 + hasMore 续拉），端点经 hub channel `await ready` 后读，保证 restore（含 `repairLog` 追加的修复事件）先于读取完成，消除修复事件丢失窗口；③ 分页快照（冷启动 / 大缺口）**范围替换**：只替换 `[snapshot.oldestSeq, ∞)` 区间，保留已加载的更早前缀（seq 有序插入天然支持），不破坏向上滚动的已加载历史与滚动位置。【v2 补充】快照后若存在已载前缀且 `snapshot.oldestSeq > highSeq + 1`（中间留洞），先 tier ② 补 `[highSeq+1, snapshot.oldestSeq)`，失败则丢弃前缀（诚实降级，不留隐形洞）。【PR-B 实现修订】初始快照为完整最新页 + loadMore 连续前插 + 范围替换保留前缀，三者共同保证 durable 覆盖区间内无洞，洞修补路径未实现；唯一洞来源（legacy→migration seq 重启）由水位线失效全量重同步兜底 |
| 7 | 水位线不变量 | `durable.highSeq` 单调不减。【v2 修订】失效判定**只适用于 live 确认帧**：出现 `seq ≤ highSeq` 且 durable 中不存在的条目 → 该帧仍插入 + 记录缺失 seq → 水位线失效 → 全量快照重同步；tier ②/tier ③ 来源与 live 的交错乱序是**预期多源并发**，宽松插入不告警（PR-B 修订：tier② 响应在途时新消息先经 live 到达属正常）；已存在 seq 的重复帧 = 幂等 no-op。`loadMore` 反向分页条目天然 `seq < highSeq`，按设计插入水位线以下，不触发。该规则统一覆盖 legacy 会话迁移后 seq 从 0 重启（events 端点对未迁移会话返回 `410` + 原因，客户端转快照模式、highSeq 置空直到出现事件化数据）与任何异常乱序。【v2 补充】快照模式下 legacy 条目（REST 消息 id）与事件 seq 无同源关系，共享 `(seq, message)` 有序集会撞车：快照模式会话**首次收到事件化数据（live 确认帧或 tier ②）时全量丢弃快照条目**再按事件追赶，highSeq 自首个事件建立 |
| 8 | durable 折叠 | durable 只存原始条目并按 seq 插入/删除（`turn_withdrawn` echo 删 `[seq, upTo)`，`turn_retried` echo 删 `abandonedSeqs`）——纯且平凡。**tool/result 对 assistant `_toolCalls` 的增强（toolResultMap / 卡片）与 run 边界文件变更聚合（`aggregateFileChanges`）不进 durable，移到视图派生**：对可见窗口按 run 边界分 memo 重算（复用 `chat-history.ts` 既有函数，从「页级」改为「窗口 run 级」调用） |
| 9 | run 尾模型 | 块状态机：`RunBlock = draft \| tool(+card) \| question \| approval \| error`，生命周期 `streaming → settled(seq) \| failed \| aborted`。**复用** `chat-session-reducer` 的投影逻辑（tool 卡/control 卡/错误分类原样保留），从「平铺数组 patch」改为「run 作用域块归约」。【v2 修订】块 settle 匹配 = **seq 相等**（瞬态 `message_end{seq}` 即确认帧，块在瞬态到达时即刻 settle，settle 延迟与 echo 解耦），评审稿的「run 内按序 + role 匹配 + 内容回退」删除，开放问题 #1（依赖 pi message id）随之关闭。**settle = 所有权交接**：块 settle 即出 `run.blocks`、条目由 durable 承接渲染，`run.blocks` 只含未 settle 块，三区渲染拼接无重复；仅收到漏瞬态尾的 `message_settled` 时的 draft 兜底关闭限定在当前 run 作用域（seq > run 起点水位线）。abort 保真：中止的 draft 块 settle 为 `aborted`（内容保留显示），重连后随 run 区丢弃——与现状 reconcile 行为一致，非回归；aborted partial 是否产生持久化事件以契约测试锁定现行为 |
| 10 | notices | 瞬态 `error` 事件（无持久化对应物：conflict / model 未配置 / 纯错误气泡）与 withdraw 失败进入 `notices: { kind: "error" \| "withdrawFailed", bornAtSeq, message, code? }`，跨重连存活。【v2 修订】清除规则不依赖 runId（瞬态 error 帧现无 run 标识，加 runId 属协议蔓延）：notices 在 durable 收到 `bornAtSeq` 之后的持久化 error turn（`stopReason === "error"` 的 assistant 条目）或覆盖区间的删除帧时清除；**兜底**：同 session 后续任意 user message settle 成功即清除同类 error notice（覆盖「错误无持久化对应物、修复后滞留」的窗口）。派生视图据此渲染错误横幅并抑制对应轮 retry——`flagWithdrawError`/`_withdrawError` 语义保留，落点从消息标记改为注记 |
| 11 | resend 语义 | `planRetry` 的 resend 变体改为 **withdraw + send 复合**，且**仅当失败对已落库**（durable 中存在该 user 轮及其 error 条目）：先 withdraw（服务端 `turn/withdrawn` 落库隐藏失败对）再发新消息；withdraw 被拒（前置校验失败）时回退纯 send——失败对保留在 durable（诚实历史），不回退今日「本地隐藏、reconcile 复活」的矛盾行为。**pending intent 失败（发送未成功、无持久化对应物，现 `_sendFailed` 场景）的重试 = 纯 send**（rebuild intent），禁止触发 withdraw——否则服务端校验通过、静默撤回上一个健康 turn。`retry-plan` 收敛时删除 `_sendFailed` 分支，该场景移交 intents 层 |
| 12 | 兼容面（消费方逐一迁移） | `useChatSession` 公共 action 面保留（`sendMessage/retry/withdrawLastTurn/abort/reconnect/respondApproval/respondQuestion/loadMore`）；`refreshHistory` 降级为内部 `resync()`（= tier ② 拉取），**`TriggerEventBridge` 改调 resync**（attached 会话本已实时收确认帧，resync 只作兜底）；resync 失败沿用对账失败语义（从未 ready 的会话才置 `historyError`，曾 ready 的静默保持 ready）、`retryHistory` 转调 resync——`ConnectionBanner` 的 `historyError`/`onRetryHistory` props 契约不变。**`ApprovalNoticeBridge` / `collectPendingApprovals`**：审批卡现位于 run overlay（派生进 `messages` 缓存），bridge 继续扫描 `sessions` 记录的派生 messages，行为保留（store 导出名收敛为 `useReplicaStore`）。**store 字段面**：绕过 hook 的裸读取（`hasMore`/`loadingMore`、`scrollPosition`、`streaming`、`messages`）在 replica-store 的 session 记录上保留等价扁平字段或选择器，PR-B 内逐一对齐而非边实现边发明契约。**`useProjectDataStore.setStreaming` 侧带传播**（现 6 处调用点）在新 store 收敛为单一传播点重接，不因选择器化而静默丢失。`ui-sdk/handlers/send-message.ts` 的 REST 降级路径不变（无 pending，见 #3）；`web-resume-probe` / `useChatScroll`（scrollPosition 留 session 记录）/ `chat/index.tsx` loadMore 不变 |
| 13 | 协议兼容 | 不做版本握手。确认帧为新增事件类型 + additive 字段；v1 客户端 parser 对未知事件 try/catch 跳过（现行为），v2 server + v1 client = v1 行为。桌面与 web 同源发布，偏差仅缓存 PWA（告警噪音接受） |
| 14 | 状态机纯化 | `reduce(state, frame) → state` / `plan(state, command) → frames` 均纯函数。**frame 词汇含内部生命周期帧**（`connected/disconnected/fatalClosed/replayCompleted`——现 onclose 清 `_streaming`、缓冲 gating 等传输层状态迁移全部入帧）；核心测试不再需要 MockWebSocket |
| 15 | 作用域 | 重写 runtime/model/store 层；UI 组件层冻结面 = **props 契约 + `data-chat-*` 主题钩子**。【v2 修订】React 内部机制不在冻结面内——`MessageList` key 由 index 改为派生层提供的稳定 key（`seq` / `intentId` / 块 id），直接消灭重挂载债（折叠态/滚动锚定不再丢失），而非引用 backlog。传输层（心跳/探活/重连退避、TTL 会话缓存、attach 生命周期）与 rAF 批处理原样保留。`ChatMessage[]` 为 Phase 2 阶段性边界：冻结期内禁止新增 `_` 字段，派生辅助数据（稳定 key）走独立通道（见 §app 实现第 12 条） |

## 契约

### WS server → client（新增/扩展）

```jsonc
// 确认帧：已落库事实。与 message_end{seq} 幂等等效，客户端按 seq 去重
{ "type": "message_settled", "seq": 42, "message": { /* AgentMessage */ }, "intentId": "01J…" }  // intentId 仅 user/message 携带
{ "type": "message_end", "message": { /* … */ }, "seq": 42 }  // seq 可选；assistant/toolResult 携带其落库 seq
{ "type": "turn_retried", "seq": 50, "abandonedSeqs": [45] }
{ "type": "turn_withdrawn", "seq": 40, "upTo": 44 }  // upTo = turn_withdrawn 自身 seq，撤回区间 [seq, upTo)
```

### WS client → server（扩展）

```jsonc
{ "type": "message", "content": "…", "attachments": [], "intentId": "…" }  // intentId 可选（客户端生成唯一 id）
```

### REST（新增）

```
GET /api/projects/:projectId/agents/:agentId/sessions/:id/events?since=<seq>&limit=200
→ 200 { events: Array<message_settled | turn_withdrawn | turn_retried>, hasMore: boolean }
     （确认帧词汇同 WS；经 hub channel await ready 后从 log 投影，跳过非消息/非 turn 标记事件）
→ 410 { reason: "legacy-unmigrated" }（未迁移会话；客户端转快照模式）
```

## 各层实现

### contracts

1. `websocket.ts`：`chatServerEvent` union 增 `message_settled` / `turn_retried`，`turn_withdrawn` 增可选 `upTo`，`message_end` 增可选 `seq`；`chatClientMessage` message 增可选 `intentId`。payload 保持 `Type.Unsafe`（server 透明转发原则不变）
2. `sessions.ts`：`sessionEventsResponse`（含 410 语义）

### core

3. `session/events.ts`：`SendMessageMeta` 与 `user/message` data 增 `intentId?: string`
4. `session/agent-runner.ts`：`appendMessageEvent` 返回带 seq 的 `SessionEvent`；`persistMiddleware`（pipeline 末位）对 assistant/toolResult 的 `message_end` 以 `next({ ...event, seq })` 下发、随后经 onEvent 发 `message_settled`；`sendMessage` 在 appendBatch 后、pipeline 创建前经 onEvent 直发 user `message_settled`；`withdrawLastTurn` 返回 `{ seq, upTo }`；`retryLastTurn` appendBatch 后经 onEvent 发 `turn_retried`
5. `session/fold.ts`：`projectMessageEvent` 带出 `intentId`（`DerivedMessageEntry` 增可选字段）
6. `session-manager.ts`：withdraw 返回值透传
7. `project-manager.ts`：`getSessionEventsSince(agentId, sessionId, since, limit)`（未迁移 → 显式标记供 route 返回 410）

### server

8. `chat-session-hub.ts`：withdraw 广播带 `upTo`；提供 `readEventsSince`（经 channel await ready / 必要时触发 restore 后读）；`ChatSessionAttachment.sendMessage` 签名增 intentId 透传
9. `ws-chat.ts`：客户端 `message` 帧 `intentId` 校验与透传；出站帧经升级后的 `parseChatServerEvent` 校验（contracts 先行是硬前置）
10. `routes/sessions.ts`：events 端点（契约绑定 + 410）

### app（重写层）

```
features/chat/
  replica/
    session-replica.ts   # 纯状态机：reduce(state, frame) / plan(state, command)
    durable.ts           # (seq, message) 有序集 + 水位线不变量（#7）
    derive.ts            # 视图派生：run 边界 tool 增强 + 文件聚合 + notices 合成 + 稳定 key
    run-tail.ts          # run 块归约（自 chat-session-reducer 改造）
    intents.ts           # pending 三态（sending/failed/acked）
    notices.ts           # 本地注记
    sync.ts              # 三层追赶编排（successor of history-reconciler）
  runtime/
    chat-session-runtime.ts  # 纯传输壳（协议 v2；生命周期发内部帧）
    chat-runtime-registry.ts
  replica-store.ts       # 薄 store：sessions + 生命周期 + 选择器（useChatSession 面兼容）；rAF 批处理保留
  model/                 # 保留：chat-history（解析函数复用进 derive）、chat-tool-projection、classify-error、
                         #       turn-groups、approval-notice、retry-plan（resend 改复合后收敛）、withdrawable
                         # 删除：mergeHistoryMessages、settlePendingWithdraw、#82 回补循环
```

11. 初始消息：attach 前的 initialMessage = 排队 pending intent；`takeInitialMessage`/`initialMessageSent` 消失
12. derive 输出：keyed 条目 `Array<{ key: string; message: ChatMessage }>`（key = `seq:` / `intent:` / `block:` 前缀 + id），`MessageList` 与 `TriggerTurnGroup` 分组 key（现 `message._messageId ?? index`）统一改吃该 key 通道。选择器面：`messages: ChatMessage[]`（keyed 投影，`useChatScroll` 等旧消费方不变）与 keyed 选择器并行；key 通道独立于 `ChatMessage` 结构体，Phase 2 迁移时原样沿用
13. 命令：`sendMessage` → intentId → pending + WS 帧；失败/超时/error → intent failed（SendFailedBar 无感）；`withdraw`/`retry`（含 #11 复合）/`abort`/`respond*` → plan 产出帧
14. 选择器：`messages` = derive 三区拼接；`streaming` = run.active ∥ pending.sending；`connectionStatus` 不变

## Phase 2 路线图：渲染层 part 化（独立 PR，实施另立 design）

动机：Phase 1 修复状态轴后，渲染轴四债仍在（closed struct、三处 hardcode 分发、无 memo、全文重 parse），且 `derive.ts` 的建立恰好为渲染层迁移提供了单一接缝。

1. **文档模型**：derive 输出从 `ChatMessage[]` 迁至 part 化 `ChatDoc`：`Turn { id, delivery?, messages } → Message { id, role, parts } → Part`；`Part = text { rev } | tool { rev, toolName, args, status, card? }`，id = `seq` / `toolCallId`，`rev` 随更新自增。wire 上 `AssistantMessage.content` 本就是 part 数组，Phase 1 的 durable 原始条目天然保留该结构——Phase 2 只是不再在派生时销毁它
2. **渲染注册表**：`ToolProjection { match(toolName), project(事件/结果) → card?, Component }` 单点注册，取代三处 hardcode；新增卡片类型 = 一个注册项
3. **失效粒度对齐双峰分布**：`MessageItem` memo + 稳定 key + part 级引用复用（derive 对未变部分返回原引用），流式期间每帧失效集合 ⊆ {最后一条消息的最后一个 text part}；该性能不变量写进测试
4. **流式 markdown 增量解析**：完成前缀按 `\n\n` 边界切 stable block（按内容相等 memo）+ 尾部 live block，仅 live block 每帧重 parse
5. **envelope**：`delivery ∈ pending | failed | sent | withdrawn` 由 pending/notices 区投影，取代 `_optimistic/_sendFailed/_error` 系 flag 的取证式推断

Phase 1 为其预留的接缝：derive 单一出口、稳定 key 通道、`ChatMessage[]` 冻结不加字段、durable 保留原始 part 结构。

## 删除清单（收益对账）

| 删除 | 理由 |
|---|---|
| `mergeHistoryMessages` + 内容全等匹配 | seq + intentId 取代 |
| #82 页覆盖回补循环（`coverLoadedWindow` / `refreshWithCoverage`） | durable 按 seq 更新，无覆盖假设 |
| `settlePendingWithdraw` / `flagWithdrawError` / `pendingWithdraw` | `turn_withdrawn {seq, upTo}` 原子处理；失败语义移 notices |
| `_optimistic` 悬挂与 reconcile 赌约 | pending 三态 |
| echo↔块内容回退匹配（评审稿 #9）【v2】 | seq 相等精确匹配 |
| H1 已知问题（backlog 条目） | 确认帧 + tier ② 结构性消灭丢回复窗口 |
| `historyStatus` 双态大部分语义 | sync 编排内化，对外仅 loading |
| MessageList index key 重挂载（backlog 条目）【v2】 | 稳定 key（seq）落地 |

保留：传输 runtime 全套、TTL 会话缓存、attach 生命周期、UI 组件层与主题钩子（props/DOM 契约）、model/ 纯函数多数、rAF 批处理。

## 测试

- **replica 状态机（核心，纯函数帧序列）**：确认帧幂等（`message_end{seq}` 与 `message_settled{seq}` 任意顺序/重复到达）、intent 确认与失败、**pending 失败重试 = 纯 send 不触发 withdraw**（#11 回归防护）、withdraw/retry 区间删除、块生命周期（draft / tool 卡 / control 卡 / aborted 保真）、**settle 所有权交接**（块出 run 区、durable 承接，无重复渲染）、水位线违反（前向来源）→ 全量重同步、`loadMore` 反向插入不触发、**legacy 快照条目首次事件化数据到达时全量丢弃**、notices 生存期与清除（含 user settle 成功兜底）、内部生命周期帧、replayCompleted gating
- **settle 穿越不变量【v2】**：同一帧序列下，run 块渲染输出 ≡ durable 派生渲染输出（golden test，tool 卡/control 卡/文件聚合在两条路径上的字段逐一相等——防双路径漂移）
- core：确认帧发射顺序（瞬态 `message_end{seq}` → `message_settled`，user 在 pipeline 前）、intentId 落库与 `deriveHistoryEntries` 带出、withdraw `{seq, upTo}` 区间语义、aborted partial 持久化行为锁定——**PM 门面契约测试（红线：server/desktop 各至少一条不 mock 被测方法）**
- server：确认帧广播至全体订阅者（含 detachedRun）、runEvents replay 含确认帧、events 端点契约（since 边界 / cap / hasMore / 410 legacy / channel-ready 后含 repairLog 事件）
- app：sync 三层选择与降级（含 #6 洞边界）；既有行为套件（withdraw / retry 两变体 / reconnect / resume-probe / probe 超时）以帧序列重表达；#82 的 A/B/C 堆叠场景与 H1 场景转回归用例；**`collectPendingApprovals` 经「全缓存会话派生视图」选择器的行为保留测试**（后台 session 审批 toast）
- UI 组件层零改动 → 现有组件测试原样通过作为兼容性证明（key 变更除外，key 不属行为契约）

## 风险与边界

- **run 块与 durable 派生双路径漂移**：靠函数复用（chat-history 解析函数两路共用）+ settle 穿越 golden test 锁定
- **compaction 断线窗口**【v2 新识别】：断线期间发生 compaction 时客户端旧条目滞留（现 REST 历史 `deriveHistoryEntries` 同样不体现 digest，非回归）；「compacted 帧进 tier ② 词汇」列 backlog
- **单帧体积**：`message_settled` 携带完整 message，与现 `message_end` 相同，无放大；`message_update` 快照语义不变
- **帧序依赖**：WS 有序保证内 seq 配对无歧义；跨连接由 tier ② 兜底
- **legacy 会话首启**：410 → 快照模式，水位线空置直至事件化数据出现；迁移后 seq 重启由 #7 不变量兜底
- **旧 PWA 告警噪音**：接受（同源发布，窗口短）
- **重写量**：run-tail 自 chat-session-reducer 平移而非重设计，现有套件为行为规格

## 开放问题

1. ~~pi `AgentMessage` 是否有稳定 id~~【v2 关闭】：瞬态 `message_end` 携带 seq，配对精确化，不再依赖 pi id
2. ~~`message_persisted` vs `message_settled` 命名~~【v2 落定】：`message_settled`
3. events cap 200 是否足够：超长 run 多轮续拉已有 hasMore 兜底；实现时按实测调整首拉 cap
4. Phase 2 立项时点：PR-B 合并后按渲染债优先级排期（本文 §Phase 2 为路线图，实施另立 design）

## E2E

影响 chat 全链路：`chat-streaming-resilience` / `chat-withdraw` / `chat-retry` / `floating-chat` 全量 + 新增「多客户端确认帧可见性」（桌面实时见移动端 user 消息）。合并前 `npm run verify:e2e`。

## PR 拆分【v2 修订：单 PR 全量重写 → 三 PR 序列】

1. **PR-A 协议先行**（contracts + core + server）：确认帧词汇、intentId、events 端点、hub 广播。dark launch——v1 客户端忽略新帧 = v1 行为，现有 e2e 套件全量跑作为不回归证明；PM 门面契约测试在此 PR 落地
2. **PR-B app 副本切换**（replica 状态机 + store 重写 + merge 层删除 + 稳定 key）：消费方逐项迁移（#12 兼容面），#82 回归场景转帧序列用例
3. **PR-C 渲染层**（Phase 2，另立 design）：part 化 derive 输出 + 注册表 + memo + 流式 markdown 增量

每步独立可验证、可独立回滚；PR-A 合并后即使 PR-B 延迟，协议侧无半成品状态。

## 文档同步（doc-sync 清单）

- `docs/official/architecture/chat.md`：Renderer 节重写为三区副本模型 + 确认帧协议 + 三层追赶
- `docs/official/project-structure.md`：replica/ 目录与删除文件
- `docs/official/data-conventions.md`：`user/message` event data 增 `intentId`（additive 不升版）
- `docs/dev/backlog.md`：删除 H1 条目（结构性消灭）与 MessageList key 条目（稳定 key 落地）；新增「compacted 帧进 tier ② 词汇」
- theme skills 豁免核实（DOM 钩子不变）
