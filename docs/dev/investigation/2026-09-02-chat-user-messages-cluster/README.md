# 调查：多客户端场景下已发送 user message 集中出现在最近处

- 日期：2026-09-02
- 状态：**根因确认（用户 desktop 复现信息修正诊断后单测复现）**——见「最终根因」节；此前 H1（run 持久化竞态）降级为独立已知问题
- 用户复现补充：对话序列 A,1,B,2,C + 超长 run 3（消息数 > 一页历史上限 20），client 重连后（如电脑合盖再打开）A/B,C 集中堆叠到最近处
- 复现测试：`repro.test.snippet.ts`（run 持久化竞态机制）；最终根因的复现测试在 fix 分支的 streaming-store.test.ts 内
- 报告症状：连接移动端（web）后在移动端连发若干条消息，这些 user message 偶尔会"集中出现在最近处"
- 前置确认：bug 早于 2026-09-02 chat runtime 重构（PR #81）存在，重构后未回归验证；重构为行为保持型，两个候选机制在重构前后代码路径等价

## 已排除的假设（附证据）

| # | 假设 | 排除证据 |
|---|---|---|
| E1 | 服务端 event log 出现重复 `user/message` 行（高 seq 排到末尾） | events 表 `PRIMARY KEY (session_id, seq)`（session.ts:104-111），并发写同 seq 直接抛错不会插重复行；`SessionEventLog.open` 在每次 restore 校验 seq 连续性（event-log.ts:76-80），分叉会显式炸掉而非静默 |
| E2 | fold 投影重复产出 user 消息 | `deriveHistoryEntries` 对每个 message event 投影恰好一次（fold.ts:27-37），abandoned seq 排除逻辑正确 |
| E3 | restore/repairLog/compaction 重写历史产生重复 | `initForRestore` 只为 open turn 追加合成 tool/result + turn/end（fold.ts:109-167），不追加 user/message；compaction 走 `deriveMessageEntries`（digest 语义），且 `deriveHistoryEntries`（分页用）不受其影响 |
| E4 | 双 AgentRunner 并发写同一 session | `SessionManager.sessions` Map 去重（session-manager.ts:53-60）；hub channel key `${projectId}:${sessionId}` 与 `getOrCreateChannel` 同步执行，无 double-restore 窗口 |
| E5 | 持久化读过期（fetch 拿到旧数据） | better-sqlite3 同步事务，append 与 readEvents 同进程串行（session.ts:213-257） |
| E6 | WS 广播 user 消息导致 reducer 重复插入 | `user/message` 只落 eventLog（agent-runner.ts:149-159），不经 onEvent 广播；reducer 对 user 角色 message 事件也显式忽略（assistant-only guard，chat-session-reducer.ts:81-119） |

## 关键链路事实

1. **另一客户端发的 user 消息没有实时到达路径**：hub 只广播 pi agent 事件（assistant 流式 + tool + run_status），`user/message` 不广播。桌面端看移动端发的消息**只能**等 reconcile（重连）或 refreshHistory。
2. **user/message 在 run 开始前同步落库**（agent-runner.ts:149 appendBatch），**assistant/message 在 message_end 才落库**（persistMiddleware，agent-runner.ts:422-445）——两者持久化时机不对称，构成竞态窗口。
3. **hub 对重连客户端的补发只有"当前 run 的 runEvents"**（chat-session-hub.ts:61-69），run 结束时 `runEvents = []`（chat-session-hub.ts:212-215）。**run 结束后 attach 的客户端 replay 为空，完全依赖 reconcile fetch。**
4. 客户端 `mergeHistoryMessages` 的 transient 过滤器（chat-history.ts:54-61）：current 中无 `_messageId`、无 `_error`、非 `_optimistic` 的消息（= **所有经 WS 实时收到的 assistant 回复**）在 merge 时被**无条件丢弃**，赌 fetch 会带回它们的持久化版本。
5. 移动端 web 特有：挂起 ≥30s / bfcage 恢复 → `web-resume-probe` 主动探测 → 死链 close → 重连 → reconcile（web-resume-probe.ts）。

## 候选机制

### H1（最可能）：reconcile fetch 落在 run 持久化窗口内 → 回复丢失 + user 消息堆在末尾

时间线：

1. 移动端连发 u1..uN（每轮 [u_i → a_i 流式 → 完成]），live 视图交错 `[.., u1, a1, .., uN, aN]`；a_i 均无 `_messageId`（实时事件路径不携带 seq）
2. 移动端挂起（run 仍可能 in-flight，或恰在最后一条 run 的持久化边界）
3. 恢复 → probe → close → reconnect → onopen → **reconcile fetch 立即发出**；此刻 DB 含全部 u_i（run 前落库）但缺尾部若干 a_i（message_end 未到/未落）
4. run 结束 → hub `runEvents = []` → 重连 attach 的 replay 为空（或 replay 先于 fetch 响应到达、被 reconcile 缓冲后随 fetch 合并——若 run 结束于 fetch 响应之前，replay 缺失尾部）
5. merge：fetch 里的 u_i（带 id）进入 merged 排序；**current 里的 live a_i 被 transient 过滤器丢弃，且 fetch 里没有它们** → 视图 = `[..., u_{N-k}, .., u_{N-1}, u_N]`——**若干条 user 消息连续堆在最近处，对应回复消失**
6. 无后续事件可自愈，直到下一次重连/刷新——但下次通常 fetch 全量即恢复 → 与"偶尔出现"吻合

症状预测：**user 消息本身不重复**（同一条只出现一次），而是**从交错位置"塌缩"到尾部 + 回复缺失**；重开会话/刷新后恢复。

### H2（次可能，症状为真·重复）：optimistic 消息内容不匹配 → 同一 user 消息两份

`mergeHistoryMessages` 用**内容字符串全等**（`historyUserContents`，chat-history.ts:49-57）判 optimistic 消息是否已被 fetch 带回；不匹配则 optimistic 副本作为 transient **追加在末尾**，与 merged 里带 id 的持久化副本并存 → 同一消息出现两份（原位 + 底部）。触发条件：persisted 内容与本地 optimistic 内容不同（附件消息的 strip/重建路径、或历史轮换导致 fetch 页不含该消息）。

症状预测：**同一条消息出现两次**，其中一份在底部；重开会话后恢复为一份。

## 最终根因（2026-09-02，用户 desktop 复现修正后确认）

三个条件叠加，**完全确定性**（非竞态）：

1. **发送端的 user 消息永远 `_optimistic`**：`user/message` 不经 WS 广播、无 id 回显，发送后直到下一次成功 reconcile 才获得 `_messageId`
2. **超长 run 占满最新一页**：run 3 产出 ≥20 条消息时，reconnect reconcile 的 `limit:20` fetch 只带回 run 3 尾部（全是 assistant/toolResult），**页内不含任何 user 消息**
3. **`mergeHistoryMessages` 的 transient 追加假设失效**：`historyUserContents` 只从**本次 fetch 的页**构建（chat-history.ts:49-53），A/B/C 内容匹配全部失败 → 作为 transients **追加到视图末尾**（该追加位置假设"optimistic 消息比已加载内容新"，在 fetch 窗口未覆盖视图时错误）；同时 1/2/m1..m5（无 id、无 error、非 optimistic）被无条件丢弃

最终视图 `[old…, m6..m25, A, B, C]`，与用户报告逐字吻合。触发面：任意重连（合盖开盖 / 移动端挂起恢复）+ 发送端存在未 reconcile 的 user 消息 + 其后被 ≥20 条消息的 run 推出页外。`loadMore` 逐页加载同样途经此 merge，在覆盖到 user 消息区间前同样出现堆叠（加载到后自愈，视觉闪烁）。

## 既有假设修正

- 之前认定的 H1（reconcile fetch 与 run 持久化的竞态窗口）真实存在但**不是本 bug**（其复现需 fetch 恰落在 run 持久化瞬间，罕见且丢失的是流式回复而非 user 消息堆叠）。保留 `repro.test.snippet.ts`，作为独立已知问题，修法（hub runEvents TTL replay）另行评估。

## 修复方向（确认后展开 design）

- **A'（服务端治本，改动小）**：hub 的 `runEvents` 在 run 结束后不再立即清空，保留一个短 TTL（如 30s）供窗口期内重连的客户端 attach replay。重连客户端无论 fetch 竞态如何，都能拿到完整 run 事件流归约（replay 早于 fetch 响应 → 进 reconcile 缓冲随 fetch 原子合并；晚于 → 走正常 enqueue 归约），回复不再丢失。注意 replay 与 run_status 的语义对齐（run 已结束，replay 尾部应带 run_status false）
- **B（客户端兜底）**：merge 的 transient 过滤器保留尾部无 id 的流式 assistant 消息。缺点：reconcile 带回带 id 完整版后无去重钥匙（现有钥匙只有 id 与 optimistic-content），会双份；不取
- **C（契约治本，最干净但改动面大）**：广播事件携带 seq（`persistMiddleware` append 后注入再转发），客户端实时消息打 `_messageId`，merge 走 id 去重。**但 C 单独解决不了本 bug 的窗口**（fetch 响应后 run 才完成时，完整版根本不在 fetch 结果里，仍需 replay/补拉配合）
- **E（客户端自愈兜底）**：reconcile 合并时若丢弃了 `_streaming` 尾巴，安排一次延迟 refreshHistory 补拉。契约零变更，可与 A' 组合作为防御纵深

推荐 **A'（+ 复现测试转绿）**；E 可作为后续独立小增强。

## 关联文件

- `packages/app/src/features/chat/model/chat-history.ts:23-62`（mergeHistoryMessages）
- `packages/app/src/features/chat/runtime/history-reconciler.ts`（reconcile 时序）
- `packages/server/src/chat-session-hub.ts:61-69, 197-218`（replay 与 runEvents 生命周期）
- `packages/core/src/session/agent-runner.ts:149-159, 422-445`（user/assistant 持久化时机不对称）
- `packages/app/src/lib/web-resume-probe.ts`（移动端挂起恢复触发器）
