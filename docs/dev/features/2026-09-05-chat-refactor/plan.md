# Chat 重构实施计划

对应 [design.md](./design.md)。每个 PR 独立实现、独立 review、独立合入；勾选随实施更新。

## PR1 协议 v2（contracts + server）

- [x] contracts：`session_ready` / `replay_events` / `replay_done` / `user_message` / `turn_retried` schema；`message_end.seq` / `agent_end.seq` 可选字段；`message.clientId`（**可选**，旧客户端发送不带 clientId 必须放行）；close code 4400/4402；`SessionEvent` 信封 schema 镜像导出
- [x] core：`SessionStore.readEventsAfter(sessionId, sinceSeq, limit)` SQL 下推 + 单测
- [x] core：`SessionManager` 门面 `readSessionEventsAfter` / `getSessionLastSeq`（内存日志优先、store 回落）+ 契约测试
- [x] server hub：经 `SessionEventLog.subscribe` 订阅落库事件（`event-log.ts:50-58` 现成机制）——`user/message` → `user_message` echo（clientId + source/triggerName）；`turn/retried` → `turn_retried` 广播；`message_end`/`agent_end` seq 富化；翻译/富化收敛在 `ChatWireProjector` 纯状态机（独立单测，hub 只留 channel/run 生命周期与 fanout）
- [x] server hub：attach 握手流程（session_ready → since 重放 → replay_done → 快照 → run_status），门面同步切片 + 同 tick 订阅；分批纯同步循环不 yield 事件循环
- [x] server ws-chat：close code 映射（4400/4402）；出站 TypeBox 校验移到测试、保留 `SPHERSE_VALIDATE_WS` 开关
- [x] 契约测试：重放顺序、echo.seq 配对、message_end.seq 配对、close code、多 subscriber 互不干扰
- [x] 兼容验证：旧 app 连新 server 不报错（新增事件被丢弃、新增字段放行）**且旧 app 发送不带 clientId 的 message 成功**（`agent-event-parse` 返回 undefined 丢弃新事件 + 单测钉住；clientId 可选已由 wire schema 测试钉住）

## PR2 前端 L1 WsConnection（可与 PR1 并行）

- [ ] `lib/ws/WsConnection`：状态机（connecting/open/waiting-backoff/failed/fatal/closed）、心跳、退避、probe、fatalCodes、maxRetries 配置化
- [ ] 状态机单测：退避序列、耗尽转 failed、fatal 停止、pong 超时、probe
- [ ] bus-store 迁移到 WsConnection（对外 API、resumedAt 语义不变），行为对齐测试
- [ ] E2E：bus 相关场景回归（fs-watch 失效、trigger 通知）

## PR3 前端 L2 session store + 游标重放（依赖 PR1、PR2，且须在 PR5 合入后合并）

- [ ] 新 `chat-session-store`：状态结构（connection/history/messages/streaming/分页/cursor/scroll）
- [ ] attach/detach 引用计数 + TTL（清消息保游标）；`ChatSessionRuntime`/registry 溶解删除，**删的是重连 reconcile**
- [ ] 游标重放接入：connect 带 since、首事件非 `session_ready` 判定旧 server → legacy **冷对账**路径（HTTP 首页拉取 + 合并）保留在新 store，结构测试钉住存在性
- [ ] actions：send（乐观 + clientId + echo 结算）/ abort / retry / withdraw / resolveControl / loadMore；UI SDK send-message 复用同 action
- [ ] `streamingSessionIds` selector 化；`project-data-store` 删 streaming 字段
- [ ] rAF 批处理补 setTimeout 兜底
- [ ] 加入 `project-lifecycle` clearProject 级联（过 structure test）
- [ ] streaming-store 消费方迁移点位清单：`web-resume-probe.ts`（resumeProbeAll）、`ApprovalNoticeBridge.tsx`、`ui-sdk/handlers/send-message.ts`、`useChatScroll.ts`（scrollPosition）、`chat/index.tsx`（hasMore/loadingMore/loadMore）、`TriggerEventBridge.tsx`、`project-lifecycle.ts`——统一改新 store 引用，不留旧导出名过渡
- [ ] store 测试 + E2E 断线重连重放（含断线期间 run 结束、双端同 session）

## PR4 前端 L3/L4 reducer + 渲染

- [ ] `applyWireEvent`（message id stitch + turn 感知，废除尾部定位）+ `applyPersistedEvent`（seq 幂等、按 seq 截断/移除，**消费 control/requested、control/resolved**）
- [ ] 冷启动 entries 合并缩小化；删 `mergeHistoryMessages` transient 过滤/内容匹配
- [ ] reducer 支持「无完整前史的快照」与 update 懒建气泡；服务端同步落地快照收缩为 O(in-flight) + 字节预算（design §1.8）；control 事件按 requestId 幂等去重（快照/重放双通道）
- [ ] 视图模型下沉：groupTurns / superseded 进 model 层；MessageList key 稳定化
- [ ] ConnectionBanner 消费新状态机（waiting-backoff 独立文案）
- [ ] HtmlCard 取数解耦（loader 注入）；组件去除 `getState()` 反向调用
- [ ] 顺手修：Composer mimeType、`ChatRuntimeProvider` 更名
- [ ] reducer 性质测试（随机事件流不变量）+ store 结构测试更新

## PR5 trigger 收口 + control 落库 + 分页性能（core + server，依赖 PR1）

- [x] core：`assembleProject` 增加 `wrapSessionPort?: (port: SessionPort) => SessionPort` 钩子（sessionRuntime 创建后、capabilities init 前应用）；`SessionPort.sendMessage` 调用上下文补 agentId（meta 扩展路线：`SendMessageMeta.agentId`，hub 路由后剥离不入持久化）
- [x] server：hub 公开 `startRunWithMeta`（channel `startDetachedRun` 增 meta/onEvent/awaitRun 选项，trigger 走完成语义）；trigger 的 sendMessage 经 wrapSessionPort 走 hub（meta 带 source/triggerName）
- [x] core：SessionEventMap 新增 `control/requested` / `control/resolved`；AgentRunner 的 control sink 包装层 append → emit + seq 回填 wire 事件；`rejectAll`(abort) 补发 `resolved {aborted}`；fold pending 投影（requested 未配对 resolved 且无 turn/end 隔断）+ contracts 信封变体
- [x] SessionPort 门面契约测试——server 侧 `trigger-hub-routing.test.ts`（真 registry + hub + triggerManager + AgentRunner，仅 stub 最深 pi agentRef，被测路由链全真）；desktop 经 createMultiProjectServer 整体嵌入、不直接消费 SessionPort，红线由 server 侧承担（裁决记录于 design §2.3）
- [x] trigger 冲突语义对齐测试（ConflictError ↔ ensureNotBusy 行为等价；executor 单元级 + server 真边界级各一条）
- [x] fold-on-write 投影缓存挂 project-manager 层（按 session 键控、事件数版本号失效、LRU 32，覆盖未激活 session）+ `getRecentSessionHistory` 走缓存切片；性质测试（缓存分页 == 全量重 fold + 失效 + 淘汰）
- [x] 删 `TriggerEventBridge` 的 refreshHistory 调用（trigger run 此后 live 可达；query 失效保留）
- [x] E2E：~~trigger run 在已打开 session 页面可见~~——deviation：e2e 无服务端 LLM stub 模式（chat spec 均为 renderer 级 WS mock），改为 server 真实边界契约测试钉住 live 可达性（user_message echo + run_status 双向）；中间态渲染缺口（旧 reducer 丢 user_message）已在 design §2.3 记录，PR3 修复；chat-streaming-resilience / chat-retry e2e 回归通过

## PR6 收尾

- [ ] doc-sync：`docs/official/architecture/chat.md`（协议 v2、四层、游标）、`frontend.md`（bus 层、project-data-store 字段变化）、`packages/app/README.md`（状态归属表）、backlog
- [ ] 评估 legacy 对账路径删除条件（web 版本门槛）；可删则删 + 结构测试更新
- [ ] 全量 `npm run verify:e2e`

## 里程碑顺序

PR1 → (PR2 ∥ PR5) → PR3 → PR4 → PR6。PR3 为关键路径且必须晚于 PR5（删 refreshHistory 依赖 trigger 收口在先）；合入前 PR1 契约测试必须全绿。
