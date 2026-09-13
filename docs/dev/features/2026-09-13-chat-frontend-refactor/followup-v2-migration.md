# Chat 前端消费协议 v2（游标重放）Follow-up

- 日期：2026-09-13
- 前置：`docs/dev/features/2026-09-05-chat-refactor/design.md`（协议 v2 完整设计：§1 握手/游标/去重不变量、§2 server、§8 PR 切分、§9 测试）；`docs/dev/features/2026-09-13-chat-frontend-refactor/design.md` §9（Entry 模型的迁移缝）
- 状态：待实施。09-05 plan 的前端 PR3/PR4 已由 09-13 前端重构替代（旧协议下先行），本文件是剩余的 v2 消费清单
- server 侧前置已完成：PR1（contracts v2 + hub 结构化 + seq 富化 + since 重放 + close code）、PR2（WsConnection）；本文件全部是 renderer 侧改动

## 现状

renderer 已完成 Entry/MessageGroup 重构，具备迁移所需全部身份字段（`seq` / `streamId` / `clientId`），但：

- `decode` 仍对 v2 事件（`session_ready` / `replay_events` / `replay_done` / `user_message` / `turn_retried`）返回 `undefined` 静默丢弃，只透传 `messageId`/`seq` 字段
- 恢复策略仍是 HTTP 首页对账（`session-recovery.ts`），connect 不带 `since`
- reducer 只消费 pi live 事件；没有 `applyPersistedEvent` 路径
- 乐观 user 仍按内容匹配结算（`history-entries.ts` 的 `settleOptimistic`）
- `cursor` 只由 HTTP 分页维护，不随 wire seq 推进

## 迁移清单（renderer）

### M1 decode 扩为帧分类

`decode.ts` 从 `AgentEvent | undefined` 升级为带类别的帧结果（v2 握手帧需要先于事件被 recovery 消费，不能被当成普通事件丢弃）：

```ts
type DecodedFrame =
  | { kind: "event"; event: AgentEvent }        // 现有 live 事件
  | { kind: "session-ready"; lastSeq: number }  // 首帧判定 + 能力握手
  | { kind: "replay-events"; events: ChatReplayEvent[] }
  | { kind: "replay-done" }
  | { kind: "ignored" };
```

要点：`session_ready` / `replay_events` / `replay_done` 上送 `session-recovery`；`user_message` / `turn_retried` 映射成 live 事件（含 seq/id 字段）交给 reducer；其余走原路径。

### M2 recovery 升级为「首帧判定 + since 重放」

`session-recovery.ts` 变为策略入口，按 09-05 design §1.1：

- connect URL 追加 `?since=cursor`（cursor 从 session state 读取；`createSessionLink` 的 url 闭包需要新增 cursor getter）
- 首个入站帧是 `session_ready` → v2 路径：等待 `replay_events` 分批（每批 ≤200）→ `replay_done`，期间不落常规队列；重放事件走 `applyPersistedEvents`（M3）
- 首帧不是 `session_ready` → legacy 冷对账：现有 HTTP 首页 + merge 逻辑整体保留（新 app + 旧 server 兼容层，退出条件见「遗留清理」）
- 重连后当前 run 的压缩快照继续按顺序到达（`session_ready → replay → replay_done → 快照 → run_status`），快照事件与重放事件按 09-05 §1.5 规则去重

### M3 reducer 增加持久事件入口

`entry-reducer.ts` 新增 `applyPersistedEvents`（输入 `ChatReplayEvent`）：

- `user/message` → UserEntry（`seq`、`source`/`triggerName`；发送方按 `clientId` 结算乐观 entry）
- `assistant/message` / `tool/result` → 按 `seq` upsert，保留既有 entry id
- `turn/withdrawn` → 按 `[data.seq, event.seq)` 区间移除（替代「从最后一条 user 截断」）
- `turn/retried` → 按 `abandonedSeqs` 移除
- `compaction/applied` → 按 `excludedSeqs` 移除（renderer 目前不消费 compaction，需按 09-05 §1.4 决策实现）
- 游标推进：`cursor = max(cursor, seq)`；live 事件同理（`user_message` / `message_end.seq` / `agent_end.seq` / `turn_retried` / `turn_withdrawn`）
- messageId↔seq stitch：`message_end` 建立 `streamId → seq` 绑定；`message_start` 命中有绑定/重放已给的同一消息时 skip —— 锁 09-05 §1.5 五条不变量

### M4 结算与重试的多端语义

- `settleOptimistic` 从内容匹配换成 `clientId` 精确匹配（保留内容匹配仅作 legacy 分支）
- `turn_retried` 到达时同步多端状态（其他端的失败气泡消失、重试结果可见），取代「重试只在本端可知」
- `user_message` echo 的 `source`/`triggerName` 让 trigger 轮在 live 阶段即成组（不再等 HTTP 对账）

### M5 快照收缩与 control 落库（依赖 09-05 PR5）

09-05 design §1.8 的服务端前置：`control/requested|resolved` 落库、快照收缩为 O(in-flight)。renderer 侧对应：

- `applyPersistedEvents` 消费 control 事件，pending 投影 = requested 未配对 resolved 且无 turn/end 隔断
- reducer 需容忍「无完整前史的快照」（update 懒建气泡已有基础）与按 requestId 幂等（快照/重放双通道）
- 依赖服务端 PR5（trigger 收口 + control 落库 + 分页 fold 缓存），可与本迁移并行

### M6 测试

- reducer property：随机 (live + replay + history) 交错流 → 不变量（seq 幂等、id↔seq 绑定一致、重放合并 == 全量重建、按 seq 截断正确）
- 恢复顺序契约测试：`session_ready → replay → replay_done → 快照 → run_status`
- E2E：断线重连重放（含「断线期间 run 已完成」与「run 进行中」两场景）、双端同看一个 session、trigger run 在已打开页面可见
- legacy 分支结构测试：首帧非 `session_ready` 时仍走 HTTP 对账

## 遗留清理（迁移稳定后）

- 删除 `TriggerEventBridge` 的 `refreshHistory` 调用（依赖 09-05 PR5 的 trigger 收口，否则 attach 中的 session 会失去 trigger run 补偿）
- 评估 legacy 冷对账路径删除条件（web 版本门槛，`lib/version-compat.ts` minVersion 覆盖 v2 server）
- 09-05 plan PR6 的其余收尾

## 已知风险 / 验证点

- **v2 下的 `message_update` 懒建**：当前 `applyMessageUpdate` 在无 open window 时用 `event.messageId` 新建 entry，未检查同 id 是否已存在——重放清窗后可能产生重复 key，迁移时改为 upsert（review 未验证疑点）
- **`findReusableStreamIndex`**：messageId 不匹配时仍会复用尾部 streaming entry 的语义是为旧协议 retry 设计的，v2 下需改为按 messageId 精确绑定 + `turn_retried` 删除（review 未验证疑点）
- 重放与快照重叠去重错误（重复气泡/丢内容）：靠 property test + 灰度期保留手动刷新兜底
- `message_end.seq` 的引用配对依赖 persist-before-callback 不 clone：已有真 runtime 契约测试钉住（PR1）

## 建议顺序

1. M1 + M3 + M6（纯 model/decode，可先用录制事件做单测）
2. M2 + 游标推进 + legacy 分支保留
3. M4（clientId 结算与多端语义）
4. 与 09-05 PR5 汇合后做 M5 与遗留清理
