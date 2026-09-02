# Chat 数据流

> 覆盖：一条消息从发送到渲染的全链路——renderer runtime → server `ChatSessionHub` → core `AgentRunner` → EventPipeline → 持久化，以及错误、重试、重连、历史对账与滚动的机制。
> wire 协议 contract 定义见 `@spherse/contracts`（`websocket.ts`）；core 事件日志与 fold 语义见 [core.md](core.md)；前端路由与查询缓存见 [frontend.md](frontend.md)。
> 本文只描述数据流与机制；UI SDK 侧的发送入口（open/float 语义）见 [ui-sdk.md](ui-sdk.md)。

## 全链路总览

```
Composer.Send
  → replica-store.sendMessage         生成 intentId、pending 区入列乐观 intent
  → ChatSessionRuntime                WS { type:"message", content, attachments, intentId }
  → ChatSessionHub.startRun           channel 置 running，广播 run_status
  → AgentRunner.sendMessage           guard → 先落库 user/message + turn/start → agent.prompt
  → pi agent loop                     emit 生命周期事件流
  → EventPipeline                     log → capability middlewares → 附件 sanitizer → persist
  → hub publish                       广播到 channel 的订阅者（WS attachments）
  → renderer rAF 批量归约              frameQueue → requestAnimationFrame flush → reduceReplica
  → replica-store / MessageList       derive 派生视图与渲染
```

两个横切不变量：

- **persist-before-callback**：`persistMiddleware` 先把事件写入 SessionEventLog 再放行广播——连接故障不能打断 agent 或阻止消息落库（为什么见 [ADR-0004](../../dev/decisions/0004-persist-before-callback.md)）
- **socket close 只解除 attachment**：Core run 继续执行并持久化，重连后由 hub 补发快照

## Wire 协议（`contracts/websocket.ts`）

- **client → server**：`message`（content + attachments 路径引用 + 可选 `intentId` ULID，用于乐观写确认回执）、`abort`、`ping`、`retry`、`withdraw`、`resolve_control_request`（kind approval：approved / reason；kind question：answer）
- **server → client**：
  - pi 生命周期族：`agent_start` / `agent_end` / `turn_start` / `turn_end` / `message_start` / `message_update` / `message_end`（可选 `seq`：assistant/toolResult 携带其落库 seq，与瞬态事件同帧序下发）/ `tool_execution_start` / `tool_execution_update` / `tool_execution_end`
  - **确认帧族**（已落库事实，客户端按 seq 幂等 fold；`message_end{seq}` 与 `message_settled{seq}` 等效）：`message_settled`（seq + message + 可选 intentId）、`turn_withdrawn`（seq + upTo，撤回区间 `[seq, upTo)`）、`turn_retried`（seq + abandonedSeqs）
  - session 级：`run_status`（active）、`control_request` / `control_resolved`、`error`（message + code）、`pong`
  - v1 客户端对未知帧 parser 抛错、由 runtime try/catch 跳过——新增帧类型无需版本握手
- **error code**（`classify-run-error.ts`）：`MODEL_NOT_CONFIGURED`、`AUTH_ERROR`、`PERMANENT`、`TRANSIENT`。规则：
  - 401/403 → AUTH；429/5xx/网络错误 → TRANSIENT
  - 其余 4xx 及 `ConflictError` / `ValidationError` → PERMANENT
  - **未知错误兜底 TRANSIENT**
- **close code**：`4401 SESSION_UNRECOVERABLE`——renderer 视为 fatal 不再重连；瞬时错误以 1000 关闭触发重连

## Server：ChatSessionHub（`chat-session-hub.ts`）

- channel key = `projectId:sessionId`；负责共享 restore、run 状态序列化、事件广播；hub 实例由 `server/index.ts` 创建，WS 与 sessions 路由共享
- **run 序列化**：`startRun` 在 channel running 时抛 `ConflictError`（HTTP 映射 409，WS 路径表现为 error 事件 code=PERMANENT）
- **快照压缩**：run 期间 `message_update` 同一消息窗口只留最后一条、`tool_execution_update` 同 toolCallId 只留最后一条——重放开销 O(压缩后)
- **重连重放顺序**：attach ready 后先重放压缩快照，再发 `run_status` 当前值，然后才订阅
- **空闲释放**：`cleanupIfIdle`——initialized 且无 run 且无 attachment 时销毁 session、删 channel
- **HTTP 静默发送**：`POST .../sessions/:id/messages`，目标会话未 attach WS 时 UI SDK 走此路径（`open:false` 只控制不跳转导航）：
  - `startDetachedRun` 只递增 attachment 计数保持 channel 存活、不注册订阅者——调用方只拿 `{ok:true}`，run 失败经 error 事件到达 WS 订阅者
  - 与 WS 共享 run 序列化（running 时 409）
- **事件增量端点**：`GET .../sessions/:id/events?since=&limit=`（cap 200 + hasMore 续拉）——hub channel `await ready`（restore 含 repairLog 修复）后从 log 投影确认帧词汇；未迁移 legacy 会话预检即拒（`MigrationRequiredError` → 410 `{reason: "legacy-unmigrated"}`），不触发迁移

## Core：一次 sendMessage（`agent-runner.ts`）

1. guard 链：`ensureNotBusy`（in-flight 抛 ValidationError）→ 消费 pendingReload → `ensureModel` → `ensureWritable` → beforeTurn hook → 组装附件消息。所有权在 `ensureNotBusy` 通过时同步取得，覆盖至 afterTurn 结束；preflight 任一阶段抛错都会释放，不会写入 phantom turn 或卡死 busy 状态
2. **先持久化**：`appendBatch([user/message, turn/start])` 成功后才 `agent.prompt`
3. 事件经 EventPipeline（log → capability middlewares → 附件 sanitizer → persistMiddleware）流向 hub；control 事件旁路——`controlBus.swapEventSink` 直达 sink 不过中间件
4. 落库映射：`message_end` → `assistant/message` / `tool/result`；`agent_end` → `turn/end`（reason 取自最后 assistant 的 stopReason）。**确认帧发射**：assistant/toolResult 的瞬态 `message_end` 携带落库 seq 下发，紧随其后经 onEvent 发 `message_settled`（同一 publish 链路，WS 保序）；`user/message` 在 appendBatch 后、pipeline 创建前直发 `message_settled`（含 `intentId` 回执）
5. `retryLastTurn`：要求末条为失败 assistant；追加 `turn/retried`（abandonedSeqs）+ `turn/start` 后经 onEvent 发 `turn_retried` 确认帧，再 `agent.continue()`
6. `withdrawLastTurn`：定位最后 `user/message`，已被 abandoned/compaction 覆盖则拒绝；追加 `turn/withdrawn` 并返回 `{ seq, upTo }`（撤回区间 `[seq, upTo)`），hub 据此广播

## Renderer：三区副本模型（replica / store / runtime）

会话状态是服务端 append-only 日志的**只读副本 + 乐观写**，`SessionReplica = { durable, run, pending, notices }`：

- **`replica/`（纯状态机）**：`reduceReplica(state, frame)` 为纯函数，帧词汇 = wire 事件 ∪ 内部生命周期帧（`connected` / `disconnected{fatal}` / `replayCompleted`（每次连接后首个 `run_status` 即重放结束标记）/ sync 结果帧 / `runKilled`）
  - `durable`：已确认事实的 `(seq, message)` 有序集 + 水位线 `highSeq`。确认帧按 seq 幂等 fold（`message_end{seq}` ≡ `message_settled{seq}`）；`turn_withdrawn` 删 `[seq, upTo)`、`turn_retried` 删 `abandonedSeqs`；前向来源出现 `seq ≤ highSeq` 且不存在的条目 → 水位线失效（`resyncNeeded`）→ store 触发全量快照重同步；`loadMore` 反向插入不触发。legacy 会话（events 端点 410）转快照模式（条目以 REST id 为键、水位线空置），首次事件化数据到达时全量丢弃快照条目重建
  - `run`：进行中 run 的瞬态尾——streaming 草稿（draft）+ 工具执行 overlay（按 toolCallId 键控，含卡片/审批/提问状态）；`message_end{seq}` / `message_settled{seq}` 即 **settle 所有权交接**：块出 run 区、durable 承接渲染；run 结束清 pending question 卡、保留 pending approval 卡；sync 完成且 run 不活跃时丢弃未 settle 的瞬态
  - `pending`：乐观写 intent 三态（queued/sending/failed）；`message_settled{intentId}` 确认移除；发送失败（socket 未开 / error 帧且回执未到）置 failed，重试 = 纯 send 重建，**禁止触发 withdraw**
  - `notices`：无持久化对应物的瞬态注记（error 帧 / withdraw 失败），跨重连存活；清除规则：bornAtSeq 之后的 durable error 条目、覆盖区间的删除帧、后续任意 user settle（兜底）
- **`replica/derive.ts`（视图派生）**：单向 `render(durable) ++ render(pending) ++ render(run) ++ render(notices)`；durable 投影复用 chat-history 解析函数（toolResultMap 卡片增强、run 窗口 `_runChanges` 聚合）；活跃 run 的 overlay 按 toolCallId 合并进对应 assistant 条目；输出 **keyed 条目**（key = `seq:` / `intent:` / `block:` / `notice:` 前缀），`MessageList` / `TriggerTurnGroup` 以此为稳定 key（消灭 index-key 重挂载）
- **`replica-store.ts`（薄 store）**：sessions 记录 = replica + 派生缓存 + 扁平兼容字段（`messages` / `streaming` / `hasMore` / `connectionStatus` / `historyStatus` / `historyError` / `reconnectFailed` / `scrollPosition`）；帧按 **animation frame 批量归约**；`setStreaming` 侧带传播收敛为 flush 后单一传播点；`useChatSession` 公共 action 面不变，`refreshHistory` 收敛为 `resync`
- **`runtime/chat-session-runtime.ts`（纯传输壳）**：WS、心跳/探活/重连退避与出站帧（含 intentId）；不做对账、不落 UI 状态，只发帧
- `ChatMessage` 的 `_` 前缀字段是 derive 的 view 投影（冻结面：Phase 2 前禁止新增字段；稳定 key 走 keyed 通道，不进结构体）
- `useChatSession` 只做 attach/detach 与状态选择——切换页面不中断后台流式；正常断线保留 run 区与未完成消息，`agent_end` / `run_status: inactive` / `disconnected{fatal}` 结束运行态

## 错误与重试

| | Source 1 | Source 2 |
|---|---|---|
| 来源 | `sendMessage` 在 `agent.prompt` 前抛错（error 帧） | pi `handleRunFailure` 合成 `message_end`（stopReason error，带 seq 落库） |
| 用户消息落库 | 否（appendBatch 前抛出）；若 intent 已确认则轮次已落库 | 是 |
| 副本表现 | error notice（裸错误气泡，无 `_turnError`）；sending intent 置 failed | durable error 条目（`_error` + `_turnError`），清覆盖 notice |
| `_errorCode` 来源 | error 事件携带的服务端 code | renderer 从错误文本正则重分类（`classify-error.ts`，规则集与服务端不同） |
| 重试路径 | resend（failedIntent 时纯 send；user 已落库时 withdraw+send 复合） | retry-last（WS `retry` → `retryLastTurn`） |

- **重试决策是纯函数** `retry-plan.ts`：`planRetry` 作用于 derive 输出，返回 `none` / `retry-last` / `resend{failedIntent}`；store 的 `retry` 只执行 plan：
  - `retry-last`（Source 2，durable 内 `stopReason=error` 的 assistant 条目）→ WS `retry`，视图进入 retrying 态（末条 error 条目渲染为 streaming）
  - `resend` + `failedIntent=true`（intent 失败、无持久化对应物）→ **纯 send**：移除 failed intent、重建新 intent 发送——禁止触发 withdraw（否则会静默撤回上一个健康 turn）
  - `resend` + `failedIntent=false`（Source 1、user 轮已落库）→ **withdraw + send 复合**：先发 `withdraw`，待 `turn_withdrawn` 确认后发新消息；withdraw 被拒（error 帧）回退纯 send，失败对保留在 durable（诚实历史）
- **无自动重试**：错误一律落错误气泡/注记 + 手动按钮触发；为什么见 [ADR-0008](../../dev/decisions/0008-no-frontend-auto-retry.md)
- **撤回**：非 streaming 时最新未失败 user 消息可 withdraw；hub 不经 startRun（运行中返回 ConflictError）；成功广播 `turn_withdrawn{seq, upTo}`，durable 删区间；失败落 `withdrawFailed` notice（错误气泡打 `_withdrawError`，抑制 retry）

## 重连与三层追赶（replica/sync.ts）

- **心跳**：每 30s ping，连续 60s 无 pong 才关闭；suspend 导致 timer 大幅跳跃时重置探测窗口防误杀；web 壳 hidden ≥30s / bfcache 恢复时主动 probe（5s 短超时）强测死链
- **重连退避**：`[1, 2, 5, 10, 30]s`，上限 10 次（超限 `reconnectFailed` + 手动重连）；fatal 4401 不重连
- **追赶编排**（`replayCompleted` 后由 store 触发，tier② 失败按 `[1, 2, 5]s` 退避重试；全失败时仅「从未 ready 过」的会话置 `historyError`，曾 ready 的保持 ready）：
  - **tier① runEvents replay**：hub attach 后重放压缩快照 + `run_status`（重放结束标记），确认帧随 buffer 重放，run 区据此重建
  - **tier② events 增量端点**：`GET .../sessions/:id/events?since=&limit=`（cap 200 + hasMore 续拉，游标取页末帧 seq）；确认帧幂等 fold，与 replay/live 到达顺序无关
  - **tier③ 分页快照**：冷启动（durable 空）与水位线失效重同步用；`GET .../sessions/:id/messages?limit=&before=`（默认 20、clamp [1, 200]，shape `{ entries, hasMore, oldestId }`；events 投影路径 id = 事件 seq，legacy 路径为 messages 表行 id；页首孤儿 toolResult 向后扩展页边界保证单页 toolCall/toolResult 配对自洽；entry 可携带 `source: "triggered"` + `triggerName`）；`resync`（refreshHistory 后继，TriggerEventBridge 兜底调用）为**范围替换**（保留已加载更早前缀），streaming 中跳过；手动 `loadMore` 反向分页纯插入、不动水位线
- sync 完成时：run 不活跃则丢弃未 settle 的瞬态（durable 是事实源）；仍在 sending 的 intent 置 failed（回执未到 = 丢失，交还手动重试）

## 滚动（column-reverse 方案）

- 容器 `flex flex-col-reverse`、消息数组 reverse 渲染：DOM newest→oldest，`scrollTop = 0` 即底部——流式 token 到达时末条在底部增长，**原生逐帧贴底无需 JS 节流**
- JS 介入点共三处：load-more 前捕获 `scrollTop`、渲染后恢复（阅读位置不被 prepend 扰动）；用户发送时 `scrollToBottom("smooth")`（目标 `top:0`）；首次挂载时恢复保存位置或 instant 贴底
- 「回到底部」FAB 显隐：`scrollTop >= -100px` 即视为贴底
- session 切换按 store 中 `scrollPosition` 恢复：保存值 < 0（曾离开底部）才恢复，否则 instant 贴底；恢复在 `useLayoutEffect` 中执行规避 remount 读到脱离 DOM 的值
- 已知取舍：DOM 顺序 newest→oldest，屏幕阅读器从最新消息读起

## 类型归属

- `ChatMessage`、`ToolCallInfo`、`HtmlCard` 等 chat 内部类型集中在 `features/chat/types.ts`；`lib/types.ts` 只保留 contract re-export 与应用级类型
- `lib/` 原则上不反向 import feature——`lib/web-resume-probe.ts` 是已知例外（bridge 性质，订阅 chat runtime 与 bus store）
