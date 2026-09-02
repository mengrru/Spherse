# Chat 数据流

> 覆盖：一条消息从发送到渲染的全链路——renderer runtime → server `ChatSessionHub` → core `AgentRunner` → EventPipeline → 持久化，以及错误、重试、重连、历史对账与滚动的机制。
> wire 协议 contract 定义见 `@spherse/contracts`（`websocket.ts`）；core 事件日志与 fold 语义见 [core.md](core.md)；前端路由与查询缓存见 [frontend.md](frontend.md)。
> 本文只描述数据流与机制；UI SDK 侧的发送入口（open/float 语义）见 [ui-sdk.md](ui-sdk.md)。

## 全链路总览

```
Composer.send
  → streaming-store.sendMessage          乐观插入 user 消息（断线时标 _sendFailed）
  → ChatSessionRuntime                   WS { type:"message", content, attachments }
  → ChatSessionHub.startRun              channel 置 running，广播 run_status
  → AgentRunner.sendMessage              guard → 先落库 user/message + turn/start → agent.prompt
  → pi agent loop                        emit 生命周期事件流
  → EventPipeline                        log → capability middlewares → 附件 sanitizer → persist
  → hub publish                          广播到 channel 的订阅者（WS attachments）
  → renderer rAF 批量归约                 eventQueue → requestAnimationFrame flush → reducer
  → streaming-store / MessageList        view state 与渲染
```

两个横切不变量：

- **persist-before-callback**：`persistMiddleware` 先把事件写入 SessionEventLog 再放行广播——连接故障不能打断 agent 或阻止消息落库（为什么见 [ADR-0004](../../dev/decisions/0004-persist-before-callback.md)）
- **socket close 只解除 attachment**：Core run 继续执行并持久化，重连后由 hub 补发快照

## Wire 协议（`contracts/websocket.ts`）

- **client → server**：`message`（content + attachments 路径引用）、`abort`、`ping`、`retry`、`withdraw`、`resolve_control_request`（kind approval：approved / reason；kind question：answer）
- **server → client**：
  - pi 生命周期族：`agent_start` / `agent_end` / `turn_start` / `turn_end` / `message_start` / `message_update` / `message_end` / `tool_execution_start` / `tool_execution_update` / `tool_execution_end`
  - session 级：`run_status`（active）、`control_request` / `control_resolved`、`turn_withdrawn`（seq）、`error`（message + code）、`pong`
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

## Core：一次 sendMessage（`agent-runner.ts`）

1. guard 链：`ensureNotBusy`（in-flight 抛 ValidationError）→ 消费 pendingReload → `ensureModel` → `ensureWritable` → beforeTurn hook → 组装附件消息。所有权在 `ensureNotBusy` 通过时同步取得，覆盖至 afterTurn 结束；preflight 任一阶段抛错都会释放，不会写入 phantom turn 或卡死 busy 状态
2. **先持久化**：`appendBatch([user/message, turn/start])` 成功后才 `agent.prompt`
3. 事件经 EventPipeline（log → capability middlewares → 附件 sanitizer → persistMiddleware）流向 hub；control 事件旁路——`controlBus.swapEventSink` 直达 sink 不过中间件
4. 落库映射：`message_end` → `assistant/message` / `tool/result`；`agent_end` → `turn/end`（reason 取自最后 assistant 的 stopReason）
5. `retryLastTurn`：要求末条为失败 assistant；追加 `turn/retried`（abandonedSeqs）+ `turn/start`，`agent.continue()`
6. `withdrawLastTurn`：定位最后 `user/message`，已被 abandoned/compaction 覆盖则拒绝；追加 `turn/withdrawn`

## Renderer：runtime / store / reducer 三层

- **`ChatSessionRuntime`（非响应式）**：持有 WS、心跳、重连/探活 timer 与发送动作；每次连接组合一个 `HistoryReconciler`（连接期事件缓冲 + 历史对账状态机，`history-reconciler.ts`，随 socket 生命周期新建）；经 `ChatRuntimeRegistry` 管理生命周期，transport 不进 Zustand
- **`streaming-store`（Zustand）**：只持 UI 可观察状态与 actions；`connectionStatus`（disconnected/connecting/open）与 `historyStatus`（pending/syncing/ready）是正交维度；history 分页动作（loadMore / refreshHistory）在 `history-actions.ts`，经 port 接口（getSession / updateSession）与 session 状态解耦
- **重连对账保证覆盖**：reconcile / refreshHistory 在最新页 merge 后，按 `before: oldestLoadedId` 逐页回补直到覆盖重连前的已加载低水位（`oldestLoadedId`），防止超长 run 把 optimistic user 消息推出页外后 `mergeHistoryMessages` 的 transient 尾部追加将其堆叠到视图末尾；终止条件：覆盖低水位 / `hasMore` 耗尽 / 单页失败 / 空页 / 50 页上限
- **`chat-session-reducer`（纯函数）**：事件 → view state 归约，`applySessionEvents` 为归约 + withdraw 结算（`settlePendingWithdraw`）的完整管线；历史解析与稳定 ID 合并在 `chat-history.ts`，tool/card 投影在 `chat-tool-projection.ts`
- 事件按 **animation frame 批量归约**：单次 `set()` 内 flush 整个 eventQueue，避免高频 token update 触发过多 render
- `ChatMessage` 的 `_` 前缀字段是 view 投影：
  - 身份与状态：`_messageId`（= seq，历史对账去重键）、`_optimistic` / `_streaming` / `_sendFailed`
  - 内容投影：`_toolCalls`（含其上的 `_card`）、`_error` / `_errorCode` / `_turnError` / `_withdrawError`、`_runChanges` / `_attachments`
  - 来源投影：`_triggered` / `_triggerName`（trigger 发送的 user message，来自分页 entry 的 `source`/`triggerName`；`turn-groups.ts` 据此把该轮派生为折叠组，摘要条见 `TriggerTurnGroup`）
- `useChatSession` 只做 attach/detach 与状态选择——切换页面不中断后台流式；正常断线保留 streaming 与未完成消息，`agent_end` / `error` 事件或服务端 `run_status: inactive` 结束运行态（正常完成即经 `agent_end`）

## 错误与重试

| | Source 1 | Source 2 |
|---|---|---|
| 来源 | `sendMessage` 在 `agent.prompt` 前抛错 | pi `handleRunFailure` 合成 `message_end`（stopReason error） |
| 用户消息落库 | 否（appendBatch 前抛出） | 是 |
| reducer 表现 | 追加裸错误气泡（无 `_turnError`） | 末条 assistant 置 `_error` + `_turnError` |
| `_errorCode` 来源 | error 事件携带的服务端 code | renderer 从错误文本正则重分类（`classify-error.ts`，规则集与服务端不同） |
| 重试路径 | resend（重发 user 消息） | retry-last（WS `retry` → `retryLastTurn`） |

- **重试决策是纯函数** `retry-plan.ts`：`planRetry` 返回 `none` / `retry-last` / `resend`（含 dropCount）；store 的 `executeRetry` 只执行 plan
- **无自动重试**：错误一律落错误气泡 + 手动按钮触发（`_errorCode` 仅用于错误展示分类）；为什么见 [ADR-0008](../../dev/decisions/0008-no-frontend-auto-retry.md)
- **撤回**：非 streaming 时最新未失败 user 消息可 withdraw；hub 不经 startRun（运行中返回 ConflictError）；成功广播 `turn_withdrawn`，reducer 从该 user 消息处截断；失败给错误气泡打 `_withdrawError`（隐藏 retry）

## 重连与历史对账

- **心跳**：每 30s ping，连续 60s 无 pong 才关闭；suspend 导致 timer 大幅跳跃时重置探测窗口防误杀；web 壳 hidden ≥30s / bfcache 恢复时主动 probe（5s 短超时）强测死链
- **重连退避**：`[1, 2, 5, 10, 30]s`，上限 10 次（超限 `reconnectFailed` + 手动重连）；fatal 4401 不重连
- **对账流程**：onopen → `historyStatus: syncing` → 拉最新一页历史 → 期间入站事件缓冲 → 对账完成后与历史合并一次性 reduce
  - `mergeHistoryMessages` 按 `_messageId` 去重：未持久化的 transient 消息被丢弃、乐观 user 消息由持久化行替换
  - 进行中回合由缓冲的 run 快照重放从零重建——重放因此无需事件级幂等
- 对账失败按 `[1, 2, 5]s` 退避重试；全失败时仅「从未 ready 过」的会话置 `historyError`（曾 ready 的保持 ready，缓冲事件仍会被应用）
- **分页**：`GET .../sessions/:id/messages?limit=&before=`，默认 20、clamp [1, 200]；shape `{ entries, hasMore, oldestId }`
  - `id` / `oldestId` 在 events 投影路径为事件 seq，legacy 路径为 messages 表行 id——两者都是单调 cursor，前端无需区分
  - entry 可携带可选 `source: "triggered"` + `triggerName`（trigger 发送标记，仅 events 投影路径；legacy 路径无此字段）
- **页原子性**：events 投影与 legacy 两条路径都在页首遇孤儿 toolResult 时向后扩展页边界，保证单页内 toolCall/toolResult 配对自洽——前端按页解析、跨页不重新配对
- 上翻加载 `loadMore` 以 `oldestLoadedId` 为 cursor，守卫 `hasMore && !loadingMore`

## 滚动（column-reverse 方案）

- 容器 `flex flex-col-reverse`、消息数组 reverse 渲染：DOM newest→oldest，`scrollTop = 0` 即底部——流式 token 到达时末条在底部增长，**原生逐帧贴底无需 JS 节流**
- JS 介入点共三处：load-more 前捕获 `scrollTop`、渲染后恢复（阅读位置不被 prepend 扰动）；用户发送时 `scrollToBottom("smooth")`（目标 `top:0`）；首次挂载时恢复保存位置或 instant 贴底
- 「回到底部」FAB 显隐：`scrollTop >= -100px` 即视为贴底
- session 切换按 store 中 `scrollPosition` 恢复：保存值 < 0（曾离开底部）才恢复，否则 instant 贴底；恢复在 `useLayoutEffect` 中执行规避 remount 读到脱离 DOM 的值
- 已知取舍：DOM 顺序 newest→oldest，屏幕阅读器从最新消息读起

## 类型归属

- `ChatMessage`、`ToolCallInfo`、`HtmlCard` 等 chat 内部类型集中在 `features/chat/types.ts`；`lib/types.ts` 只保留 contract re-export 与应用级类型
- `lib/` 原则上不反向 import feature——`lib/web-resume-probe.ts` 是已知例外（bridge 性质，订阅 chat runtime 与 bus store）
