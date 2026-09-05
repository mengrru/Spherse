# Chat 数据流

> 覆盖：一条消息从发送到渲染的全链路——renderer runtime → server `ChatSessionHub` → core `AgentRunner` → EventPipeline → 持久化，以及错误、重试、重连、历史对账与滚动的机制。
> wire 协议 contract 定义见 `@spherse/contracts`（`websocket.ts`）；core 事件日志与 fold 语义见 [core.md](core.md)；前端路由与查询缓存见 [frontend.md](frontend.md)。
> 本文只描述数据流与机制；UI SDK 侧的发送入口（open/float 语义）见 [ui-sdk.md](ui-sdk.md)。

## 全链路总览

```
Composer.send
  → session-store.sendMessage              乐观插入 user entry（clientId；断线时标 sendFailed）
  → session-link                            WS { type:"message", content, clientId, attachments }
  → ChatSessionHub.startRun                 channel 置 running，广播 run_status
  → AgentRunner.sendMessage                 guard → 先落库 user/message + turn/start → agent.prompt
  → pi agent loop                           emit 生命周期事件流
  → EventPipeline                           log → capability middlewares → 附件 sanitizer → persist
  → hub publish                             广播到 channel 的订阅者（WS attachments）
  → renderer rAF 批量归约                    event-queue → flush → entry-reducer（entry state）
  → assembleGroups → MessageGroup           渲染单元（无孤儿 log、稳定 key）
```

两个横切不变量：

- **persist-before-callback**：`persistMiddleware` 先把事件写入 SessionEventLog 再放行广播——连接故障不能打断 agent 或阻止消息落库（为什么见 [ADR-0004](../../dev/decisions/0004-persist-before-callback.md)）
- **socket close 只解除 attachment**：Core run 继续执行并持久化，重连后由 hub 补发快照

## Wire 协议（`contracts/websocket.ts`）

- **client → server**：`message`（content + 可选 `clientId`（乐观消息结算标识）+ attachments 路径引用）、`abort`、`ping`、`retry`、`withdraw`、`resolve_control_request`（kind approval：approved / reason；kind question：answer）
- **server → client**：
  - pi 生命周期族：`agent_start` / `agent_end`（可带 `seq`） / `turn_start` / `turn_end` / `message_start` / `message_update` / `message_end`（可带 `messageId` + `seq`） / `tool_execution_start` / `tool_execution_update` / `tool_execution_end`
  - session 级：`run_status`（active，log 派生）、`control_request` / `control_resolved`（落库，可带 `seq`；abort 路径 `resolved` 带 `aborted: true`）、`turn_withdrawn`（seq）、`turn_retried`（seq + abandonedSeqs）、`user_message`（seq + clientId? + source? + triggerName?，user 消息回显/ack）、`error`（message + code）、`pong`
  - 重放族：`session_ready`（lastSeq + replay，attach 后恒为首个事件）、`replay_events`（原始 SessionEvent 信封分批，每批 ≤200，含 `control/requested`/`control/resolved`）、`replay_done`
- **身份与游标**（[ADR-0011](../../dev/decisions/0011-chat-wire-cursor-replay.md)）：持久事件按 `seq` 幂等；流式 wire 消息按 hub 生成的 `messageId` stitch（pi message payload 运行时无 id 字段；`messageId` 为 **run 级身份**，每个 run 从 `m1` 重新计数），`message_end.seq` 经落库实例引用配对（persist-before-callback）；connect query `?since=`（≥ -1）触发游标重放，游标为客户端 per-connection 状态——`cursor = max(cursor, seq)` 永不回退，live 推进集合为 `user_message` / `message_end` / `agent_end` / `turn_retried` / `turn_withdrawn`，重放的每条事件都推进
- **error code**（`classify-run-error.ts`）：`MODEL_NOT_CONFIGURED`、`AUTH_ERROR`、`PERMANENT`、`TRANSIENT`。规则：
  - 401/403 → AUTH；429/5xx/网络错误 → TRANSIENT
  - 其余 4xx 及 `ConflictError` / `ValidationError` → PERMANENT
  - **未知错误兜底 TRANSIENT**
- **close code**：`4400 PROTOCOL_ERROR`、`4401 SESSION_UNRECOVERABLE`、`4402 MIGRATION_REQUIRED`——renderer 视为 fatal 不再重连；瞬时错误以 1000 关闭触发重连
- 出站校验默认关闭（生产直发），`SPHERSE_VALIDATE_WS=1` 开启调试；schema 由 `chat-wire-schema.test.ts` 全事件族钉住

## Server：hub / channel / projector（`server/src/chat/`，对外仅经 `chat/index.ts` 导出）

- **`ChatSessionHub`（注册表）**：`Map<projectId:sessionId, ChatChannel>` + getOrCreate + 身份守卫删除回调；hub 实例由 `server/index.ts` 创建，WS 与 sessions 路由共享
- **`ChatChannel`（单 session 生命周期）**：restore→ready、事件日志订阅、attach（连接级生命周期为闭包）、run 序列化（`startRun` 在 running 时抛 `ConflictError`，HTTP 映射 409，WS 路径表现为 error 事件 code=PERMANENT）、快照压缩（run 期间 `message_update` 同一消息窗口只留最后一条、`tool_execution_update` 同 toolCallId 只留最后一条）、握手重放、fanout、空闲销毁（`cleanupIfIdle`：busy = 自有 run ‖ log 派生 open turn——直连 run（如 trigger）进行中不销毁）
- **run_status 从 event log 派生**（`ChatWireProjector.isRunActive`，open turn 跟踪）：所有 run（WS / HTTP 静默 / trigger 直连）的 turn 边界都写入 log，log 订阅路径统一发布 `run_status` 翻转；channel 不再在 startRun 手动发布——trigger 等直连 run 因此天然对订阅者可见（echo + 边界 + 完成内容；流式 partial 除外）。channel 建立订阅时从 log 尾部反向扫描初始化 open turn（mid-run attach 握手即得 active，且直连 run 进行中不销毁 session）。wire 顺序：`user_message` echo → `run_status(true)` → 流式 → `run_status(false)` → `agent_end`
- **`ChatWireProjector`（persist→wire 翻译纯状态机）**：经 `SessionEventLog.subscribe` 消费落库事件——`user/message` → `user_message` echo（clientId + trigger meta）、`turn/retried` → `turn_retried` 广播、turn 边界 → `run_status` 翻转、`assistant/message`/`tool/result` 在**非 channel 发起的 run** 中翻译为 `message_end`（带 seq，内容对订阅者可见）、落库实例引用→seq 配对、run 级 `messageId` 序列；对 pi wire 事件做富化（自有 run 的内容由 pi 流负责，log 仅配对，避免双发）。pending echo 与 run 状态在 run 边界重置
- **attach 握手顺序**：ready 后同步块内 session_ready（lastSeq）→ since 游标重放（`readSessionEventsAfter` 原始事件分批，每批 200）→ replay_done → 当前 run 压缩快照 → run_status 当前值 → 加入订阅（无 await，切片与订阅同 tick 原子）
- **HTTP 静默发送**：`POST .../sessions/:id/messages`，目标会话未 attach WS 时 UI SDK 走此路径（`open:false` 只控制不跳转导航）：
  - `startDetachedRun` 只递增 attachment 计数保持 channel 存活、不注册订阅者——调用方只拿 `{ok:true}`，run 失败经 error 事件到达 WS 订阅者（echo 无 clientId，仅推进其他端）
  - 与 WS 共享 run 序列化（running 时 409）

## Core：一次 sendMessage（`agent-runner.ts`）

1. guard 链：`ensureNotBusy`（in-flight 抛 ValidationError）→ 消费 pendingReload → `ensureModel` → `ensureWritable` → beforeTurn hook → 组装附件消息。所有权在 `ensureNotBusy` 通过时同步取得，覆盖至 afterTurn 结束；preflight 任一阶段抛错都会释放，不会写入 phantom turn 或卡死 busy 状态
2. **先持久化**：`appendBatch([user/message, turn/start])` 成功后才 `agent.prompt`
3. 事件经 EventPipeline（log → capability middlewares → 附件 sanitizer → persistMiddleware）流向 hub；control 事件旁路——`controlBus.swapEventSink` 直达 sink 不过中间件
4. 落库映射：`message_end` → `assistant/message` / `tool/result`；`agent_end` → `turn/end`（reason 取自最后 assistant 的 stopReason）
5. `retryLastTurn`：要求末条为失败 assistant；追加 `turn/retried`（abandonedSeqs）+ `turn/start`，`agent.continue()`
6. `withdrawLastTurn`：定位最后 `user/message`，已被 abandoned/compaction 覆盖则拒绝；追加 `turn/withdrawn`

## Renderer：Entry → MessageGroup → 组件

- **`ChatEntry`（canonical state，`features/chat/model/entry.ts`）**：事件日志的前端 1:1 投影，按身份寻址——`seq`（持久事件身份；旧协议来自 HTTP entry id，v2 = `SessionEvent.seq`）、`streamId`（流式消息身份；旧协议客户端生成，v2 = server run 级 `messageId`）、`clientId`（乐观 user 消息结算）；分 user / assistant / tool-result / error 四类，tool result 独立成条
  - 归约分三模块：`entry-state.ts`（`ChatEntryState` 形状与共享身份操作：游标推进、`seqByMessageId` 绑定清理、按 seq 移除、乐观 user 结算）；`entry-reducer.ts`（live 入口 `reduceLiveEvents`：pi 事件、`openStreamId` 流式窗口 + `ownerAssistantId` owner 跟踪、run 级 `messageId` 绑定与清理）；`persisted-entries.ts`（重放入口 `applyPersistedEvents`：按 `seq` 幂等 upsert、tool owner 配对、`turn/withdrawn` 区间/`turn/retried` 移除、`compaction/applied` 仅推进游标；`dropTransientProjections` 在重放结束时清空无 `seq` 的运行中投影，由快照重建）
  - `history-entries.ts`：HTTP 分页 entry → entries；`latest` 模式按 `seq` upsert 并丢弃未持久化窗口（由重连缓冲事件重建），`loadMore` 保留本地尾部；乐观 user 结算收敛为 `findOptimisticUserIndex`——live echo 只按 `clientId` 精确匹配，HTTP 首页 / 重放按 unique text 兜底
- **`MessageGroup`（渲染单元，`message-group.ts`）**：`assembleGroups(entries)` 纯函数分区出 `turn` / `trigger-turn` 组与 `assistant` / `tool-result` / `error` 气泡；每个 entry 恰好归入一个渲染单元，tool call 与 result 按 `toolCallId` 合并，配不上宿主的结果降级为独立气泡——不丢孤儿 log；渲染 key 一律取 entry/group 身份
  - `tool-card.ts` 投影卡片（优先级：pending control > result > partial > resolved control）；`run-changes.ts` 聚合每轮 write_file/edit_file；`group-derivations.ts` 派生 superseded 卡片、撤回/重试目标、待批控制、thinking
- **runtime 模块（`features/chat/runtime/`）**：`session-link`（每 session 一个 `WsConnection`：url（含 `?since=`）/ 心跳 / fatal / probe / 出站）、`session-recovery`（首帧判定：`session_ready` → 游标重放，否则 HTTP 冷对账；事件缓冲 + 退避）、`event-queue`（rAF 批处理 + `setTimeout(200ms)` 兜底后台冻结）、`session-lifecycle`（引用计数、TTL 定时器、级联断开、link/recovery 生命周期）、`history-loader`（首页 / loadMore / refresh）、`outbound-actions`（发送 / 重试 / 撤回 / 中断 / 控制响应）、`decode`（wire → 帧分类：live event / session-ready / replay-events / replay-done，`replay_events` 逐条解析跳过未知事件）、`session-store`（Zustand 壳 + actions）、`selectors`（对外窄 selector）；transport 不进 Zustand
- `useChatGroups` 组装视图模型（groups / superseded / thinking / 可撤回目标）；`useChatSession` 只做 attach/detach 与状态选择——切换页面不中断后台流式；正常断线保留 streaming 与未完成消息，`agent_end` / `error` 事件或服务端 `run_status: inactive` 结束运行态；fatal close 立即清运行态且不重连

## 错误与重试

| | Source 1 | Source 2 |
|---|---|---|
| 来源 | `sendMessage` 在 `agent.prompt` 前抛错 | pi `handleRunFailure` 合成 `message_end`（stopReason error） |
| 用户消息落库 | 否（appendBatch 前抛出） | 是 |
| Entry 表现 | 追加独立 `ErrorEntry`（resend 路径） | 当前 assistant entry 置 `error`（retry-last 路径） |
| `EntryError.code` 来源 | error 事件携带的服务端 code | renderer 从错误文本正则重分类（`classify-error.ts`，规则集与服务端不同） |
| 重试路径 | resend（重发 user 消息） | retry-last（WS `retry` → `retryLastTurn`） |

- **重试决策是纯函数** `group-derivations.ts` 的 `planRetry`：返回 `none` / `retry-last` / `resend`（含 dropCount）；store 的 `retry` action 只执行 plan
- **无自动重试**：错误一律落错误气泡 + 手动按钮触发（`code` 仅用于错误展示分类）；为什么见 [ADR-0008](../../dev/decisions/0008-no-frontend-auto-retry.md)
- **撤回**：非 streaming 时最新未失败 user entry 可 withdraw；hub 不经 startRun（运行中返回 ConflictError）；成功广播 `turn_withdrawn`，reducer 从该 user entry 处截断；失败给 error 打 `retrySuppressed`（隐藏 retry）

## 重连与游标重放

- **心跳**：每 30s ping，连续 60s 无 pong 才关闭；suspend 导致 timer 大幅跳跃时重置探测窗口防误杀；web 壳 hidden ≥30s / bfcache 恢复时主动 probe（5s 短超时）强测死链
- **重连退避**：`[1, 2, 5, 10, 30]s`，上限 10 次（超限状态机 `failed` → banner 手动重连）；fatal `4400/4401/4402` 不重连并立即清运行态；detach 后由 `WsConnection.shouldRetry` 阻断重连
- **v2 游标重放**（`history.status` 已 ready 时 connect 带 `?since=cursor`；否则不带并回落冷对账）：
  - attach 后首帧恒为 `session_ready`：进入重放态，`replay_events` 分批（每批 ≤200）经 `applyPersistedEvents` 归约，期间普通事件缓冲；`replay_done` 时清空无 `seq` 的本地运行中投影（由随后的 run 快照重建），再放行缓冲帧
  - 重放语义：按 `seq` 幂等 upsert 并推进游标；`user/message` 结算 clientId 未命中的乐观 entry（unique text 兜底）；`turn/withdrawn` 按 `[data.seq, event.seq)` 移除、`turn/retried` 按 `abandonedSeqs` 移除；`compaction/applied` 只推进游标不改 entries（与 HTTP 历史投影一致）
  - 重放与快照重叠去重（[ADR-0011](../../dev/decisions/0011-chat-wire-cursor-replay.md)）：`messageId` 为 run 级身份，`agent_start` 清空上一 run 的绑定与 `streamId`；wire `message_end` 的 `seq` 已在本地（重放在先）→ 丢弃 wire 侧窗口、以持久事件为准；`messageId` 已绑定 seq 的 `message_start` / `message_update` 直接跳过
- **legacy 冷对账**（首帧不是 `session_ready` 的旧 server，或首页从未加载成功：新 app + 旧 server 兼容层）：
  - onopen → `history.status: syncing` → 拉最新一页历史 → 期间入站事件缓冲 → `applyHistoryPage("latest")` 按 `seq` upsert
  - 未持久化的本地流式窗口被丢弃，由缓冲的 run 快照重放重建；已结束的 run 由页内持久行接管
  - 乐观 user 消息按 unique text 与持久行结算；配不上时保留为本地尾部
  - 对账失败按 `[1, 2, 5]s` 退避重试；全失败时仅「从未 ready 过」的会话置 `history.error`（曾 ready 的保持 ready，缓冲事件仍会被应用），后续重连继续对账而非切游标重放
- **分页**：`GET .../sessions/:id/messages?limit=&before=`，默认 20、clamp [1, 200]；shape `{ entries, hasMore, oldestId }`
  - `id` / `oldestId` 在 events 投影路径为事件 seq，legacy 路径为 messages 表行 id——两者都是单调 cursor，前端无需区分
  - entry 可携带可选 `source: "triggered"` + `triggerName`（trigger 发送标记，仅 events 投影路径；legacy 路径无此字段）
- **页原子性**：events 投影与 legacy 两条路径都在页首遇孤儿 toolResult 时向后扩展页边界，保证单页内 toolCall/toolResult 配对自洽——前端按页解析、跨页不重新配对
- 上翻加载 `loadMore` 以 `history.oldestSeq` 为 cursor，守卫 `hasMore && !loadingMore`；迟到响应按 session generation 丢弃

## 滚动（column-reverse 方案）

- 容器 `flex flex-col-reverse`、消息数组 reverse 渲染：DOM newest→oldest，`scrollTop = 0` 即底部——流式 token 到达时末条在底部增长，**原生逐帧贴底无需 JS 节流**
- JS 介入点共三处：load-more 前捕获 `scrollTop`、渲染后恢复（阅读位置不被 prepend 扰动）；用户发送时 `scrollToBottom("smooth")`（目标 `top:0`）；首次挂载时恢复保存位置或 instant 贴底
- 「回到底部」FAB 显隐：`scrollTop >= -100px` 即视为贴底
- session 切换按 store 中 `scrollPosition` 恢复：保存值 < 0（曾离开底部）才恢复，否则 instant 贴底；恢复在 `useLayoutEffect` 中执行规避 remount 读到脱离 DOM 的值
- 已知取舍：DOM 顺序 newest→oldest，屏幕阅读器从最新消息读起

## 类型归属

- `ChatEntry` / `MessageGroup` / `ToolItem` 等会话模型类型在 `features/chat/model/`；`features/chat/types.ts` 只保留卡片与附件类型（`HtmlCard`、`ChatAttachment` 等）；`lib/types.ts` 只保留 contract re-export 与应用级类型
- `lib/` 原则上不反向 import feature——`lib/web-resume-probe.ts` 是已知例外（bridge 性质，订阅 chat session store 与 bus store）
