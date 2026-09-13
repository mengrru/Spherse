# Chat 前端运行时重构：Entry 模型 + MessageGroup 组装（旧协议先行）

- 日期：2026-09-13
- 分支：`bright-falcon`（单 PR）
- 前置：`docs/dev/features/2026-09-05-chat-refactor/`（协议 v2 已合入 PR1/PR2；本设计**替代其 §3–§6 的前端部分**，renderer 消费 v2 延后为独立迁移）
- 状态：已实施（commit `db4a464` + E2E `fadd5dd`）；code review 完成（2 important / 4 medium / 1 minor，均已处理）；doc-sync 完成
- 范围：仅 `packages/app`（`features/chat` 及其消费方）；不改 contracts / server / core；`lib/ws/WsConnection` 仅加一个可选配置

## 1. 背景与动机

### 1.1 runtime 两个文件职责过载

- `chat-session-runtime.ts`（450 行）：WS 装配、重连退避、心跳、probe、事件解码分发、恢复期缓冲、HTTP 对账、出站控制六件事挤在一个类里；与 store 之间靠 8 个回调互相穿透（`getSession/updateSession/enqueueEvent/applyEvents/flushEvents/setStreaming/takeInitialMessage/shouldReconnect`）。
- `streaming-store.ts`（525 行）：状态容器、生命周期（attach/refcount/TTL）、连接编排、乐观发送、retry/withdraw/approval、分页、rAF 批处理、跨 store 镜像；actions 之间互相调用（`executeRetry → sendMessage`）。
- 两者与 L1 `WsConnection`（bus 已迁移）形成第三套连接管理实现。

### 1.2 分组语义有损且分散

- tool call / tool result 的配对在 reducer 尾部扫描（`chat-session-reducer.ts:121-152`）和 history 解析（`chat-history.ts:144-188`）各写一遍；`tool_execution_end` 找不到宿主时**直接丢弃**（`chat-session-reducer.ts:135-152`）——孤儿 log。
- trigger 分组在渲染前用 `_triggered` 标记事后扫数组（`turn-groups.ts`）。
- 派生数据各自扫数组：`aggregate-file-changes`（runEndIndex 扫描）、`html-card-dedup`、`retry-plan`、`withdrawable`。
- 渲染 key 用数组 index（`MessageList.tsx:69`），loadMore 前插时 React 复用错位。

### 1.3 身份模型缺位

`ChatMessage` 只有 `_messageId`（= HTTP entry seq）和 `_optimistic`；流式消息没有稳定身份，v2 的 `seq/messageId/clientId` 无处安放。本设计把 Entry 的身份字段建好（旧协议下部分为空），v2 迁移只补数据来源。

## 2. 目标与非目标

**目标**

1. runtime 拆成单职责模块（每文件 <150 行为软目标），删除 `ChatSessionRuntime` / `ChatRuntimeRegistry`，连接统一走 `WsConnection`。
2. `ChatEntry` 成为会话状态的 canonical 表示（1:1 日志、带身份）。
3. 新增 `MessageGroup` 组装层：渲染单元由组装产生，**每个 entry 必须落在某个 group 内**（不出现孤儿 log）。
4. 滚动方案、恢复语义、错误/重试/撤回/审批交互保持现状；顺手修复已知缺陷（见下）。
5. 留出 v2 迁移缝：Entry 身份 + recovery 模块化，迁移时不动组件与组装器。

**本次显式行为差异（除此之外行为等价）**

| # | 差异 | 原因 |
|---|---|---|
| 1 | 孤儿 tool result 不再丢弃，降级为 `tool-result` bubble 展示 | 不出现孤儿 log 的核心目标 |
| 2 | `MessageList` key 全部稳定身份化 | 修 loadMore 前插复用错位 |
| 3 | `fatalCloseCodes = {4400, 4401, 4402}`（现状仅 4401） | 对齐 server 已实现的 close code 族（`ws-chat.ts:14-18`） |
| 4 | `loadMore` 不再丢弃进行中的流式窗口 | 现 `mergeHistoryMessages` 会把无 id 非 error 的 transient 一起丢掉 |
| 5 | tool result 归属由显式 `ownerAssistantId` 决定（同一 run 内最近 assistant） | 修「新 run 首 tool call 误入历史气泡」的尾扫缺陷 |
| 6 | tool 卡片投影 live/history 统一走一套 builder | 消除现 `commandCardFromResult`（live）与 `buildCardFromToolResult`（history）漂移

**非目标**

- 不消费 v2 事件（重放族继续 ignored），不做游标重放。
- 不动 wire 协议 / contracts / server / core；不动 UI SDK 协议。
- 不做 bus 与 chat 的连接复用；不动滚动机制（column-reverse 保持）。
- 不清理 TriggerEventBridge 的 `refreshHistory`（依赖 server 侧 trigger 收口，PR5 另做）。
- 不引入 internal event 词汇（直接消费 contracts 类型，decode 处补字段透传）。

## 3. 核心模型：ChatEntry

### 3.1 类型

```ts
// features/chat/model/entry.ts

export type EntryId = string;

interface EntryBase {
  id: EntryId;        // 客户端稳定身份；已有 entry 被 upsert 时保留原 id
  seq?: number;       // 持久身份：旧协议 = HTTP entry id；v2 = SessionEvent.seq
  streamId?: string;  // 进行中 assistant 窗口：旧协议客户端生成；v2 = server messageId
  time?: number;
}

export interface UserEntry extends EntryBase {
  kind: "user";
  text: string;
  clientId?: string;                // 发送时生成；v2 echo 精确结算
  attachments?: ChatAttachment[];
  triggered?: true;
  triggerName?: string;
  optimistic?: boolean;             // 本地插入、待持久行替换
  sendFailed?: boolean;             // link 未就绪时本地发送失败
}

export interface ToolCallRef {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface EntryError {
  message: string;
  code?: ErrorEventCode;
  retrySuppressed?: boolean;        // 原 _withdrawError
}

export interface AssistantEntry extends EntryBase {
  kind: "assistant";
  text: string;
  toolCalls: ToolCallRef[];         // content（history）与 tool_execution_start（live）按 toolCallId 合并
  streaming?: boolean;
  error?: EntryError;               // 原 _error / _errorCode / _turnError
  stopReason?: string;
}

export interface ControlProjection { // 仅 live / 快照存在；落库后由 v2 replay 提供
  requestId: string;
  kind: "approval" | "question";
  status: "pending" | "approved" | "rejected" | "answered" | "timeout";
  approved?: boolean;
  answer?: string;
  timedOut?: boolean;
  reason?: string;
}

export interface ToolResultEntry extends EntryBase {
  kind: "tool-result";
  toolCallId: string;
  ownerId?: EntryId;                // 所属 assistant entry（显式跟踪，见 §3.2）
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;                 // 原样保存；卡片投影在组装层做
  partialResult?: unknown;
  isError?: boolean;
  control?: ControlProjection;
}

export interface ErrorEntry extends EntryBase {
  kind: "error";
  message: string;
  code?: ErrorEventCode;
  retrySuppressed?: boolean;
}

export type ChatEntry = UserEntry | AssistantEntry | ToolResultEntry | ErrorEntry;
```

**身份生成**

- 持久 entry：`id = "e" + seq`（seq 单调）。
- live assistant 窗口：`streamId` 客户端生成（`"s" + counter`），`id = streamId`；v2 时直接用 server messageId。
- 乐观 user：`clientId` 客户端生成（`crypto.randomUUID()`），`id = clientId`。
- 错误 entry / 无身份兜底：模块级自增计数器。
- upsert 一律按身份（seq > streamId > clientId > id）查找既有 entry 并保留其 `id`，保证渲染 key 稳定。

### 3.2 reducer 入口

```ts
reduceLiveEvents(state, events: AgentEvent[]): ChatSessionState
applyHistoryPage(state, page, opts: { mode: "latest" | "loadMore" }): ChatSessionState
```

**run 边界与 tool owner**：session 态维护 `ownerAssistantId: EntryId | null` 与 `openStreamId: EntryId | null`。

- `message_start`：开窗并设 `openStreamId` / `ownerAssistantId`；若存在无 `streamId` 且 `streaming` 的 assistant（retry 复用场景），绑定并复用该 entry。
- `message_update`：upsert open window 的 text；无窗口时懒建（保持现条件 `text || 无 assistant`，`chat-session-reducer.ts:87-97`）。
- `message_end`：收窗（`openStreamId = null`），**但 `ownerAssistantId` 保留**——pi 循环里工具在 assistant 消息完成（落库）之后才执行。
- `tool_execution_start/update/end`：按 toolCallId upsert ToolResultEntry（update 时懒建），`ownerId = ownerAssistantId`；`tool_execution_start` 同时把 toolName/args 合并进 owner assistant 的 `toolCalls`。
- `agent_start`（新 run 开始）/ 新 user entry / `agent_end`：重置 `ownerAssistantId`。

**事件映射表**

| wire 事件 | Entry 变更 |
|---|---|
| `message_start` | 见上（开窗 / retry 复用） |
| `message_update` | upsert open window text（懒建条件保持现状） |
| `message_end` | 收窗：text / timestamp / stopReason / error；v2 补 `seq`；`streaming=false` |
| `tool_execution_start/update/end` | 按 toolCallId upsert ToolResultEntry，记 `ownerId` |
| `control_request/resolved` | 写/清对应 ToolResultEntry 的 `control` |
| `error` | 有 open assistant → 并入 `error` 并收窗；否则追加 ErrorEntry |
| `agent_end` / `run_status:false` | 收窗、重置 owner、清 pending question control（保持现语义）；runChanges 改为组装期派生 |
| `turn_withdrawn` | 从最后一条 user entry 处截断（v2 改为按 seq 区间）；清 `pendingWithdraw` |
| 任意事件，`pendingWithdraw` 且事件含 `error` | 清 `pendingWithdraw`，对目标 error（open assistant 或新 ErrorEntry）置 `retrySuppressed`（现 `settlePendingWithdraw` 语义） |
| `agent_start` / `turn_start` / `turn_end` | `agent_start` 重置 owner；`turn_start/turn_end` 不产生 entry（边界由 user entry + owner 派生） |

**`applyHistoryPage` 规则**

1. page entries 解析为 entry（user / assistant / tool-result），`id = e:seq`；tool-result 在页内按 toolCallId 配对 `ownerId`（服务端页原子性保证页首不会出现孤儿 toolResult，`chat.md:100`）。
2. 按 `seq` upsert：已有 seq 的 entry 被替换但保留 `id`。
3. **transient 结算（mode 差异）**：
   - `mode: "latest"`（reconcile / refresh）：删除本地无 `seq` 的 assistant 窗口与 tool-result entry（它们是运行中投影，页内未持久化；重连缓冲事件会在 merge 后重建，断线期间 run 已结束时由页内持久行覆盖）。保留乐观 user（按内容结算后移除）与 error entry（无 seq 断言）。
   - `mode: "loadMore"`：不删除本地尾部（修复行为差异 #4），仅前插更老 seq 的 entry。
4. 排序：所有带 seq 的 entry 全局按 seq 升序；无 seq 的乐观/error entry 保持相对顺序追加尾部。
5. 乐观 user 结算：旧协议内容匹配，收敛在 `settleOptimistic()` 单函数；v2 换成 clientId 精确匹配。
6. 仅 `mode: "latest"` 推进 `cursor = max(cursor, 页内最大 seq)` 并更新 `history.status/error`；loadMore 不推进。
7. 无 seq 的 page entries（legacy migration 路径）按「latest 后置 / loadMore 前置」整段拼接，不去重（保持现 `chat-history.ts:29-34` 语义）。

`retry-last`：标记失败 assistant entry 为 `streaming` 并清 error，下一个 `message_start` 复用该 entry（旧协议下的现行为）；v2 由 `turn_retried.abandonedSeqs` 删除代替。

## 4. MessageGroup 组装

```ts
// features/chat/model/message-group.ts

export interface ToolItem {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: "running" | "completed" | "error";
  result?: string;
  partialResult?: string;
  card?: ChatCard;
}

export type Bubble =
  | { kind: "assistant"; id: string; entryId: EntryId; text: string; tools: ToolItem[];
      streaming?: boolean; error?: EntryError; timestamp?: number; runChanges?: FileChangeCard[] }
  | { kind: "tool-result"; id: string; entryId: EntryId; tool: ToolItem }
  | { kind: "error"; id: string; entryId: EntryId; error: EntryError; timestamp?: number };

export interface MessageGroup {
  id: string;
  kind: "turn" | "trigger-turn";
  user?: UserEntry;                 // headless turn（trigger run 先到 / 分页页首）时缺省
  triggerName?: string;
  hasError: boolean;
  bubbles: Bubble[];
}

export function assembleGroups(entries: ChatEntry[]): MessageGroup[];
```

**不变量（property test 锁死）**

1. 每个 entry 恰好被消费一次：覆盖 + 无重复（`tool-result` 归属 owner bubble，`error` 归属气泡或独立 error bubble）。
2. user entry 开新组；`triggered` 开 `trigger-turn`；assistant 无前置 user 时创建 headless turn。
3. tool-result 配到 `ownerId` 指向的 assistant bubble；owner 缺失时按 toolCallId 在当前组内向前搜；仍找不到 → 生成 `tool-result` bubble 展示，**绝不丢弃**。
4. error entry 有 open assistant bubble 则并入，否则独立 error bubble。
5. group / bubble key 一律来自 entry 身份，禁止 index。
6. 流式：open window 的 assistant bubble 由组装自然产出；v2 重放按 seq upsert 同一 entry，key 不变。
7. 组装是纯函数，用 `useMemo` 按 `entries` 引用触发；`ToolItem.card` 按 entry 对象身份 memo（`WeakMap<ChatEntry, ChatCard>`），避免流式每帧重算卡片。

**ToolItem 卡片投影（状态机，消除 live/history 漂移）**

优先级：`control`（pending/resolved，live/快照）> `partialResult`（live 流式）> `result`（最终）。

- `control` 存在时按 kind 构造 approval / question / command pending_approval 卡（对齐 `chat-session-reducer.ts:178-263` 的现语义）。
- `partialResult` 经 `extractCardFromPartial(toolName, partialResult)` 投影（html/image/command）。
- `result` 统一走 `buildCardFromToolResult(toolName, call, details)`（覆盖 render_card / generate_image / run_command / ask_user 与 rejected 语义），live 与 history 共用。
- 状态：`isError → error`；有 result → `completed`；否则 `running`。
- 单测覆盖四类卡片在 live 流式、live 完成、history 三路径下产出一致。

**派生（全部基于 groups）**

| 派生 | 现实现 | 新实现 |
|---|---|---|
| runChanges | `agent_end`/history 时按 runEndIndex 扫 messages 并挂最后一条 assistant | 组装期扫 turn group 内 entries，挂该组最后一个 assistant bubble（视觉不变） |
| superseded html cards | `computeSupersededToolCallIds(messages)` | 扫 groups 的 ToolItem |
| withdrawable | `lastWithdrawableUserIndex(messages)` | **最后一个包含 user 的 group** 的 user entry（`sendFailed` 排除） |
| retry plan | `planRetry(messages)` | 对最后一个 group/bubble 判断，语义不变 |
| pending approvals | `collectPendingApprovals(sessions)` | 扫 groups 的 ToolItem.card.requestId |
| ThinkingIndicator | `streaming && last.role === "user"` | `streaming && 最后一个 group 无 assistant bubble` |

## 5. Runtime 模块拆分

```
features/chat/runtime/
├── session-store.ts       # zustand 壳：state 定义 + updateSession + 闭包表（links/recoveries/queues）+ actions 组合
├── session-link.ts        # 每 session 一个 WsConnection：url/心跳/fatal/probe + decode 分发 + 出站控制
├── session-recovery.ts    # 旧协议恢复：onOpen HTTP 对账、事件缓冲、[1,2,5]s 退避、historyError
├── event-queue.ts         # rAF + setTimeout 兜底批处理
├── session-lifecycle.ts   # attach/detach 引用计数、TTL 定时器、disconnect(Project)、initialMessage
├── history-loader.ts      # 首页 / loadMore / refreshHistory 拉取 + applyHistoryPage
├── outbound-actions.ts    # send（乐观）/ retry / withdraw / abort / respondApproval / respondQuestion
└── decode.ts              # parseChatServerEvent + parseAgentEvent（本次改为无损保留 seq/messageId）
```

**删除**：`chat-session-runtime.ts`、`chat-runtime-registry.ts`、`streaming-store.ts`、`streaming-store.test.ts`（测试按模块重写）。

**模块接口**

```ts
interface SessionHost {
  getSession(id: string): ChatSessionState | undefined;
  updateSession(id: string, updater: (s: ChatSessionState) => ChatSessionState): void;
  enqueueEvent(id: string, event: AgentEvent): void;
}

createSessionLink(params, {
  onOpen(), onClose(), onStateChange(change), onEvent(event), isAttached(): boolean,
}): { connect, reconnect, probe, sendMessage, retry, withdraw, abort, resolveControl, dispose, isOpen }

createHttpRecovery(host: RecoveryHost): { onOpen(), onFrame(event): boolean, onClose(), cancel() }
// RecoveryHost: fetchPage() / applyPage(page, mode) / bufferDuringSync(event) / applyBuffered() / setHistoryStatus()

createHistoryLoader(host, client): { bootstrap(), loadMore(), refreshHistory(), retryHistory() }
createOutboundActions(host): { sendMessage, retry, withdrawLastTurn, abort, respondApproval, respondQuestion }
```

**生命周期归属**

| 资源 | 创建 | 销毁 / 取消 |
|---|---|---|
| link（WsConnection） | attach 首次 / reconnect | `dispose()` on detach & TTL 到期 & `disconnectProject`；`detach` 后由 link 的 `shouldRetry()` 阻止重连 |
| recovery（缓冲 + 退避 timer） | attach 时随 link | `cancel()` 必须打断退避链与 in-flight fetch（generation guard），disconnect 时调用 |
| event-queue（rAF / timeout） | store 首次 enqueue | `disconnect` 时取消并丢弃队列 |
| cleanup timer | 首个 session attach | 无 session 时停止（保持现 `streaming-store.ts:342-345` 语义） |
| history fetch | loadMore / refresh / recovery | 迟到响应按 session generation + `disposed` 守卫丢弃（不重建已清理状态） |

- `WsConnection` 配置沿用 bus 模式：`backoffMs [1,2,5,10,30]s`、`maxRetries 10`、心跳 30s/60s、probe 5s。
- **L1 唯一改动**：`WsConnectionConfig` 增加可选 `shouldRetry?: () => boolean`（默认 `true`）；link 传入 `() => isAttached()`，保持现状「detach 后不重连」（`chat-session-runtime.ts:219,301-303`）。bus 不传，行为不变；补 L1 单测。
- **detach 后 socket 处理**：与现状一致，detach 不主动断链（TTL 到期才 disconnect）；重连拦截在 close 路径。

## 6. Store 状态与 actions

```ts
interface ChatSessionState {
  projectId: string;                 // disconnectProject / ApprovalNotice 跳转需要
  agentId: string;
  entries: ChatEntry[];
  openStreamId: EntryId | null;
  ownerAssistantId: EntryId | null;
  streaming: boolean;
  pendingWithdraw: boolean;
  cursor: number;                    // 旧协议由最新页维护；v2 由 wire seq 推进
  connection: { state: WsConnectionState; attempt: number; delayMs: number; closeCode?: number };
  history: { status: "pending" | "syncing" | "ready"; hasMore: boolean;
             oldestSeq: number | null; loadingMore: boolean; error: boolean };
  scrollPosition: number;
  attachedCount: number;
  lastActivityAt: number;
}
```

actions 与现 API 对齐：`attach / detach / touch / disconnect / disconnectProject / cleanupExpired / loadMore / refreshHistory / retryHistory / sendMessage / retry / withdrawLastTurn / abort / reconnect / resumeProbeAll / respondApproval / respondQuestion / setScrollPosition`。

- TTL 语义保持现状：到期删除整个 session（含 cursor）。v2 迁移时若需跨 TTL 增量重放，再把 cursor 外置（本期不预留）。
- UI SDK `send-message` 的 HTTP fallback **保留在 handler**（`send-message.ts:29-45`），action 只负责 attached 时的 WS 发送并返回 boolean；handler 仍承担 `ensureProjectSession` + 409 映射。§7 对应行改为「仅改 import/调用」。
- `streaming` 不再双写 `project-data-store`：新增 `useSessionStreaming(sessionId)` 作为 chat feature 对外唯一 selector 出口（依据 `2026-08-22-frontend-architecture-followup/followup.md:205-213` option 2）；`project-data-store` 删除 `streamingSessionIds`/`setStreaming`，只留 `initialMessage`。

## 7. 消费方迁移

| 文件 | 变化 |
|---|---|
| `hooks/useChatSession.ts` | 新 store 选择器 + `useChatGroups(sessionId)`（memo 组装） |
| `chat/index.tsx` | 消费 groups；action 全部来自 hook，不再 `getState()` |
| `MessageList.tsx` | 接收 `groups`；key 用 group/bubble id |
| `MessageItem.tsx` | 拆为 `UserBubble` / `AssistantBubble` / `ToolItemView` |
| `TriggerTurnGroup.tsx` | 消费 `MessageGroup`（bubble 渲染函数替换 renderItem/index） |
| `ConnectionBanner.tsx` | 消费 `WsConnectionState`：`connecting/waiting-backoff → 重连中`；`failed/fatal → reconnectFailed 态`（文案沿用现有 i18n key，不新增文案） |
| `hooks/useChatScroll.ts` | scroll 选择器化，保留现有滚动语义 |
| `ApprovalNoticeBridge.tsx` | 基于 groups 的 pending control 选择器 |
| `TriggerEventBridge.tsx` | 仅改 import（refreshHistory 保留） |
| `layouts/project-lifecycle.ts` | 仅改 import（disconnectProject） |
| `lib/web-resume-probe.ts` | 仅改 import（resumeProbeAll） |
| `ui-sdk/handlers/send-message.ts` | 仅改 import/调用（同 §6） |
| `features/agent-session-list/SessionRow.tsx` | 改用 `useSessionStreaming` |
| `stores/project-data-store.ts` | 删 `streamingSessionIds` / `setStreaming` |

**测试迁移**：`project-lifecycle.test.ts`、`send-message.test.ts`、`web-resume-probe.test.ts` 中直接 import/spy 旧 store 的写法同步改为新 store/hook；`streaming-store.test.ts` 场景拆分到 `session-recovery` / `outbound-actions` / `session-lifecycle` 测试。

**Bubble → 渲染组件映射**：`assistant → AssistantBubble`；`tool-result（孤儿）→ AssistantBubble`（仅 ToolItemView）；`error → ErrorBubble`（复用 ErrorMessageSection）。`showTime` 规则：user bubble 与每 group 最后一个 bubble（等价现 `role==="user" || isLast || 下一个是 user`）。

## 8. 旧字段 → 新模型映射

| 旧 | 新 |
|---|---|
| `ChatMessage._messageId` | `Entry.seq` |
| `_optimistic` | `UserEntry.optimistic`（+ `clientId`） |
| `_streaming` | `AssistantEntry.streaming` |
| `_toolCalls`（含 `_card`） | `AssistantEntry.toolCalls` + `ToolResultEntry`，组装为 `ToolItem` |
| `_error` / `_errorCode` / `_turnError` | `EntryError`（`AssistantEntry.error` 或 `ErrorEntry`） |
| `_withdrawError` | `EntryError.retrySuppressed` |
| `_sendFailed` | `UserEntry.sendFailed` |
| `_runChanges` | turn group 的派生，挂最后一个 assistant bubble |
| `_attachments` / `_triggered` / `_triggerName` | `UserEntry` 同名字段 |
| `mergeHistoryMessages` 内容匹配 | `settleOptimistic()`（v2 换 clientId） |

## 9. v2 衔接（迁移清单）

1. `decode.ts` 本次即改为**无损**：`message_start/update/end`、`agent_end` 透传可选 `messageId/seq`（现 `agent-event-parse.ts:156-172` 会重建对象丢弃字段），v2 事件类型仍归 ignored；补字段透传单测（保留「v2 事件类型被忽略」的现有测试）。
2. `session-recovery.ts` 换成 `cursor-replay` 实现（首帧判定、since、重放批 → `applyPersistedEvents`），HTTP 实现降为 legacy fallback。
3. reducer 补 `applyPersistedEvent`：turn/start|end、turn/withdrawn 按 seq 截断、turn/retried 按 abandonedSeqs、`compaction/applied`（按 `excludedSeqs` 移除被压缩条目）、control 落库事件；messageId↔seq stitch 去重不变量（旧设计 §1.5）。
4. 组件 / 组装器 / store 状态形状不动。

## 10. 测试策略

| 层 | 测试 |
|---|---|
| model | 组装器 property test（种子随机 loop，不引新依赖）：随机 entry 序列 → 覆盖/无重复/无孤儿/稳定 key；reducer live+history 交错、transient 结算（断线期间 run 完成/进行中两场景，对齐 `streaming-store.test.ts:421-473`）、pendingWithdraw/retry、tool owner 顺序（message_end → tool_execution_start → agent_end） |
| runtime | recovery（fake fetcher + fake timers，退避/historyError/cancel 打断）、queue（fake timers + 后台冻结兜底）、lifecycle（引用计数/TTL/级联/停 timer）、link（出站 payload、fatal close code、detach 不重连）、**outbound-actions**（乐观发送、sendFailed、retry-last/resend + dropCount、withdraw、approval/question） |
| L1 | `WsConnection.shouldRetry` 单测（bus 行为不变） |
| 组件 | MessageList（prepend + 重排下 key 稳定）、TriggerTurnGroup、UserBubble/AssistantBubble/ToolItemView、ErrorBubble、SessionRow streaming、ConnectionBanner 映射 |
| 消费方 | project-lifecycle / send-message / web-resume-probe 既有测试迁移后保持绿 |
| E2E | `chat-streaming-resilience`、`chat-retry`、`chat-withdraw`、`floating-chat`、`ui-sdk`（合并前 `npm run verify:e2e`） |

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| 大 PR 同时动模型与组件 | 实施顺序：先 model（可先并行于旧 store 单测）→ runtime 拆分（行为等价）→ 切组件；每步全绿再前进 |
| 历史对账 transient 结算写错（双气泡/丢内容） | §3.2 规则 3 + 两个断线场景测试 + 组装器 property test |
| tool owner 写错导致卡片归属错乱 | owner 显式状态 + 顺序测试 + live/history 三路径卡片一致性测试 |
| 稳定 key 改变 React 复用，影响 loadMore 滚动恢复 | `useChatScroll` 现有测试 + 组件测试 + E2E |
| retry 复用 entry 的旧协议 hack | reducer 单点 + 测试；v2 abandonedSeqs 删除该逻辑 |
| 生命周期黑洞（timer/fetch/recovery 残留） | §5 生命周期表 + `dispose` 后无迟到写入测试（对齐 `2026-08-28-project-lifecycle-orchestration` 约束） |
| 未知消费方依赖旧导出 | 全量 `rg` 清点（8 个源文件 + 4 个测试），不留旧导出名过渡 |

## 12. 实施顺序（单 PR）

1. model：`entry.ts` / `message-group.ts` / `entry-reducer.ts` / `history-entries.ts` / 派生函数 + 测试（不接线）。
2. L1：`WsConnection.shouldRetry` + 测试。
3. runtime：8 个模块 + 测试；store actions 接线；旧 store 消费方切换到新 API。
4. 组件：groups 渲染、bubble 拆分、ConnectionBanner 映射、稳定 key。
5. 清理：删除 `chat-session-reducer.ts` / `chat-history.ts` / `turn-groups.ts` / `retry-plan.ts` / `withdrawable.ts` / `approval-notice.ts` / `html-card-dedup.ts` 中被取代的实现与测试（保留仍被复用的工具投影函数），删除 `project-data-store` 镜像。
6. `npm run verify` + 受影响 E2E。

## 13. 文档同步（收尾时执行）

| 文档 | 更新点 |
|---|---|
| `docs/official/architecture/chat.md` | Renderer 三层描述（runtime/store/reducer → Link/store/Entry+Group）、`_` 字段表、重连与历史对账章节 |
| `docs/official/architecture/frontend.md` | `project-data-store` 投影字段变化、跨 feature selector 边界 |
| `docs/official/project-structure.md` | `features/chat/runtime|model` 目录描述 |
| `docs/official/glossary.md` | `streaming-store` 词条 |
| `packages/app/README.md` | 状态归属表（streaming 投影） |
| `docs/dev/features/2026-09-05-chat-refactor/plan.md` | 标注 PR3/PR4 被本设计替代 |
| `docs/dev/backlog.md` | 相关条目去留 |
