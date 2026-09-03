# Chat 前端状态与渲染重构设计

- 日期：2026-09-03
- 状态：设计中（已吸收两轮 review 反馈）
- 范围：仅 `packages/app` renderer 侧；wire 契约（`@spherse/contracts`）、server、core 零改动

## 背景与问题

Chat 前端四个数据来源——history（REST 分页）、streaming（WS 事件流）、user message（乐观更新）、approval/question（WS 控制请求）——最终全部压平进同一个 `messages: ChatMessage[]`，靠 11 个 `_` 前缀标志位区分生命周期（`packages/app/src/features/chat/types.ts:91`）。由此产生一组结构性问题：

1. **类型污染**：持久化字段（`_messageId`）、传输态（`_optimistic`/`_streaming`/`_sendFailed`）、UI 派生态（`_withdrawError`/`_runChanges`/`_triggered`）混在同一类型上，reducer 与 history merge 都必须理解全部标志
2. **"末尾消息"隐式不变量**：`chat-session-reducer.ts` 几乎所有分支只操作 `prev[prev.length-1]`（`updateLastToolCall` 同理），tool call 与 assistant 消息的关联靠"最后一条是 streaming assistant"这一假设
3. **卡片状态机双写**：streaming 路径的卡片由 reducer 的 `control_request`/`control_resolved` 分支写入 `toolCall._card`，history 路径由 `buildCardFromToolResult` 重建，同一状态机（如 command 卡 rejected 态）在两处各写一份
4. **乐观消息去重靠 content 匹配**（`chat-history.ts:49`）：连发两条相同文本会被误去重
5. **streaming 状态双写** `useProjectDataStore`，`streaming-store.ts` 内 6+ 处手工同步
6. **`MessageItem` 上帝组件**：user/assistant 双布局 + markdown + 锚点导航 + streaming 光标 + 5 种卡片 if-chain 分发 + 错误 + 附件 + hover 操作条；approval 回调 prop drilling 4 层（Chat → MessageList → MessageItem → Card）
7. **`MessageList` 用 index 作 React key**（`MessageList.tsx:69`）

## 目标

- 按数据生命周期**分仓**：history（服务端真相）/ runs（客户端 agent run 缓存）/ outbox（乐观 user message），合并逻辑显式化为一个纯函数 selector
- 卡片投影统一为单一纯函数，消灭双写
- `MessageItem` 按角色与卡片分发拆分；approval/question 回传走 context
- 顺带修复缺陷 4（乐观去重）与 7（index key）
- 行为与现状**严格对齐**（含 reconnect/abort/withdraw/retry/断线恢复语义），以现有 ~1000 行 reducer 测试、39 个 store 测试与 4 条 chat E2E 作为回归安全网

## 非目标

- 不动 WS wire 协议、REST 契约、server/core
- 不做 MessageList 虚拟化（`flex-col-reverse` + `useChatScroll` 的负 scrollTop 约定原样保留；已确认 `useChatScroll` 只依赖 `messages.length` 与末条 role，不依赖 index，key 变更安全）
- 不重构 `chat-session-runtime.ts` 的连接/心跳/重连/退避逻辑（仅改其 history 对账回调的语义）
- 不利用 `agent_end.messages` / `turn_end` 快照 payload 替代增量事件（现状 reducer 忽略它们，保持；记为未来优化）

## 关键现状事实（设计依据）

- server 在每次 WS attach 时全量重放 **active run** 的 compacted 事件序列（`chat-session-hub.ts:61-69, 220-254`）；run 在断线期间已完成时重放内容为 `run_status{active:false}`（无事件），完成的 turn 已入 history
- `error` 事件之后 server 必发 `run_status{active:false}`（`chat-session-hub.ts:212-215`）
- server `startRun` **总是先发布** `run_status{active:true}` 再执行 executor（`chat-session-hub.ts:204-206`）；Source-1 错误（如 MODEL_NOT_CONFIGURED）发生在 user message 持久化之前（`agent-runner.ts:133` 早于 `:149`），因此该错误到达时客户端持有的是**空 active run**
- 存在**只发 error、从不动 Streamer** 的拒绝路径：`channel.running` 时 `startRun` 在发布 `run_status{active:true}` 之前抛 ConflictError（`chat-session-hub.ts:201-206`），ws-chat catch 后仅回 error 事件（`ws-chat.ts:74-97`，retry/withdraw 同理）
- Source-1 错误（pre-prompt，如 MODEL_NOT_CONFIGURED）在服务端**无持久化消息**，错误气泡仅存在于客户端内存；现状 `mergeHistoryMessages` 显式保留 `_error` transient（`chat-history.ts:59`），这是用户 retry 的入口。相反，turn 内错误（`stopReason:"error"`）的 assistant 消息**会被持久化**并出现在 history 投影中
- server `retryLastTurn` 会 abandon 失败 assistant 消息并从 history 投影剔除（`agent-runner.ts:215-218`、`fold.ts:96-104`）
- `ui-sdk/handlers/send-message.ts:31` 直接读 `sessions[id].streaming` 做 session_busy 判断
- `data-chat-message` / `data-role` / `data-chat-bubble` / `data-chat-error` / `data-chat-retry` / `data-chat-withdraw` / `data-chat-messages` / `data-chat-composer` DOM 属性被 4 条 chat E2E 与 ui-sdk html-card E2E 依赖

## 决策

| 决策点 | 结论 |
|---|---|
| 状态分仓 | `ChatSessionData` = `history + runs + outbox + interactions` 四个 slice + 会话级交互标志（`pendingWithdraw`/`retrying`/`withdrawError`）；`streaming` 布尔**派生**并导出 selector `isSessionStreaming(session)`（见下），不再作为存储字段 |
| streaming 派生 | `isSessionStreaming = outbox 存在 pending 条目 \|\| runs 存在 active run \|\| retrying`。outbox 条目三态：`pending`（已 push 尚未被受理）→ `sent` / `failed`。**settle 规则（事件驱动，全覆盖）**：`agent_start` / `run_status{active:true}` 把 pending 置 `sent`（受理）；`error` 事件同样 settle——已有 active run 置 `sent`（对齐现状：乐观消息保留 + 错误气泡出现），无 run 受理也置 `sent`（对齐现状 ConflictError 路径：消息保留、`appendErrorMessage` 出气泡，**不是** sendFailed UI）；`run_status{active:false}` / `agent_end` / fatal close 兜底 settle 为 `sent`（对齐现状这些事件直接置 streaming=false）。sendMessage 禁止并发，同一时刻至多一条 pending，任何晚于发送的 settle 不会误伤。正常运行结束后不需要任何 history 拉取参与解锁 |
| history slice | 服务端真相的已加载分页，按 `_messageId` 升序；reconcile/refresh **纯替换最新页**（与已加载旧页按 id 归并），loadMore 前插，删除 `mergeHistoryMessages`。history slice 仅有的两个** sanctioned 客户端截断**：`turn_withdrawn` 与 retry-resend（见事件表）——server 侧对应数据已删除，截断是对服务端真相的前瞻对齐 |
| runs slice | 客户端 run 缓存。run id 为 session 内**单调计数器**（`agent_start` 无 payload，不能作 id 来源）。reducer 以 run 为单位归约，tool call 按 `toolCallId` 在 run 内全量检索（消灭"末尾消息"假设） |
| **reconcile 落地规则** | 按路径区分：**reconcile**（WS open，随后必有全量重放）丢弃全部 active run 与不带 error 态的 inactive run（重放重建的 run **复用被丢弃 active run 的 id**，保证 `r-{runId}-*` key 跨重连稳定、iframe 不 remount）；**refresh**（最新页拉取，streaming 门槛保证无 active run）丢弃不带 error 态的 inactive run；**loadMore**（旧页前插）**不触碰 runs/interactions/outbox**——旧页不可能覆盖新内容，丢弃即内容丢失。**豁免（reconcile/refresh 共用）**：仅 inactive 且带 segment error / trailingError 的 run（Source-1 错误在服务端无持久化消息，错误气泡即 retry 入口，不允许被 reconcile 冲掉）；且豁免 run 在其 error 与已加载 history 中某条 `_error` assistant 消息**内容相同**时仍被丢弃（错误 turn 已被服务端持久化、history 已渲染，避免双重 error 气泡——现状 merge 此处是潜伏双渲染缺陷，本规则顺带修复）。reconcile/refresh 同时清除**宿主 run 已被丢弃**的 interactions（对齐现状 approval 卡随消息 merge 丢弃、bridge 通知消失）。reconcile 落地/重放结束后若无 active run，清除会话级 `retrying`（防 retry 指令丢失导致 thinking 永久卡住） |
| outbox 去重修复 | 条目携带 `sentAfterMessageId`（发送时 history 最新 `_messageId`，**null = 无 id 下限**——takeInitialMessage 发送时 reconcile 未完成属常态）；**仅 reconcile / refresh（最新页拉取）落地时执行消费**，loadMore（旧页前插）不消费（防 `sentAfterMessageId:null` 条目被远古同文消息误消费）。匹配规则：content 相同 + `id > sentAfterMessageId` + 每条 history user message 至多被消费一次（按 outbox 顺序贪心）。`pending`/`sent`/`failed` 三种条目**均参与消费**（对齐现状 `_sendFailed` 消息也是 `_optimistic` 参与去重）。修复连发相同文本误去重 |
| 卡片投影统一 | 卡片不再存进 state。纯函数 `projectChatCard(toolName, args, lifecycle)`，`lifecycle = { partialDetails?, resultDetails?, isError?, interaction? }`；history 路径（toolResult details）与 streaming 路径（partial/result + interaction）喂同一函数，状态机只此一份。`control_request` 仅当 `toolCallId` 能匹配到 run 内 toolCall 时才记录 interaction（对齐现状 `updateLastToolCall` 无匹配即整体丢弃、不产生通知的行为） |
| interactions | 每 session 一个 `Record<requestId, InteractionState>`；`run_status{active:false}` 丢弃 pending **question**（对齐 `clearPendingQuestionCards`，**保留 pending approval**——现状如此，有测试守卫）；`turn_withdrawn` 清空 interactions（否则 bridge 会为已撤回 run 弹通知、respond 发往死 requestId）。`ApprovalNoticeBridge`/`approval-notice.ts` 改读此表（bridge 不消费 toolName/command，无信息缺失） |
| render list | 纯函数 `buildRenderList(session) -> RenderItem[]`；`RenderItem { key, message, streaming?, sendFailed? }`。key 稳定：`h-{messageId}` / `r-{runId}-{segIndex}` / `o-{outboxId}`（run id 跨重连稳定由"重放复用 active run"保证）。`ChatMessage` 瘦身为纯内容视图模型（见类型节），生命周期态由 RenderItem meta 与列表位置表达 |
| `_runChanges` 派生化 | 不再存储；`buildRenderList` 统一计算——**history turn 按 user-message 边界**（沿用现状 `parseHistoryMessages` 的 runEndIndices 算法，迁入 render-list）、**run 按其 segments 边界**分别调用 `aggregateFileChanges`。`turn-groups` / `withdrawable` / `retry-plan` / `html-card-dedup` 的输入从 store messages 换成 render list + meta——**签名与分支需要适配**（`withdrawable`/`retry-plan` 现读 `_sendFailed`、turn-groups 现读 `_error/_turnError`，改为读 RenderItem meta 与瘦身后的错误字段），核心算法（user 边界切分、倒序扫描）不变 |
| retrying / withdrawError 宿主 | 均为**会话级**标志（非 run 级，豁免规则中不涉及 withdrawError）：刷新后错误消息来自 history（无 run 宿主），由投影作用于**尾部 error render item**。`retrying` 参与派生 streaming（封住 retry 发出到 `run_status{active:true}` 回来之间的守卫空窗，对齐现状同步置 streaming=true）；清除时机：新 run 首个内容事件、run 结束、或 reconcile 落地/重放结束仍无 active run。`withdrawError` 在 reconcile 落地时**保留**（`planRetry` 靠它把 withdraw 错误挡在 resend 之外），下一次成功 withdraw 或被新 turn 覆盖时清除 |
| streaming 双写收敛 | 删除 `setStreamingAndNotify` 等手工同步；`streaming-store.ts` 模块级 `subscribe` 派生各 session 的 `isSessionStreaming`，diff 后单点调用 `useProjectDataStore.setStreaming`。所有内部读点（`sendMessage` 守卫、`refreshHistory` 双重门槛、`cleanupExpired`、`executeRetry`）与外部消费方（`useChatSession`、**`ui-sdk/handlers/send-message.ts`**）统一改走 `isSessionStreaming` selector。runtime 的 `setStreaming` 回调删除 |
| MessageItem 拆分 | `MessageItem` 变薄壳：角色分支 → `UserMessageItem` / `AssistantMessageItem`；卡片分发 → `CardRenderer`（`type → Component` 注册表）；锚点/外链处理移入共享 hook（`useChatLinkHandler`）。**`data-chat-*`/`data-role` DOM 属性与现有 class 原样迁移**（E2E 契约，列入验收） |
| 回传通道 | 新增 `ChatActionsContext`（`respondApproval`/`respondQuestion`，由 `Chat` 顶层注入），卡片组件内部 `useChatActions()` 消费；`onRespondApproval`/`onRespondQuestion` prop 链删除。`onRetry`/`onWithdraw` 保留 prop（仅两层，与列表位置强相关） |
| useChatSession 对外 API | 不变（`messages` 改为 render list 的 memo 产物），`Chat`/`ChatPage`/`FloatingChatContainer`/`Composer` 消费面零改动 |
| abort 渲染差异 | abort 立即 finish active runs：Composer 解锁时序与现状等价；差异是 streaming 光标立即消失（现状要等 `agent_end`/`run_status` 到达）、hover 操作条提前出现——**记为有意变更**，E2E 无相关断言 |

## 状态模型

```ts
interface HistoryState {
  messages: ChatMessage[];        // 已加载分页（升序），服务端真相
  hasMore: boolean;
  oldestLoadedId: number | null;
  historyStatus: "pending" | "syncing" | "ready";
  historyError: boolean;
}

interface RunState {
  id: number;                     // session 内单调计数器
  active: boolean;
  segments: AssistantSegment[];
}

interface AssistantSegment {
  content: string;
  toolCalls: ToolCallInfo[];      // 原始生命周期，无卡片
  finished: boolean;              // message_end
  error?: { message: string; code?: ErrorEventCode; turnError: boolean };
  timestamp?: number;
}

interface OutboxEntry {
  id: string;                     // 客户端生成
  content: string;
  attachments?: ChatAttachment[];
  timestamp: number;
  status: "pending" | "sent" | "failed";
  sentAfterMessageId: number | null;
}

interface InteractionState {
  kind: "approval" | "question";
  requestId: string;
  toolCallId: string;
  status: { type: "pending" }
    | { type: "approved" } | { type: "rejected" }
    | { type: "answered"; answer: string } | { type: "timeout" };
}

interface ChatSessionData {       // 替代 StreamingSessionData
  history: HistoryState;
  runs: RunState[];
  outbox: OutboxEntry[];
  interactions: Record<string, InteractionState>;
  pendingWithdraw: boolean;       // 会话级，settle 逻辑沿用现状（事件批上判 error/turn_withdrawn）
  retrying: boolean;              // 会话级，作用于尾部 error render item
  withdrawError: boolean;         // 会话级，作用于尾部 error render item
  lastActivityAt: number;
  scrollPosition: number;
}

function isSessionStreaming(session: ChatSessionData): boolean;
```

`ChatMessage` 瘦身后（渲染视图模型，仅内容属性）：

```ts
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  _messageId?: number;
  _toolCalls?: ToolCallInfo[];    // state 内无 _card；render list 上带投影后的 _card
  _error?: string; _errorCode?: ErrorEventCode; _turnError?: boolean;
  _runChanges?: FileChangeCard[]; // 仅 render list 上存在
  _attachments?: ChatAttachment[];
  _triggered?: true; _triggerName?: string;
  timestamp?: number;
}
```

## 事件归约映射（现状 → 新）

`session-events.ts` 负责把 `AgentEvent[]` 路由到 slices：

| 事件 | 现状 | 新 |
|---|---|---|
| `agent_start` | streaming=true | 复用已有 active run（重放幂等），否则新建 active run（reconcile 重放重建时复用被丢弃 active run 的 id）；**outbox pending → sent** |
| `run_status{active:true}` | streaming=true | 同 `agent_start`（server 在 attach/run 启动时发布；覆盖 abort 未送达、重连后客户端已 inactive 的场景） |
| `message_start/update/end`(assistant) | 操作末尾消息，`_streaming` 标志 | run 内 append/更新末尾未 finished segment；`message_update` 快照语义整段替换；保留现状守卫——`message_update` 空 text + 末尾 finished assistant 时 no-op、`message_end` 空 text/无 error 且末尾为 assistant 时 no-op（防空气泡） |
| `message_*`(user) | 忽略 | 忽略（对齐现状） |
| `tool_execution_start` | 写末尾消息 `_toolCalls`；无 assistant 末尾时新建 streaming 消息 | 按 `toolCallId` 在 run 内 upsert（重放幂等）；toolCall **append 到 run 内最后一个 segment（无论 finished）**——多消息 run 中 tool call 落在上一个 finished 消息上是正常时序（对齐现状 `chat-session-reducer.ts:128-132`）；run 无 segment 时新建空 segment |
| `tool_execution_update/end` | 写末尾消息 `_toolCalls` | 按 `toolCallId` 在 run 内全量检索定位，更新 status/partialDetails/resultDetails |
| `control_request` | `updateLastToolCall` 写 `_card`（无匹配整体丢弃） | `toolCallId` 匹配 run 内 toolCall 才记录 `interactions[requestId]`；检索范围从"仅末尾消息"放宽为 run 内全量——命中早前 segment 时会记 interaction 并触发 bridge 通知（现状整体丢弃），**记为有意放宽**（可达性极低） |
| `control_resolved` | 更新 `_card` 状态 | 更新 `interactions[requestId]`（approval: approved/rejected；question: answered/timeout） |
| `agent_end` | 清 `_streaming` + attach `_runChanges` | run.active=false（runChanges 移到投影）+ 兜底 settle pending outbox |
| `run_status{active:false}` | streaming=false + 清 pending question 卡 | run.active=false + 丢弃 pending question interactions（保留 pending approval）+ 兜底 settle pending outbox |
| `error` | `appendErrorMessage` + streaming=false | run.active=false + settle pending outbox；error 落点：末尾 segment **有内容**时挂接其上（`turnError:true`——retry-last 依据）；末尾 segment 为空 / run 无 segment / 无 active run 时新建 error segment（`turnError:false`——resend 依据）。**该条件与现状 `appendErrorMessage` 精确对齐**：server 的 Source-1 错误（如 MODEL_NOT_CONFIGURED）总是发生在 `run_status{active:true}` 之后的空 run 上，必须走 `turnError:false` 分支，否则 retry 被误路由到 retry-last |
| `turn_withdrawn` | `prev.slice(0, lastUserIdx)` | 跨 slice 截断：history 从最后一条 user message（含）起删除（sanctioned 截断①），清空 runs、outbox、interactions |
| abort（用户 Stop） | 立即 streaming=false，`_streaming` 保留至 server 确认 | 所有 active run 立即 inactive；后续到达的 finish 事件幂等。渲染差异见决策表（有意变更） |
| fatal close（4401） | map 清 `_streaming` + streaming=false | finish 所有 runs；outbox pending → sent |
| retry（retry-last） | `markRetrying`：清 `_error`、置 `_streaming` | **删除尾部 error run**（镜像 `markRetrying` 的破坏性清错——server `retryLastTurn` 会 abandon 失败 turn 并将其从 history 投影剔除，旧 error run 不删会成为永久幻影）+ 会话级 `retrying=true`（投影：thinking；参与 streaming 派生封守卫空窗）；新 run 首个内容事件、run 结束或 reconcile 后仍无 active run 时清除 |
| retry（resend） | `slice(0, len-dropCount)` 后重发 | history 尾部截断（sanctioned 截断②，规则同 withdraw：从失败 turn 的 user message 起删除）+ 清对应 outbox failed 条目与 trailingError，然后走 sendMessage 正常路径（旧错误不同屏，守卫 `chat-retry.spec.ts:53` 断言） |
| send（sendMessage/takeInitialMessage） | push `_optimistic` + streaming=true | push outbox `pending` 条目；WS 不可达时 `status="failed"` |

**重连对账路径变更**：现状 `reconcileHistory` 是"merge 后重放 connectionEvents"；新模型为"history 纯替换落地（按 reconcile 落地规则清 run）→ buffered events 重放重建 active run"。断线期间已完成的 run（非 error）由 history 直接覆盖，无重复渲染；error run 豁免保留。loadMore 前插不再触碰 runs（现状 merge 会瞬时丢掉 streaming 尾巴，新模型严格更优）。

## 卡片投影

```ts
// model/tool-card.ts（由 chat-tool-projection.ts 演进）
interface ToolCallLifecycle {
  partialDetails?: unknown;
  resultDetails?: unknown;
  isError?: boolean;
  interaction?: InteractionState;
}
function projectChatCard(toolName: string, args: Record<string, unknown>, lifecycle: ToolCallLifecycle): ChatCard | undefined;
```

- `run_command`：args 出 command/cwd；interaction pending → `pending_approval` 卡；resolved(approved) → running 卡（等待 partial/result 填充）；resolved(rejected) / resultDetails rejected → error+rejected 卡；partialDetails → running 卡；resultDetails → completed/error 卡
- `render_card` / `generate_image`：partialDetails / resultDetails 直转（沿用现有守卫与默认值逻辑）
- `ask_user`：live 走 interaction（pending/answered/timeout）；history 走 resultDetails（`cardType === "question"` 分支并入此处）；两路径产物同构（现状 history 只产 answered/timeout，互补不冲突）
- history 路径：`parseHistoryMessages` 只解析（不再 attach 卡片与 runChanges），toolResult details 存进 `ToolCallInfo.resultDetails`，投影在 render list 阶段统一执行

## 各层实现

### app（全部改动集中于此）

**model 层**
1. `types.ts`：新 slice 类型 + 瘦身 `ChatMessage` + `RenderItem` + `isSessionStreaming`（含 `retrying`）
2. `model/history.ts`（原 chat-history.ts）：仅保留 `parseHistoryMessages`（去 merge/卡片/runChanges）+ history 页归并/前插 + outbox 消费匹配 `consumeOutbox(history, outbox)`（仅最新页拉取调用）
3. `model/run-reducer.ts` + `model/session-events.ts`：事件归约（上表），含 outbox settle 规则与 error `turnError` 分流条件
4. `model/tool-card.ts`：统一投影（上节）；`chat-tool-projection.ts` 删除
5. `model/render-list.ts`：`buildRenderList(session)`：history（user-message 边界 runChanges）+ runs（segments/卡片/runChanges/error，重放重建复用 run id）+ outbox；会话级 retrying、withdrawError 作用于尾部 error item；产出稳定 key 与 meta
6. `model/turn-groups.ts` / `withdrawable.ts` / `retry-plan.ts` / `html-card-dedup.ts` / `approval-notice.ts`：输入源改为 render list / interactions，签名与分支适配
7. `model/aggregate-file-changes.ts`：不改，调用点移入 render-list

**runtime 层**
8. `streaming-store.ts`：session shape 换新；`isSessionStreaming` 统一守卫；模块级 subscribe 派生单点同步 project-data-store；`executeRetry`（retry-last 删尾部 error run）/`sendMessage`/`withdrawLastTurn`/`loadMore`（不消费 outbox）/`refreshHistory`（保留 streaming 双重门槛，迁移守卫测试）/`cleanupExpired` 适配
9. `chat-session-runtime.ts`：`reconcileHistory` 回调改为 replace + 按 reconcile 落地规则清 run（active 丢弃、inactive error run 按已加载 history 去重豁免、宿主 interactions 清理）+ replay；fatal close 回调 finish runs + outbox pending→sent；`setStreaming` 回调删除。连接/心跳/重连/退避原样

**hooks / 组件层**
10. `hooks/useChatSession.ts`：选择 raw session，`useMemo(buildRenderList)`，对外 API 不变（`messages` 为 `RenderItem[]`，MessageList 同步消费）；`streaming` 改读 `isSessionStreaming`
11. `MessageItem.tsx` 拆薄壳 + 新 `UserMessageItem` / `AssistantMessageItem` / `CardRenderer` / `useChatLinkHandler`；DOM 属性与 class 原样迁移
12. `chat-actions-context.tsx`（并入现有 `runtime-context.tsx` 或平行）：respondApproval/respondQuestion provider；`ApprovalCard`/`CommandCard`/`QuestionCard` 内部消费
13. `MessageList.tsx`：消费 `RenderItem[]`（key、meta）；`Chat` 删 onRespondApproval/onRespondQuestion prop 链
14. `ApprovalNoticeBridge.tsx` + `model/approval-notice.ts`：改读 interactions
15. `ui-sdk/handlers/send-message.ts`：session_busy 判断改走 `isSessionStreaming`

**测试**
16. `chat-session-reducer.test.ts` → 拆为 `run-reducer.test.ts` + `session-events.test.ts`（断言迁到新 shape，语义逐条保留）；补关键新规则用例：error settle pending（含 ConflictError 无 run 路径）、Source-1 空 run error 走 `turnError:false`、retry-last 删尾部 error run、`retrying` 封守卫空窗
17. `chat-history.test.ts`：merge 测试替换为 history 归并/前插 + outbox 消费测试（含连发相同文本、`sentAfterMessageId` null、failed 条目参与消费、loadMore 不消费用例）
18. `chat-tool-projection.test.ts` → `tool-card.test.ts`：补 interaction 路径与两路径一致性用例
19. 新 `render-list.test.ts`：拼接顺序、key 稳定性（含重放重建复用 run id）、streaming tail、runChanges 落点（history turn 与 run 两种边界）、retrying/withdrawError 投影
20. `streaming-store.test.ts`：39 个用例断言适配（streaming 断言改 `isSessionStreaming`）；补派生同步 project-data-store 调用次数、reconcile 清 run/豁免匹配（含已持久化 error turn 去重豁免）/宿主 interactions 清理、pending settle 用例
21. `MessageItem.test.tsx` 等组件测试适配新结构
22. 新增用户可见文案一律走 `@spherse/i18n`（预期无新增文案；若有，zh/en catalog 同步）

### contracts / server / core

零改动。

## 测试与验收

- `npm run verify`（lint + build + typecheck + 全部单测 + i18n check）
- E2E 按影响面选型（testing.md）：`chat-streaming-resilience`（断线重连/对账）、`chat-retry`、`chat-withdraw`、`floating-chat`
- E2E 兼容性验收：`data-chat-*` DOM 契约原样保留（4 条 chat E2E + `ui-sdk-html-card.spec.ts` 不因选择器变更而挂）
- 手工冒烟：approval/question 交互、loadMore 翻页、trigger 轮折叠、optimistic 发送失败重发

## 风险

| 风险 | 缓解 |
|---|---|
| reducer 重写引入行为回归 | 现有测试逐条语义迁移（不删用例只改断言形状）；E2E resilience 套件覆盖重连/恢复路径 |
| reconcile"清 run + 重放重建"窗口丢内容 | server 对 active run 的重放是全量 compacted 事件序列；`streaming-store.test.ts:421-473`（断线期间完成恢复）与 `:137-215`（重连/withdraw error）用例迁移守卫 |
| 派生 streaming 与 project-data-store 同步抖动 | 单点 subscribe + diff 后才调用；补 store 测试断言调用次数 |
| render list 每次 streaming tick 全量重算（卡片投影、runChanges） | 纯函数 + 输入规模小（单 run、≤几十 tool call）；`useMemo` 依赖 slice 引用，非活动 session 不重算 |
| history 截断（withdraw/retry-resend）与服务端真相短暂不一致 | 两个 sanctioned 截断均有服务端语义背书（数据已删）；截断后正常流（新 run/下次拉取）自然收敛 |
