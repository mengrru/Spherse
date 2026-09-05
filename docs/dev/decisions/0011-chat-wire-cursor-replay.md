# ADR-0011：chat wire 协议携带 seq，重连恢复以游标重放取代 HTTP 对账

- 状态：accepted
- 日期：2026-09-05
- 影响：`@spherse/contracts`（websocket.ts 协议 v2）、`packages/server`（hub/channel/projector）、`packages/core`（SessionStore.readEventsAfter、SessionManager 门面）；renderer 侧随 chat 重构 PR3/PR4 切换

## 背景

持久层已是事件溯源（events 表主键 `(session_id, seq)` 连续），但 wire 协议不携带任何身份——客户端消息身份只能靠 HTTP 拉 history 建立、乐观消息靠内容匹配去重、重连恢复靠「重刷最近 20 条 + mergeHistoryMessages 合并」（transient 过滤会丢流式中气泡），且发送无 ack。

## 决策

- **seq 上 wire**：`user_message` echo（含 `clientId` ack）、`message_end.seq`（经落库实例引用配对）、`agent_end.seq`、`turn_retried`；流式 stitch 身份用 hub 生成的 `messageId`（pi message payload 运行时无 id 字段，不能作为身份）
- **重放词汇 = 原始持久化事件**：connect 带 `?since=`（≥ -1）时重放 `seq > since` 的原始 SessionEvent（非投影 entries）——撤回/重试的删除语义天然表达，且免 fold 成本（`readEventsAfter` SQL 下推 O(page)）
- **游标是客户端 per-connection 状态**：服务端不存 session 级游标，多客户端同看一个 session（多对一连接模型）各自进度互不干扰
- close code 族扩为 4400/4401/4402（fatal 集合），非法客户端消息从软失败 error 改为 close(4400)

## 后果

- 正：消息身份贯穿 live/replay/冷启动三路；重连增量恢复；快照与重放的冗余可审计（见 design doc §1.8，收缩与 control 落库随 PR4/PR5）
- 负：hub 对三个外部不变量新增依赖（persist-before-callback 引用配对、pi 顺序流模型、门面同步性），已由 `ChatWireProjector` 模块化收敛 + 真 runtime 契约测试钉住；旧 renderer 对新事件静默丢弃（过渡态，PR3 移除）

## 原始记录

- `docs/dev/features/2026-09-05-chat-refactor/design.md`（完整设计与 PR 切分）
