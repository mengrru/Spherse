# PR-B 实施计划：app 副本切换

设计稿：`design.md`（同目录）。本 plan 覆盖 §PR 拆分第 2 条：replica 状态机 + store 重写 + merge 层删除 + 稳定 key + 消费方迁移（#12 兼容面）。

分支 `feat/chat-replica-switch`，基于 PR-A 分支 `feat/chat-settled-frames-protocol`（协议依赖）。

## 状态模型定稿（对 design 的实现级落定）

### SessionReplica（纯状态，`replica/session-replica.ts`）

```ts
interface SessionReplica {
  durable: DurableZone;      // mode: "events" | "snapshot"
  run: RunTail;              // active / draft / toolOverlay / retrying
  pending: PendingZone;      // intents + withdrawInFlight + queuedInitial
  notices: Notice[];
  connectionStatus: "disconnected" | "connecting" | "open";
  historyStatus: "pending" | "syncing" | "ready";
  historyError: boolean;
  reconnectFailed: boolean;
}
```

帧词汇 = `ChatServerEvent` ∪ 内部生命周期帧：`connected` / `disconnected{fatal}` / `replayCompleted` / `reconnectFailed` / `syncStarted` / `syncSucceeded` / `syncFailed` / `snapshotApplied{entries, hasMore, oldestId, full}` / `legacySnapshotMode`。`reduce(state, frame)` 纯函数；`plan(state, command)` 产出出站帧。

### DurableZone（`replica/durable.ts`）

- 条目 `(seq, message, source?, triggerName?, intentId?)` 按 seq 有序插入；已存在 seq → no-op（幂等 fold：`message_end{seq}` 与 `message_settled{seq}` 等效）
- 删除：`turn_withdrawn` 删 `[seq, upTo)`、`turn_retried` 删 `abandonedSeqs`
- `highSeq` 只由前向来源（live 确认帧 / tier② / snapshot）推进；`message_settled` 带 `seq ≤ highSeq` 且条目不存在 → 水位线失效信号（reduce 置 `resyncNeeded`，sync 层消费后清除）；`loadMore` 反向插入不触发
- `mode: "snapshot"`（legacy）：条目 key 为 REST id；首次事件化数据（任一确认帧）到达 → 全量丢弃快照条目后重建，highSeq 自首帧建立
- snapshot 范围替换：只替换 `[oldestId, ∞)`，保留更早前缀；`full` 变体（水位线失效重同步）全量丢弃

### RunTail（`replica/run-tail.ts`，自 chat-session-reducer 平移）

```ts
interface RunTail {
  active: boolean;
  draft: ChatMessage | null;            // 流式 assistant 草稿（reducer 语义原样）
  tools: Map<toolCallId, ToolCallInfo>; // 瞬态 tool 状态（含卡片 / control 卡）
  retrying: boolean;                    // retry-last 发出后的视觉态（markRetrying 语义）
}
```

- 瞬态 assistant 帧管理 draft（start/update/end 同 reducer 位置语义）；`message_end{seq}` / `message_settled{seq}`(assistant) → draft settle → 出 run 区、durable 承接
- tool_execution_* / control_* 全部落 tools overlay（按 toolCallId 键控，替代 reducer「last assistant」位置匹配）
- run 结束（`run_status{active:false}` / `agent_end` / `disconnected{fatal}`）：清 draft streaming 标记、清 pending question 卡、**保留 pending approval 卡**（reducer 现行为）；`resyncSucceeded` 后丢弃仍未 settle 的 draft（未持久化 = 不存在，durable 是事实源）
- 错误事件不进 run 区 → notices

### PendingZone（`replica/intents.ts`）

- `intents: Map<intentId, {content, attachment?, state: sending|failed}>` 三态；`message_settled{intentId}` → 移除
- `error` 帧到达时 run 未激活且最近 intent 为 sending → 该 intent 置 failed（Source 1 发送失败 = 无持久化对应物 → 重试纯 send，禁止触发 withdraw）
- `withdrawInFlight`：withdraw 发出后 error 帧 → withdrawFailed notice（`_withdrawError` 语义）；`turn_withdrawn` → 清除
- initialMessage = attach 时排队的 sending intent，`connected` 帧后随发送队列冲刷；重连不重发（已 failed 的不再自动发）

### Notices（`replica/notices.ts`）

`{id, kind: "error"|"withdrawFailed", bornAtSeq, message, code?, turnError}`。瞬态 `error` 帧 → notice（run 活跃期错误标 turnError）。清除：bornAtSeq 之后的 durable error 条目（stopReason=error）/ 覆盖区间的删除帧 / 同 session 后续 user settle 成功（兜底）。渲染：error notice → 裸错误气泡；withdrawFailed → 派生视图给对应错误消息打 `_withdrawError`（抑制 retry）。

### 命令 plan（`replica/session-replica.ts`）

- `sendMessage` → ULID intentId → pending(sending) + WS `message{intentId}`；socket 未开 → intent 直接 failed
- `retry`（取代 planRetry(messages)）：
  - 存在 failed intent（末位）→ 纯 send（rebuild intent）
  - durable 末条 error assistant（`_turnError`，Source 2）→ `retry-last`（置 retrying，WS `retry`）
  - error notice 且 user 轮已落库 → `resend-composite`：先 WS `withdraw`，待 `turn_withdrawn` 后发新 intent；withdraw 被拒（error 帧）→ 回退纯 send（失败对保留 durable）
  - withdrawFailed notice → none（隐藏 retry）
- `withdraw` → durable 存在可撤回 user 轮且 run 不活跃 → WS `withdraw` + withdrawInFlight

### derive（`replica/derive.ts`）

`derive(replica) → { keyed: Array<{key, message}>, messages: ChatMessage[], streaming: boolean }`

- durable → ChatMessage：复用 chat-history 投影函数（user/assistant/toolResultMap/卡片增强），按 run 窗口聚合 `_runChanges`（aggregateFileChanges 从页级改窗口级调用）；`_messageId = seq`
- 活跃 run 作用域：tools overlay 按 toolCallId 合并进对应 assistant 条目的 `_toolCalls`（overlay 优先，承载 running/partial/pending approval 状态）
- `retrying` → 末条 error assistant 渲染为 streaming（隐藏 error 字段）
- 拼接顺序：`render(durable) ++ render(run.draft) ++ render(pending) ++ render(notices)`
- key 通道：`seq:{n}` / `block:{draftId}` / `intent:{intentId}` / `notice:{id}`；`MessageList` / `TriggerTurnGroup` 统一改吃 key

### sync（`replica/sync.ts`，successor of history-reconciler）

- 冷启动（`everReady=false`，不受 replay buffer 帧污染）：tier③ 快照 full → tier② `since=highSeq` 确认模式 / 补快照后事件；410 → `legacySnapshotMode`
- 重连（`replayCompleted` 后）：tier② `since=highSeq` + hasMore 续拉；410 → tier③ 刷新 + snapshot 模式
- 水位线失效（`resyncNeeded` = 缺失 seq）→ tier③ full 重同步；tier② 帧经 `syncSettled` 宽松插入（与 live 交错乱序不告警）
- ~~快照后留洞补拉~~：不实现——初始完整页 + loadMore 连续前插 + 范围替换保前缀共同保证无洞（design #6 已记录修订）；唯一洞来源由水位线失效兜底
- 失败重试 `[1,2,5]s`（沿用）；曾 ready 会话失败保持 ready；`historyError` 语义与 ConnectionBanner 契约不变
- `loadMore`：tier③ `before=oldestLoadedId` 反向分页 → durable 头部插入（不触发水位线）

### runtime（`runtime/chat-session-runtime.ts` 重写为纯传输壳）

保留：心跳/探活/重连退避/手动 close/dispose/probe。删除：reconcileHistory、connectionEvents 缓冲、takeInitialMessage（initialMessage 由 store 经 pending 队列处理）。新增：内部生命周期帧发射（connected / disconnected{fatal} / reconnectFailed）；`replayCompleted` = 每次连接后首个 `run_status` 帧后发射（hub attach ready 重放后必发 run_status，即重放结束标记）；出站帧带 intentId。

### replica-store（`replica-store.ts`）

薄 store：`sessions[sessionId] = { replica, messages(derived 缓存), keyed, hasMore, oldestLoadedId, loadingMore, streaming, scrollPosition, projectId, attachedCount, lastActivityAt, ... }`。rAF 批量归约保留；`setStreaming` 侧带传播收敛为 flush 后单一传播点；action 面对齐 `useChatSession` 既有公共面 + `resync`（`refreshHistory` 改调它）。`resumeProbeAll` / `disconnectProject` / TTL 清理原样。

## 文件操作清单

新增：`replica/{session-replica,durable,run-tail,intents,notices,derive,sync}.ts`、`replica-store.ts`
重写：`runtime/chat-session-runtime.ts`、`runtime/streaming-store.ts` → 删除（职责并入 replica-store）
删除：`model/chat-history.ts` 的 `mergeHistoryMessages`（投影函数保留供 derive 复用）、`model/retry-plan.ts`（plan 并入 session-replica 命令）、`model/chat-session-reducer.ts`（平移至 run-tail + derive）
消费方迁移：`index.tsx` / `ApprovalNoticeBridge` / `TriggerEventBridge`（refreshHistory→resync）/ `web-resume-probe` / `ui-sdk/handlers/send-message` / `useChatScroll` / `MessageList` + `TriggerTurnGroup`（key 通道）/ `lib/api.ts`（新增 `getSessionEvents`，410 经 ApiError 透出）

## 任务序列

1. [x] `lib/api.ts` 增加 `getSessionEvents`（events 端点，410 → ApiError）
2. [x] `replica/durable.ts` + 单测（插入幂等 / 区间删除 / 水位线 / 范围替换 / legacy 丢弃）
3. [x] `replica/run-tail.ts` + 单测（reducer 行为规格帧序列化平移：draft 生命周期 / tool 卡 / control 卡 / run 结束清理）
4. [x] `replica/intents.ts` + `replica/notices.ts` + 单测（三态 / withdrawInFlight / notices 生存期与清除）
5. [x] `replica/session-replica.ts`（reduce + plan）+ 核心帧序列测试（确认帧幂等任意顺序 / settle 所有权交接 / 水位线失效 / replayCompleted gating / legacy 模式）
6. [x] `replica/derive.ts` + 单测（settle 穿越 golden：同一帧序列 run 区渲染 ≡ durable 派生渲染；key 稳定；runChanges 窗口聚合；retrying / notices 投影）
7. [x] `replica/sync.ts` + 单测（tier 选择 / 410 / 续拉 / 洞修补 / 失效重同步 / loadMore）
8. [x] `runtime/chat-session-runtime.ts` 重写 + `replica-store.ts`；streaming-store 测试套件转帧序列重表达（withdraw / reconnect / fatal / retry 两变体 / resumeProbe / 图片附件 / initialMessage 不重发）
9. [x] 消费方迁移 + 稳定 key（MessageList / TriggerTurnGroup / index / bridges / web-resume-probe / ui-sdk）
10. [x] 删除旧文件与死代码；`collectPendingApprovals` 行为保留测试
11. [x] 全量 `npm run verify` + e2e（chat-streaming-resilience / chat-withdraw / chat-retry / floating-chat + 新增多客户端确认帧可见性）
12. [x] doc-sync（chat.md Renderer 节重写、project-structure、backlog 删 H1/MessageList key 条目、新增 compacted tier② 条目）

## 验证门禁

`npm run verify` 全绿；受影响 e2e + `npm run verify:e2e` 全量；UI 组件测试零改动通过（key 除外）。
