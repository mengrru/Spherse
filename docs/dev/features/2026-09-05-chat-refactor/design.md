# Chat 协议与前端架构重构（协议先行）

- 日期：2026-09-05
- 分支：`feat/chat-refactor`（多个 PR）
- 状态：设计已与用户对齐；sub agent review 完成（1C/5I/5M/3m，反馈已全部处理并入正文），待实施
- 前置：`docs/dev/features/2026-08-21-session-event-log/`（events 表 + 连续 seq + fold 已合入；其 §9 明确留下「WS 直播流协议不改」的缺口，本 feature 补上）
- 范围：`@spherse/contracts` + `@spherse/server`（协议、hub、trigger 收口、性能）+ `@spherse/app`（四层重划分）

## 背景与动机

chat 前端分层骨架已存在（runtime 连接类 / streaming-store / model 纯函数 / 组件），本次重构解决的是两个根问题及其衍生病灶：

### 根问题 1：wire 协议里消息没有身份

持久层已是标准事件溯源（events 表主键 `(session_id, seq)` 连续单调，`core/store/session.ts`），但 WS 协议未利用：

- 服务端推送的流式事件不带 seq/id（`contracts/websocket.ts`，仅 `turn_withdrawn` 有 seq）
- 客户端消息身份 `_messageId` 只能靠 HTTP 拉 history 建立；乐观 user 消息靠**内容字符串匹配**去重（`app/features/chat/model/chat-history.ts:49`）
- 重连恢复 = 重刷最近 20 条 history + `mergeHistoryMessages` 合并 + 缓冲事件重放（`chat-session-runtime.ts:100-158`）；合并时无 id 的流式中气泡被丢弃，若缓冲为空，断线前积累的流式文本从 UI 消失（`chat-history.ts:54`）
- 发送无 ack：断线窗口内消息成败未知；hub `attachment.sendMessage` 未 ready 时静默丢弃（`chat-session-hub.ts:77`）
- `MessageList` 用 `key={index}`，loadMore 前插时 React 复用错位（`MessageList.tsx:69`）——transient 消息无稳定 id 是根因

### 根问题 2：WS 连接管理两套重复实现

chat（每 session 一条，`chat-session-runtime.ts`）与 bus（全局一条，`bus-store.ts`）各自实现心跳（30s/60s）、退避表 `[1,2,5,10,30]s`、resume probe（5s），细节分叉：chat 有 fatal 4401 + 重连 10 次上限、bus 无限重连；chat 用 `awaitingPongSince`、bus 用 `lastPongAt`。

### 次级问题（多为根问题下游）

- `streaming-store` 525 行职责过载（连接装配/引用计数 TTL/乐观发送/重试撤回审批/分页/rAF 批处理）；`streaming` 状态双写到 `project-data-store` 6 处手动同步；三条 history HTTP 路径（loadMore/refreshHistory/reconcile）无互斥
- reducer 依赖「数组最后一条 assistant」定位（`chat-session-reducer.ts:82` 起），`turn_start`/`turn_end` 被解析但忽略——最后一条是历史气泡时新 run 首 tool call 误入
- trigger run 绕过 hub（`core/factory.ts:103-110` SessionPort 直连 SessionManager）：浏览中的 WS 客户端收不到 trigger run 的流式事件与 run_status，channel.running 与真实状态脱节
- history 分页每次全量 readEvents + 全量 fold + 内存切片（`core/project-manager.ts:202-210`），O(全 log)
- 每条出站 WS 事件跑一遍 TypeBox 校验（`ws-chat.ts:31`），流式高频下是纯开销
- close code 只有 4401，`MigrationRequiredError` 等不可恢复错误走 1000 导致客户端白重连

## 已确认的关键决策

| # | 决策 | 内容 |
|---|---|---|
| 1 | 协议先行 | 先定 contracts（seq/echo/since 重放/close code），再动前端；避免 reducer 合并语义写两遍 |
| 2 | 重放词汇 = 原始持久化事件 | connect 带 `since`，服务端重放 `seq > since` 的**原始 SessionEvent**（非投影 entries）——撤回/重试的「删除」语义天然表达，无 fold 成本 |
| 3 | 游标 = 客户端 per-connection 状态 | 保留多客户端同看一个 session 的多对一模型；服务端不存 session 级游标 |
| 4 | 前端四层 | L1 通用 WS 抽象（chat/bus 共用）→ L2 per-session 域状态 store（统管消息/连接投影/分页/游标，ws 生命周期为其 action）→ L3 身份化 reducer + 视图模型 → L4 纯渲染 |
| 5 | trigger 收口 + 服务端性能纳入本次 | 实现分 PR，同一 design doc |
| 6 | 快照机制保留 | 进行中 run 的流式部分无持久化形态，attach 时的压缩快照（`runEvents`）与游标重放并存、按身份去重 |
| 7 | control 事件落库 | `control/requested`/`control/resolved` 进 SessionEventMap（append → emit，persist-before-callback 同款）；wire 事件附 seq 并纳入游标推进集合；`rejectAll`(abort) 补发 `resolved {aborted}` 修多端缺口；pending 投影 = requested 未配对 resolved 且无 `turn/end` 隔断（repair 合成的 turn/end 自动排除崩溃悬空）。快照收缩见 §1.8 |

## §1 Wire 协议 v2（`contracts/websocket.ts`）

### 1.1 连接握手与重放流程

connect URL 增加可选 query 参数 `since`（数字，**取值域 ≥ -1**：`-1` 表示从头全量重放，与 `getSessionLastSeq` 的空日志哨兵值一致；非整数或 < -1 忽略、视为未携带）。attach 成功（restore ready）后服务端按序发送：

```
1. session_ready   { lastSeq, replay: true }     ← 能力握手 + 服务端当前最高 seq
2. replay_events   { events: SessionEvent[] }     ← 仅当 since 存在：seq > since 升序，分批（每批 ≤200）
3. replay_done     {}                             ← 重放结束标记
4. （现有流程）当前 run 压缩快照 + run_status
5. 进入正常订阅
```

关键实现约束（hub）：

- 重放数据源用 channel.runtime 持有的**内存事件日志尾部**同步切片（经 SessionManager 门面读取，见 §2.2），切完在同一 tick 内加入 subscribers——避免「读期间新事件既不在重放里又未订阅到」的缝隙（Node 单线程 + better-sqlite3 同步读，天然原子）；**replay 分批为纯同步循环，不 yield 事件循环**（若需异步背压则改为「先订阅、后重放、按 seq 幂等去重」的顺序无关方案，二选一，实现时定死并加契约测试）
- 回退判定：新 server 协议保证 `session_ready` 恒为 attach 后首个事件——新客户端以「收到的首个事件不是 `session_ready`」判定旧 server，走 legacy 对账路径（web PWA 连旧桌面 server 的兼容层，退出条件见 §7）；不用超时判定，避免 restore 慢导致误回退
- 旧客户端收到新事件类型：其内置 contracts 的 closed union parse 失败 → 现有 runtime 静默丢弃，无破坏（`chat-session-runtime.ts` onmessage try/catch）

### 1.2 服务端 → 客户端事件变更

| 事件 | 变更 | 说明 |
|---|---|---|
| `user_message`（新增） | `{ seq, message, clientId?, source?, triggerName? }` | **user 消息回显/ack**。hub 在 `user/message` 落库后广播给全部订阅者；发送方按 `clientId` 结算乐观消息，其他客户端按 seq 插入。`source`/`triggerName` 透传 `SendMessageMeta`（`core/session/events.ts:6-9`，已存在）。HTTP 静默发送路径（`startDetachedRun`）无 clientId，echo 照发、仅推进其他端游标，行为自洽 |
| `message_end` | 增加 `seq?: number` 与 `messageId?: string` | seq = 对应持久化事件（`assistant/message` 或 `tool/result`）的 seq；流式气泡获得持久身份。配对机制见下方「不变的部分」 |
| `agent_end` | 增加 `seq?: number` | = `turn/end` 的 seq |
| `turn_retried`（新增） | `{ seq, abandonedSeqs: number[] }` | retry 的多端同步：今天只有发送方本地知道重试弃置，其他端靠 HTTP 对账补 |
| `session_ready` / `replay_events` / `replay_done`（新增） | 见 1.1 | |
| `replay_events.events[]` | 原始 SessionEvent 信封（type/seq/time/data） | 复用 `@spherse/core` `SessionEventMap` 词汇，contracts 侧 schema 镜像导出 |

不变的部分：pi 流式事件族（`message_start/update`、`tool_execution_*`）payload 透传不动。**流式消息的 wire 身份是 hub 生成的 `messageId`**（run 级自增 `m1/m2/...`，由 hub 注入 `message_start/update/end`）：pi message payload 运行时**没有 id 字段**（`pi-ai` 构造 assistant message 不赋 id，类型亦未声明，已实证 `anthropic-messages.js` stream 构造），不能作为 stitch 身份。`message_end.seq` 的配对机制是**实例引用相等**：`persistMiddleware` 落库时传入的 message 实例与 wire `message_end` 的 payload 是同一引用（appendBatch 不 clone），hub 以 run 级 WeakMap 引用→seq 配对——该行为由 server 真 runtime 契约测试钉住。

### 1.3 客户端 → 服务端事件变更

`message` 增加 `clientId?: string`（客户端生成的 uuid，**可选**——旧客户端发送不带 clientId 时 `parseChatClientMessage` 必须放行，server 对缺失 clientId 的消息不做结算、echo 照发；若做成必填会直接打断「旧 app + 新 server」组合的发消息路径）。用于 `user_message` 回显结算。

### 1.4 游标语义

- 游标 = 客户端本地已应用事件的最高 seq；更新一律 `cursor = max(cursor, seq)`，**永不回退**——`turn_withdrawn` 的 wire seq 是被撤回 user 消息的 seq（小于当前游标，因被撤的 assistant `message_end.seq` 更大），只用于截断不用于推进回退
- live 推进集合：`user_message`、`message_end`、`agent_end`、`turn_retried`、`turn_withdrawn`（每条 wire 事件携带的 seq）
- 重放推进：`replay_events` 中每条事件（含 no-op 的 `turn/start`、`compaction/applied`）都推进
- `turn/start`、`compaction/applied` 不上 wire（live 场景无 UI 效果；重放场景已覆盖；冷启动走 HTTP 投影）——游标因此可能出现空洞，无害：重放按 `seq > since` 读取是幂等超集
- TTL 清理消息时**保留游标**，重 attach 走增量重放；页面刷新游标丢失 = 冷启动全量，可接受

### 1.5 重放与快照的重叠去重（reducer 不变量）

重放（持久事件，按 seq）与快照（pi wire 事件，按 hub 生成的 messageId）存在交集。规则：

1. 持久事件按 seq 幂等：本地已有该 seq → skip
2. wire 事件按 messageId stitch；`message_start` 到达时该 messageId 已绑定 seq（重放已给过）→ skip
3. `message_end` 的 seq 已知但 messageId 未见过（重放在先）→ 以持久事件为准，跳过 wire 侧内容
4. live 期间 `message_end` 同时携带 messageId 与 seq，客户端据此建立 messageId→seq 绑定，供重连快照去重
5. 以上不变量用 reducer 性质测试锁住（§9）

### 1.6 close code 族

```
4400  PROTOCOL_ERROR        非法客户端消息（替代现在的 error 事件后 1000）
4401  SESSION_UNRECOVERABLE （现有）
4402  MIGRATION_REQUIRED    restore 抛 MigrationRequiredError
```

客户端 fatal 集合 = {4400, 4401, 4402}，收到即停止重连——4400 必须入 fatal：客户端自身 bug 产生非法消息时若当瞬时错误处理，会陷入「connect → send → 4400 → reconnect」死循环（现状是 error 事件软失败 + 连接保持，改 close 后语义必须配套收紧）。瞬时错误维持 1000 关闭触发重连。

### 1.7 版本兼容矩阵

| 组合 | 行为 |
|---|---|
| 新 app + 新 server | 完整 v2：游标重放、echo、ack |
| 旧 app + 新 server | 旧 app 忽略新事件类型（parse 失败静默丢弃）；新增字段 TypeBox 默认放行 additionalProperties，无破坏 |
| 新 app + 旧 server | 无 `session_ready` → 回退 legacy 对账（现有代码路径保留至版本门槛提升） |

### 1.8 快照收缩与 control 落库（PR4/PR5 联动，服务端不可单方面先行）

快照（`runEvents`）与游标重放的分工审计：**已完成消息（`message_end` ⟺ 已落库）在快照里是纯冗余**——游标重放必然覆盖；流式中的 partial 消息与执行中工具也不依赖快照——累积快照语义下，重连后**下一条 live 事件即全量补偿**；快照保留 in-flight 的 start + 最后一条 update 只是把「静默期（LLM 卡顿/长工具）重连的空窗」从几十秒缩到零，是 UX 补偿而非正确性需求。

**唯一正确性需求是 pending control_request**（不落库、一次性广播、不会再发）——由决策 #7 落库解决。关键不变量：pending 期间 run 阻塞在 gate 上、无后续落库，`control/requested` 必然紧邻 log 尾部，因此冷启动（游标 = HTTP 首页最后 message 的 seq）与重连的游标重放**必然覆盖**它。

收缩后快照 = O(in-flight)：开放消息窗口的 start + 最后一条 update + 执行中 tool_execution；control 事件落库后快照中保留双通道副本（reducer 按 requestId 幂等），稳定后可删。快照另加字节/条目预算兜底。

前置条件：客户端 reducer 须支持「无完整前史的快照」与「update 懒建气泡」（messageId 机制支持）+ `applyPersistedEvent` 消费 control 事件，故归入 PR4 前后端同改；core 词汇表与落库点在 PR5 先行。

## §2 服务端改造

### 2.1 seq 上 wire 的内部通道

优先复用 `SessionEventLog` 现成的订阅机制：`appendBatch` 落库后已同步 notify 订阅者（`event-log.ts:50-58,66-71`），且覆盖面比扩展 onEvent 更全（`withdrawLastTurn`、afterTurn hooks、repairLog 追加都走 append 而无 onEvent）。

persist→wire 的翻译/富化收敛在 **`ChatWireProjector`**（`server/chat-wire-projector.ts`，结构化类型、零框架依赖的纯状态机）：消费 log 事件产出 echo/`turn_retried` 广播、维护 `pendingClientId`/引用→seq 配对/run 级 messageId 序列/`lastTurnEndSeq`，并对 pi wire 事件做富化。**单 session 生命周期收敛在 `ChatChannel`**（`server/chat-channel.ts`，每 session 一实例）：restore→ready、日志订阅、attach（连接级生命周期为 attach 闭包，不单独抽象）、run 序列化、快照压缩、握手重放、fanout、空闲自清理，持有 projector。`ChatSessionHub` 退化为注册表（`Map<key, ChatChannel>` + getOrCreate + 身份守卫删除回调）——协议翻译的外部不变量（persist-before-callback 引用配对、pi 顺序流模型）从 hub 的跨方法共享可变状态收敛为 projector 的模块内局部状态，projector 可独立单测（无 runtime mock）。

clientId 传递：WS 层 `attachment.sendMessage(content, attachments, clientId?)` → hub 侧拼 echo（实现时二选一：SendMessageMeta 扩展或回调回传，契约测试钉住「echo.seq == user/message seq」）。compaction/repair 事件经此通道到达但不上 wire（无 UI 效果）。

### 2.2 ranged read 与 SessionManager 门面

`SessionStore` 增加 `readEventsAfter(sessionId, sinceSeq, limit)`：SQL 下推 `WHERE session_id=? AND seq>? ORDER BY seq LIMIT ?`，主键天然索引，O(limit)。

hub 持有的是 `SessionManager` 而非 store，且其 sessions map 为 private、server 侧不持有 SessionStore 引用——已在 `SessionManager` 上补**门面方法**：`readSessionEventsAfter(agentId, sessionId, sinceSeq, limit)`（优先内存日志尾部，未激活 session 回落 store 查询）、`getSessionLastSeq(agentId, sessionId)`（返回 -1 表示空）与 `subscribeSessionEvents(sessionId, listener)`。这是 §1.1「同 tick 切片 + 订阅」论述成立的前置条件，纳入 §9 契约测试。重放不做 fold——原始事件直出，这是「重放词汇 = 原始事件」决策的性能红利。

### 2.3 trigger run 可见性：log 派生（推翻原 wrapSessionPort 收口方案）

> 历史记录：初版实现（PR #89，已关闭）采用 `wrapSessionPort` 钩子把 trigger 的 sendMessage 路由经 hub channel（`startRunWithMeta` 完成语义）。用户 review 推翻：channel 本就订阅 event log，可见性应在反向路径自然产生，正向路由引入了 wrapper 倒灌、`meta.agentId` 走私、惰性 projectId 盒等时间耦合补丁。重做为下述方案。

现状：trigger capability 经 sessionPort 直连 SessionManager；channel 订阅 `SessionEventLog`。**关键观察：直连 run 的全部持久化事件（user/message、turn/start、assistant/message、turn/end、control/*）本来就流经 log 订阅**——echo、turn_retried 广播、消息内容对已 attach 的订阅者天然可见。唯一缺的是 `run_status`（channel 私有 `running` 标志不知道非自己发起的 run），而 run 边界就在 log 里。

- **run_status 派生化**（`ChatWireProjector`）：跟踪 open turn（有 `turn/start` 无配对 `turn/end`），在 log 订阅路径发布 `run_status` 翻转（幂等：重复 turn/start / 落单 turn/end 不发）；`isRunActive()` 供握手（`run_status` 初值）与 `cleanupIfIdle`（busy 判定 = 自有 run ‖ log open turn，防止直连 run 进行中销毁 session）
- channel 的 `running` 退化为「自己发起的 run」标志：只服务快照捕获与自有发送的 409 互斥；`startRun` 不再手动 publish `run_status`（log 路径接管，含 WS/HTTP 发送路径——顺序变为 echo → run_status(true) → 流式 → run_status(false) → agent_end）
- **core 是唯一互斥点**：`ensureNotBusy` 不变；trigger 撞运行中 session 维持 ValidationError → trigger failed 现行为
- trigger executor 零改动（不路由、不加 meta）；hub/registry/factory 零新增钩子
- trigger 完成通知仍走 bus trigger 频道（TriggerEventBridge 的 query 失效职责不变，删掉的只是 refreshHistory 部分，见 §7）
- 契约测试：`trigger-log-visibility.test.ts`——真 createProject（无任何 wrapper）+ hub attach + 真实 triggerManager fire 直连发送，断言订阅者收到 echo（source/triggerName）+ run_status 双向翻转 + 完成内容 + trigger success 日志

**有意识的取舍**：① 直连 trigger run 无实时流式——partial 只在 pi 内存流，打开的页面看到消息在 `message_end` 落库时完整弹出（仍优于旧态「完全不可见直到 refreshHistory」）；mid-run attach 同理（已完成部分 + run_status true，无 in-flight 快照）。② trigger 失败对 chat 订阅者不可见（trigger 有自己的 toast/日志渠道）。若未来要流式可见，是「core 广播 in-flight」的独立课题，不属于本次重构。

### 2.4 分页性能（增量 fold 缓存）

`getRecentSessionHistory`（`project-manager.ts:181`）的 events 路径从「全量读 + 全量 fold + 切片」改为 **fold-on-write 缓存**：缓存挂在 project-manager 的会话历史读取处（按 sessionId 键控、事件数作版本号失效、LRU 上限），**不挂在 SessionManager 内存日志上**——未激活 session（未 create/restore，无内存日志）的分页读也要覆盖，否则列表/预览路径的 O(全 log) 依旧。正确性用性质测试锁住：「任意事件序列后，缓存投影 == 全量重 fold」。legacy 路径不动。

### 2.5 出站校验降级

`ws-chat.ts:31` 的 `parseChatServerEvent` 出站校验移到测试（server 契约测试对每类事件 pin schema），生产路径直发；保留 `SPHERSE_VALIDATE_WS=1` 环境变量开关供调试。

## §3 前端 L1：通用 WS 抽象（`app/src/lib/ws/`）

`WsConnection` 类，配置化策略，chat 与 bus 共用：

```ts
interface WsConnectionConfig {
  url: () => string;                       // 每次连接时求值（token 可能刷新）
  heartbeat: { pingIntervalMs; pongTimeoutMs };
  backoffMs: number[];                     // chat/bus 同表 [1,2,5,10,30]s
  maxRetries: number;                      // chat: 10, bus: Infinity
  fatalCloseCodes: Set<number>;            // chat: {4401,4402}, bus: 空
  probeTimeoutMs: number;                  // resume probe 用
}
```

- 显式状态机：`connecting → open → (waiting-backoff → connecting)* → failed | fatal | closed`——`waiting-backoff` 独立成态，修复 ConnectionBanner 把退避等待与连接尝试混为一谈的问题
- API：`send(data)`、`close()`、`probe()`、`onMessage`、`onStateChange`；心跳采用 chat 侧现语义（`awaitingPongSince` 精确等待，bus 向其对齐）
- 纯 TS 类不进 React/zustand；bus-store 保留 zustand 壳（resumedAt、频道订阅状态），连接委托给 WsConnection，对外 API 不变——5 个 bus 桥（ContentQueryBridge 等）零改动

## §4 前端 L2：chat session 域 store

新 store（`features/chat/runtime/` 下，命名实现时定，倾向 `chat-session-store`）取代 `streaming-store` + `chat-runtime-registry` + `ChatSessionRuntime` 三件套：

- **状态**：`sessions: Record<sessionId, ChatSessionState>`，每项含 `connectionStatus`（L1 状态机投影）、`historyStatus`、`messages`（视图态 ChatMessage）、`streaming`、分页 `{hasMore, oldestLoadedId, loading}`、`cursor`、`scrollPosition`
- **连接**：每 session 一个 `WsConnection` 实例（url 带 since），attach/detach 引用计数与 TTL 沿用现语义；TTL 清消息、保游标；`ChatSessionRuntime` 类溶解——连接策略进 L1，**重连 reconcile 被游标重放整体取代（删除）**；legacy 回退是另一段独立逻辑（「首事件非 session_ready → HTTP 首页拉取 + 合并」的冷对账），落在新 store 内保留并用结构测试钉住存在性；send/abort/retry/withdraw 收敛为 store action
- **action**：`send`（乐观插入 + clientId + echo 结算）、`abort`、`retry`、`withdraw`、`resolveControl`、`loadMore`、UI SDK 的 `sendMessage` 复用同一 action（HTTP fallback 保留在 action 内，消灭第三条发送路径）
- **派生**：`streamingSessionIds` 改为 selector 导出，`project-data-store` 删除 streaming 字段（只留 initialMessage），消灭 6 处手动同步
- **事件批处理**：保留 rAF 批量归约，补 `setTimeout` 兜底修后台 tab 冻结
- 新 store 必须加入 `project-lifecycle.ts` 的 `clearProject` 级联清单（`project-lifecycle.structure.test.ts` 会强制）
- 命名清理：现 `ChatRuntimeProvider`（runtime-context.tsx，只是 `{sessionId, agentId}` context）更名（如 `ChatAgentContext`），让出 Runtime 词汇

## §5 前端 L3：身份化 reducer + 视图模型

- **双入口归约**：`applyWireEvent`（pi 流式事件，按 message id stitch）+ `applyPersistedEvent`（原始 SessionEvent，按 seq 幂等）——撤回/重试的截断走两条明确路径：wire 侧 `turn_withdrawn` 按「删至该 user seq」、persisted 侧按 `[data.seq, event.seq)` 区间（`fold.ts:95-105`）；`turn/retried` 按 abandonedSeqs 移除——替代 `mergeHistoryMessages` 的 transient 过滤 + 内容匹配合并
- **turn 感知**：`turn_start`/`agent_end`（= turn/end）维护 run 边界，消息按 turn 归组，废除 `prev[length-1]` 定位——修掉「新 run 首 tool call 误入历史气泡」
- **冷启动合并**：HTTP 首页 entries 与本地 live 态按 seq/id 合并（现 `_messageId` 机制保留，范围缩小到冷启动 + loadMore）
- **视图模型下沉**：`groupTurns`、superseded 计算（现渲染期 `MessageList.tsx:37-42`）移到 model 层纯函数输出，渲染层只消费；key 全部用稳定身份（seq / message id / clientId）

## §6 前端 L4：渲染层修复

- `MessageList` key 稳定化（依赖 L3 身份）
- ConnectionBanner 消费 L1 状态机（`waiting-backoff` 独立文案）
- `HtmlCard` 取数解耦：previewUrl fetch 从组件抽到注入 loader / query
- 组件不再 `useStreamingStore.getState()` 反向调 action，统一经 hook
- 其余小项：Composer mimeType 跟随压缩输出、`findProjectSession` N+1 探测收敛（可与本重构解耦，顺手修）

## §7 拆除项

| 拆除 | 条件 |
|---|---|
| `ChatSessionRuntime` + registry + **重连 reconcile** | PR3（游标重放上线；legacy **冷对账**路径保留在新 store，见 §1.7/§4） |
| `mergeHistoryMessages` transient 过滤 / 内容匹配合并 | PR4（新 reducer） |
| `TriggerEventBridge` 的 refreshHistory 调用 | PR5（log 派生可见性后 live 事件可达；session 列表 query 失效保留） |
| `project-data-store.streamingSessionIds` | PR3（改 selector） |
| legacy 冷对账路径（新 app + 旧 server） | 保留至 web 版本兼容门槛提升（`lib/version-compat.ts` minVersion 覆盖 v2 server），单列小 PR 删除 |

## §8 PR 切分

| PR | 内容 | 依赖 |
|---|---|---|
| PR1 | contracts v2 + server：echo/seq 富化、since 重放、SessionManager 门面 + readEventsAfter、close code 族、出站校验降级 + 契约测试 | 无 |
| PR2 | app L1：`WsConnection` + bus-store 迁移（行为对齐测试） | 无（可与 PR1 并行） |
| PR3 | app L2：session store + 游标重放接入，删重连 reconcile，streaming 派生化 | PR1、PR2 |
| PR4 | app L3+L4：身份化 reducer、视图模型、渲染修复 | PR3 |
| PR5 | core+server：control 事件落库 + run_status log 派生化（§2.3）+ 分页 fold 缓存；删 TriggerEventBridge 的 refreshHistory | PR1 |
| PR6 | 文档同步 + legacy 冷对账路径清理评估（视版本门槛） | 全部 |

每个 PR 独立可合：PR1/2 无行为耦合，PR3 是最大风险点（连接与数据流同时换），PR4 纯前端可回滚。**PR3 必须在 PR5 合入后才可合**：删 refreshHistory 依赖 log 派生可见性在先（run_status 派生 + control 落库），否则 attach 中的 session 在 trigger run 期间失去唯一补偿通道。

## §9 测试策略

| 层 | 测试 |
|---|---|
| core | `readEventsAfter` 边界（since=0/中间/超尾部）；SessionManager 门面（内存优先/store 回落一致性）；fold 缓存性质测试（随机事件序列 → 缓存投影 == 全量重 fold） |
| contracts/server | 契约测试：重放顺序（session_ready → replay → replay_done → 快照 → run_status）、echo.seq == user/message seq、message_end.seq 配对、close code 映射、门面契约测试（hub 经门面读到的尾部 == 落库事件）；按仓库红线，server/desktop 对 SessionPort 门面各保留一条不 mock 被测方法的真实边界测试 |
| app L1 | 状态机单测（退避序列、fatal 停止、probe、pong 超时）；bus 迁移行为对齐测试（订阅重放、resumedAt 语义不变） |
| app L3 | reducer 性质测试：随机 (live wire + replay + history) 交错流 → 不变量（无重复 seq、id↔seq 绑定一致、重放合并结果 == 全量重建、按 seq 截断正确） |
| app L2 | store 测试：引用计数/TTL 保游标、乐观消息 echo 结算、断线窗口 send 失败标记、多 session 隔离 |
| E2E | 断线重连重放（含「断线期间 run 已结束」场景）、双端同看一个 session、trigger run 可见性；合并前 `npm run verify:e2e` |

## 明确不做（本次）

- streaming chunk 落盘（快照机制已覆盖进行中 run）
- bus WS 与 chat WS 合并为单连接多路复用
- HTTP history 端点改游标重放协议（冷启动/loadMore 维持 entries 分页）
- 出站事件的完整 payload schema 化（contracts 精确化另行立项，见 session-event-log「明确不做」）
- 全量 history 端点删除（遗留面，另行清理）
- WS 鉴权从 query token 迁移（独立安全问题）

## 风险与对策

| 风险 | 对策 |
|---|---|
| 重放与快照重叠去重出错（重复气泡/丢内容） | §1.5 不变量 + reducer 性质测试；PR3 灰度期内保留 HTTP 刷新按钮兜底 |
| `message_end.seq` 引用配对依赖 persistMiddleware 不 clone 落库实例 | 真 runtime 契约测试钉住引用一致性；pi/core 升级若引入 clone，富化退化为无 seq（有守卫、不崩），契约测试立即失败暴露 |
| pi message 无 id、messageId 由 hub 生成 | messageId 只在 wire 层使用、run 级作用域，不落库、不进 core；重连快照保留 messageId（runEvents 存富化后事件） |
| hub 改动破坏多订阅者广播 | hub 单测覆盖多 subscriber echo/重放互不干扰 |
| bus 迁移波及 5 个桥 | L1 对外 API 与 bus-store 壳不变；E2E bus 场景回归 |
| trigger 收口改变错误时序 | 收口前后 trigger 失败路径行为对齐测试（ConflictError ↔ ensureNotBusy） |
| 新 app + 旧 server 回退路径腐化 | legacy 对账路径用结构测试钉住存在性，版本门槛提升后立即删 |
| TTL 保留游标导致陈旧 session 重放放大 | 游标为纯数字，内存可忽略；重放量 O(增量) 由 readEventsAfter 保证 |
| streaming 双写删除引发 UI 回归 | PR3 内 selector 替换 + SessionRow spinner 单测 |
