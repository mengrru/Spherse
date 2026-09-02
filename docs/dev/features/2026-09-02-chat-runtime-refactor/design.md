# Chat runtime 重构：reconcile 状态机提取、事件管线去重与 history 提取

- 日期：2026-09-02
- 状态：实施中（design review 已处理：onclose 降级语义补接口、#4 行为变更补测试、泛型 `as T` 定案、`HistoryPaginationState` 约束修正、批处理 `now` 单值、reconciler 不设 dispose）
- 分支：`refactor/chat-runtime-analysis-8f3k2`

## 背景与问题

`packages/app/src/features/chat/runtime/` 下两个核心文件行数偏多且职责有混合：

- `streaming-store.ts`（525 行）：zustand feature-local store，混杂会话生命周期管理、rAF 事件批处理、withdraw 结算纯逻辑、用户 action、history 分页、runtime wiring 六类关注点
- `chat-session-runtime.ts`（449 行）：per-session WebSocket runtime，`connect()` 为 ~180 行巨石方法，内嵌完整 history-reconcile 状态机（闭包状态 `connectionEvents` / `reconcilingHistory` / `historyWasReady` + ~60 行带退避重试的 `reconcileHistory()`），四个 ws handler 全部捕获这些闭包

`model/` 层已把纯逻辑（reducer / chat-history / retry-plan / withdrawable）拆干净，`streaming-store.test.ts`（702 行）作为穿过 store 的集成安全网已覆盖 heartbeat / reconnect / reconcile / probe / withdraw / history。本次为行为保持重构，不改变任何对外契约。

## 决策

| # | 决策点 | 结论 |
|---|---|---|
| 1 | reconcile 状态机归属 | 提取为 `runtime/history-reconciler.ts` 的 `HistoryReconciler` 类，**每次 `connect()` 新建实例**（对齐现状：闭包状态随单个 socket 生命周期，重连即重置）。回调接口 `isCurrent` / `getSession` / `updateSession` / `applyEvents` / `setStreaming`，由 runtime 在 `connect()` 内绑定到当前 ws 与 store callbacks。**不设 `dispose()`**：现状 reconcile 退避 setTimeout 在 socket 更替后仍会触发、由 `isCurrent()` gate 拒绝，直接移植保持该时序 | 
| 2 | 事件管线去重形态 | reduce→merge→settle 管线整体下沉 `model/chat-session-reducer.ts`，导出纯函数 `applySessionEvents<T>(session, events, now): T`（内部复用 `reduceSessionEvents` + `settlePendingWithdraw`）。store 两处消费点（`flushQueuedEvents`、runtime `applyEvents` callback）改为调用同一函数，删除复制。**泛型返回处用单点 `as T` 断言**（spread 泛型不可赋回 `T` 是 TS 既定限制；安全性由构造保证——所有键均源自 `session`），不退非泛型 |
| 3 | `settlePendingWithdraw` 位置 | 随 #2 移入 `model/chat-session-reducer.ts`（泛型 `<T extends { messages; pendingWithdraw }>`，`flagWithdrawError` 保持模块私有）。理由：纯函数（session × events → session），与 reducer 同族，移入后获得 reducer 级单测 |
| 4 | `applyEvents` 通知语义 | 现状：updateSession 后**无条件**调 `projectDataStore.setStreaming`（该 setter 无 guard，每次都新 Set + set，触发冗余订阅通知）。改为**仅 streaming 值实际变化时通知**，与 `flushQueuedEvents` 既有 streamingChanges 收集语义对齐。值等价（幂等 set），消费方无感知 |
| 5 | probe 去重 | 提取私有 `armProbeTimeout(ws, since)` 消除 re-arm 分支与 fresh-ping 分支两段相同 timeout body |
| 6 | send 方法收窄 | 提取私有 `sendPayload(payload): boolean`（isOpen 检查 + send + true），六个发送方法（`sendMessage` / `abort` / `retry` / `withdraw` / `respondApproval` / `respondQuestion`）改为一行委托 |
| 7 | history action 提取 | `loadMore` / `refreshHistory` 主体移入新文件 `runtime/history-actions.ts`，导出 `loadMoreHistory` / `refreshSessionHistory`，通过 port 接口（`getSession` / `updateSession`）与状态解耦；store action 保留原名做薄委托（公共面 10+ 消费方不动）。`retryHistory`（2 行）留 store。分页状态（`hasMore` / `oldestLoadedId` / `loadingMore` / `historyStatus` / `historyError`）**留在 session 对象内**——UI 直接选择这些字段，外移需重接 selector，不值得。`HistoryPaginationState` 含 `loadingMore`，当前仅 store 的 `StreamingSession` 结构满足（runtime 状态不含 `loadingMore`，本就不接 history-actions） |
| 8 | reconciler 不复用 history-actions | reconcile 流程（退避重试循环 + 事件缓冲 + 历史合并原子单次 updateSession）与分页动作（guard + 单次 fetch）形态不同，强行共享会造出假抽象。保持两套 |
| 9 | store 本体不拆 | `useStreamingStore` 是消费方稳定面；registry（23 行）不动 |
| 10 | 尾部 re-export 清理 | `streaming-store.ts` 末尾的 `parseHistoryMessages` / `appendErrorMessage` / `StreamingSessionData` 三个 re-export 外部零消费方（已核实），按导出面红线删除 |
| 11 | 日志前缀 | `console.warn` 前缀随代码走：history 逻辑移入 `history-actions.ts` 后前缀改为 `[history-actions]`，与各模块以自身名打前缀的既有惯例一致 |

## 必须保持的语义（直接移植，不"顺手修复"）

1. **reconcile 成功路径不做 withdraw settle**：原代码 reduce 后直接返回，不走 `settlePendingWithdraw`；仅缓冲区走 `applyEvents`（含 settle）路径时结算。此不对称原样保留（重构不改行为）。
2. **reconcile 成功路径的原子性**：历史合并 + 缓冲事件归约必须在**同一次** `updateSession` 内完成（中间不得让 rAF flush 插入）。
3. **`finally` 通知条件**：`isCurrent() && session 存在 && (succeeded \|\| historyWasReady)` 时 `setStreaming(session.streaming)`——注意重试耗尽但 `historyWasReady=true` 时**仍会通知**。
4. **onclose 的 historyStatus 降级**：`"syncing" → (historyWasReady ? "ready" : "pending")` 依赖闭包内的 `historyWasReady`，reconciler 需暴露对应能力（见实现节 `applyClosedState`）。
5. **onclose 时仍在 reconcile** → 先 flush 缓冲事件（走 `applyEvents` 路径），再 `flushEvents()`。
6. **onopen 顺序**：心跳 → 捕获 `historyWasReady`（在置 `syncing` 之前）→ 状态更新（open/syncing）→ 发起 reconcile → 发送 initialMessage。
7. **`flushQueuedEvents` 批量单次 `set()`**（多 session 同帧合并）保留；批内**共用同一个 `now`**（`Date.now()` 只取一次传入 `applySessionEvents`，保持同帧 session 的 `lastActivityAt` 一致）。
8. referential-equality 跳过语义：所有 updateSession/updater 无变化时返回原引用，zustand 层面避免无效渲染。

## 各文件实现

### `model/chat-session-reducer.ts`（+#2/#3）

```ts
export interface PendingWithdrawSession {
  messages: ChatMessage[];
  pendingWithdraw: boolean;
}

export function settlePendingWithdraw<T extends PendingWithdrawSession>(session: T, events: AgentEvent[]): T;

export interface SessionEventState extends StreamingSessionData, PendingWithdrawSession {}

export function applySessionEvents<T extends SessionEventState>(session: T, events: AgentEvent[], now: number): T;
```

`applySessionEvents` = 现Store 内 reduce → `{...session, ...reduced}` → settle 三步的逐字移植。

### `runtime/history-reconciler.ts`（+#1，新文件）

```ts
const RECONCILE_BACKOFFS = [1000, 2000, 5000];

export interface HistoryReconcilerCallbacks<T extends ChatSessionRuntimeState> {
  isCurrent(): boolean;                    // this.ws === ws && session 存在
  getSession(): T | undefined;
  updateSession(updater: (session: T) => T): void;
  applyEvents(events: AgentEvent[]): void;
  setStreaming(streaming: boolean): void;
}

export class HistoryReconciler<T extends ChatSessionRuntimeState> {
  // 状态：buffered: AgentEvent[] / reconciling: boolean / historyWasReady: boolean
  shouldBuffer(): boolean;
  buffer(event: AgentEvent): void;
  flushBuffered(): void;                   // 经 callbacks.applyEvents
  onOpen(): void;                          // 捕获 historyWasReady、置 reconciling
  applyClosedState(session: T): T;         // onclose 降级："syncing" → historyWasReady ? "ready" : "pending"，其余原引用字段不动
  reconcile(client: ApiClient, agentId: string, sessionId: string): Promise<void>;
}
```

`reconcile` 逐字移植原 `reconcileHistory()`（含成功原子合并、退避重试、重试耗尽 flush + historyError、finally 通知）。`ChatSessionRuntimeState` 以 `import type` 从 runtime 文件引入（类型单向，无运行时环）。

### `chat-session-runtime.ts`（+#1/#5/#6）

- `connect()` 从 ~180 行缩至 ~80 行：建 ws → 实例化 reconciler 并绑定回调 → 四个 handler 改为薄壳（onmessage 判 `shouldBuffer` 分流；onclose 判 reconciling flush；onopen 调 `reconciler.onOpen()` 后发起 reconcile）
- 移除自身对 `chat-history` / `chat-session-reducer` 的直接依赖（全部转入 reconciler）
- `probe()` / 六个 send 方法按 #5/#6 收窄
- `ChatSessionRuntimeCallbacks` 接口不变（store wiring 零改动）

### `runtime/history-actions.ts`（+#7，新文件）

```ts
export interface HistoryPaginationState {
  messages: ChatMessage[];
  streaming: boolean;
  hasMore: boolean;
  oldestLoadedId: number | null;
  loadingMore: boolean;
  historyStatus: "pending" | "syncing" | "ready";
  historyError: boolean;
}

export interface HistorySessionPort<T extends HistoryPaginationState> {
  getSession(): T | undefined;
  updateSession(updater: (session: T) => T): void;
}

export function loadMoreHistory<T extends HistoryPaginationState>(port, client, agentId, sessionId): void;
export function refreshSessionHistory<T extends HistoryPaginationState>(port, client, agentId, sessionId): void;
```

逻辑逐字移植（含 `refreshHistory` fetch 前后双 streaming guard）。store 的 `StreamingSession` 结构上满足 `HistoryPaginationState`（runtime 状态不含 `loadingMore`，不作为此 port 的消费方）。

### `streaming-store.ts`

- 删除 `settlePendingWithdraw` / `flagWithdrawError` 与两处管线复制，改 import `applySessionEvents`
- `applyEvents` callback：`updateSession(applySessionEvents)` + streaming 变化时通知（#4）
- `loadMore` / `refreshHistory` 委托 `history-actions`
- 删除尾部三个零消费 re-export（#10）
- 预计 525 → ~410 行；`chat-session-runtime.ts` 预计 449 → ~280 行

## 测试

- **存量不动**：`streaming-store.test.ts` 34 个用例全部原样通过（行为安全网，含 reconcile / reconnect / probe / withdraw 全路径）
- `model/chat-session-reducer.test.ts` 新增 `applySessionEvents` / `settlePendingWithdraw` 纯函数用例（error 结算 `_withdrawError`、`turn_withdrawn` 清 pendingWithdraw、无事件命中原引用返回）
- 新增 `runtime/history-reconciler.test.ts`：fake callbacks + fake timer，覆盖 reconcile 期间缓冲、onclose flush、退避重试耗尽 → historyError、socket 更替后中止、重试耗尽但 `historyWasReady=true` 时 finally 仍通知、onclose 降级
- 新增 `runtime/history-actions.test.ts`：port 级单测覆盖 loadMore 四重 guard、refreshHistory 双 streaming guard、页面结果合并
- **#4 行为变更专项**（`streaming-store.test.ts` 新增）：(a) 缓冲 flush 路径中 streaming 翻转（如 reconcile 期间 `run_status active:false` → onclose）时 `projectDataStore.streamingSessionIds` 正确更新；(b) 无 streaming 变化的事件批不再触发 project store set（spy `setStreaming` setter）
- 验证链：`npm run lint --workspace=packages/app` → `npm run typecheck --workspace=packages/app` → `npm test --workspace=packages/app`
- E2E：无用户可见变更，不跑专项；合并前按惯例 `npm run verify:e2e`

## 风险与边界

- **#4 通知语义收紧**：已核查 `streamingSessionIds` 消费方（SessionRow 等）只读集合值，值等价即安全。已知边界：`disconnect` / `cleanupExpired` 移除 session 时不清 `streamingSessionIds`，陈旧 id 理论上可残留到项目关闭——现状的无条件通知恰好构成偶发自愈，收紧后不再有；该残留本身需前置 bug 才会出现，接受
- **泛型接线**：`applySessionEvents<T>` / `settlePendingWithdraw<T>` 返回处单点 `as T`（构造安全）；`HistoryReconciler<T>` 约束经 `import type` 引入 `ChatSessionRuntimeState`，无运行时环
- **不动 `ChatSessionRuntimeCallbacks` 接口**：收窄 event-sink 三回调（enqueue/apply/flush）为单一接口是更优长期形态，但属于契约变更，本次不做

## 文档同步（doc-sync 清单）

- `docs/official/project-structure.md`：新增 `runtime/history-reconciler.ts`、`runtime/history-actions.ts`
- `docs/official/architecture/chat.md`（若维护 runtime 模块清单）：同步模块职责描述
