# Chat 失败/错误重试能力与链路韧性增强

## 概述

为 chat 增加失败/错误的手动重试能力，并修复链路上多处静默失败/数据丢失的韧性缺陷。采用**客户端驱动重试、服务端提供最小原语**的方案，与现有「服务端 dumb transport + 客户端 streaming store 编排」架构一致。

两类工作（重试优先）：
1. **手动重试能力**：失败助手回复重新生成、发送失败/断连丢消息的恢复重试
2. **链路韧性增强**：断连感知、消息防丢失、自动重连收敛、历史拉取重试、approval 反馈

仅覆盖**失败场景**的重试，不含成功回复的「重新生成」。

## 背景与现状

链路：`Composer → useStreamingStore → ChatSessionRuntime(WebSocket) → ws-chat → ChatSessionHub → SessionManager → LiveSession(pi-agent-core)`

已具备的韧性：WebSocket 指数退避重连（1→30s）+ 心跳；`ChatSessionHub` 多路复用使 run 在 socket 断开时存活并 replay；断连重连后历史对账保留乐观消息与临时错误气泡；助手回复失败时保留已流式部分内容；SQLite WAL 持久化 + 进程重启 restore。

### 关键技术约束

- pi-agent-core **无** retry/regenerate/undo API。失败时 `handleRunFailure` 会把**用户消息 + 合成失败助手消息**都提交到 `agent.state.messages` 并（经 LiveSession 的 `message_end` 处理）写入 SQLite。
- pi-agent-core `Agent.continue()`：要求最后一条消息是 user 或 tool-result，从当前 transcript 继续。
- pi-ai 使用各 provider 官方 SDK（如 `client.messages.create`），失败抛出的 SDK 错误**带 `.status`**（429/5xx 等）；网络层错误（fetch/超时）无 status。SDK 默认 `maxRetries: 0`。

### 待修复的韧性缺陷

| 编号 | 问题 | 位置 |
|---|---|---|
| A1 | 断连时静默丢消息：`sendMessage` socket 关闭返回 `false`，`Composer.send()` 忽略返回值直接清空输入框+草稿，用户文字永久丢失、零反馈 | `Composer.tsx` / `streaming-store.ts` |
| A2 | 断连状态对用户不可见：store 记录了 `connectionStatus` 但无组件读取，composer 在死连接时看起来可用 | `streaming-store.ts` / `index.tsx` |
| A3 | 历史拉取失败后永久卡 loading：`reconcileHistory` catch 只 `console.warn`，永不重试 | `chat-session-runtime.ts` |
| A4 | 失败响应无法重试：`ErrorMessageSection` 只读，无重试/重新生成按钮 | `ErrorMessageSection.tsx` |
| B1 | approval 点击静默丢失：`respondApproval` fire-and-forget，socket 断开时点击无效、卡片仍 pending | `index.tsx` / `streaming-store.ts` |
| C1 | 无限重连、无「放弃」状态：非 NotFound 的服务端错误以 1000 关闭，客户端无限重连、无 UI 信号 | `chat-session-runtime.ts` |
| W2 | `onerror` 是 no-op，最坏 60s 僵尸 socket | `chat-session-runtime.ts` |

## 设计

### 0. 错误的两条来源（决定分类与重试机制）

错误按如何到达客户端分两条路径，分类与重试机制因此不同：

- **Source 1（pre-prompt 抛错）**：`LiveSession.sendMessage` 在调用 `agent.prompt()` 之前抛出（如 `ensureModel` → `ModelNotConfiguredError`、profile `NotFoundError`）。`sendMessage` reject → `ws-chat` catch → 发 `error` 事件（带 `code`）。**用户消息未进入 agent state、未持久化**（无 `_messageId`）。
- **Source 2（LLM/运行时失败）**：pi-agent-core 的 `handleRunFailure` **吞掉**异常、不 re-throw，改为 emit 一个合成的 `message_end`（`stopReason: "error"` + `errorMessage` 字符串）。`agent.prompt()` 正常 resolve。错误经 subscribe 回调 → 持久化 → 转发客户端，reducer 在 `message_end` 分支落 `_error`。**用户消息已持久化**（`runAgentLoop` 在流式前先 emit user 的 `message_end`，有 `_messageId`）。SDK 错误的 `.status` 在此时已被 pi-ai 编码进 `errorMessage` 字符串、结构化 status 丢失。

结论：
- Source 1 的分类在服务端（此时持有 typed Error）；Source 2 的分类只能在客户端（按 `errorMessage` 字符串）。
- Source 2 的重试用「pop 失败助手消息 + `continue()`」（用户消息已在服务端）；Source 1 的重试必须「重新发送用户消息」（服务端从未收到）。客户端按「触发重试的用户消息是否有 `_messageId`」选择路径——这同时统一了下文的「发送失败重试」。

### 1. 错误分类

**Source 1（服务端，typed Error）**：在 `@spherse/core` 新增 `classify-run-error.ts`，导出 `classifyRunError(err): ErrorEventCode`：

| 分类 | 判定 | 例子 |
|---|---|---|
| `MODEL_NOT_CONFIGURED` | `err instanceof ModelNotConfiguredError` | 无模型 |
| `PERMANENT` | 有 `err.status` 且为 4xx（≠429） | 400 鉴权/参数、404 |
| `TRANSIENT` | 有 `err.status`∈{429, 5xx}，或无 status（网络/fetch/超时） | 429 限流、502、`fetch failed`、`ETIMEDOUT` |

无法判定时默认 `TRANSIENT`（自动重试上限压低为 2，最坏多一次无效调用，无害）。`ws-chat.ts` 在捕获 `sendMessage` 失败、发 `error` 事件时用 `classifyRunError(err)` 填 `code`。abort（用户主动取消）不进入错误分类路径。

**Source 2（客户端，错误字符串）**：在 `packages/app/src/features/chat/model/classify-error.ts` 新增 `classifyErrorMessageString(message: string): ErrorEventCode`，对 `errorMessage` 做正则匹配（与 pi-ai 自身的 overflow 检测同构，是该生态既有约定）：

| 分类 | 判定 |
|---|---|
| `PERMANENT` | 命中 context overflow / `4\d\d`(≠429) / `invalid` / `unauthorized` / `forbidden` 等 |
| `TRANSIENT` | 命中 `429` / `rate limit` / `too many requests` / `5\d\d` / `timeout` / `timed out` / `network` / `fetch failed` / `ECONN` 等 |
| 默认 | 无法判定 → `TRANSIENT`（与 Source 1 默认一致） |

reducer 在处理 `message_end`（`stopReason === "error"`）分支时，用 `classifyErrorMessageString(errorMessage)` 填 `_errorCode`；`parseHistoryMessages` 加载历史失败消息时同样重新派生 `_errorCode`（不持久化 code，仅用于显示；自动重试只在活跃 turn 触发，不作用于历史消息）。

扩展 `packages/server/src/contracts/websocket.ts` 的 `ErrorEventCode`：

```ts
export enum ErrorEventCode {
  ModelNotConfigured = "MODEL_NOT_CONFIGURED",
  Permanent = "PERMANENT",
  Transient = "TRANSIENT",
}
```

移除 `UNKNOWN`，折叠进默认（`TRANSIENT`）。

> 注：客户端现有对 `ModelNotConfigured` 的特殊文案分支保持不变；新增的 `Permanent`/`Transient` 在 UI 上统一走「错误 + 重试按钮」呈现。

### 2. 服务端原语（保持 dumb transport）

**新增 `retry` 客户端消息**（无 content），对应 Source 2 重试。`ChatSessionHub.retryLastTurn()` → `LiveSession.retryLastTurn()`：

- 前置条件：session 当前未在跑（`channel.running === false`）**且** `agent.state.messages` 最后一条是 `role==="assistant"` 且 `stopReason === "error"` 的消息
- 动作：
  1. 从 `agent.state.messages` 弹出该失败助手消息（`agent.state.messages = messages.slice(0, -1)`）
  2. 用 `liveMessageDbIds` 定位并从 SQLite 删除对应行（session store 新增按 messageId 删除能力，事务内同步更新 session `updated_at`）
  3. 调用 `agent.continue()`（此时最后一条为原 user 或 tool-result 消息，满足 continue 前置）
- 事件流与正常 turn 完全一致（经 hub 的 `startRun` 路径：`agent_start`/`message_*`/`agent_end` + `run_status`）
- session 正在跑时抛 `ConflictError` → 由 `ws-chat` 转成 `error` 事件
- 前置不满足（非失败结尾）时抛 `ValidationError` → 转成 `error` 事件

`contracts/websocket.ts` 的 `chatClientMessage` 新增 `{ type: "retry" }` 变体；`parseChatClientMessage` 一并更新。`ws-chat.ts` 增加 `retry` 分支，调用 `attachment.retry()`。

> Source 1 重试不需要新服务端原语——客户端发现用户消息无 `_messageId` 时，走「重新发送用户消息」路径（等价于一次正常 `message` 发送，先把本地错误气泡移除）。

**补充韧性（独立于应用层重试）**：`LiveSession` 构建 streamFn options 时设 `maxRetries: 1`，让 provider SDK 透明重试一次瞬时 HTTP blip。

### 3. 客户端重试状态机（streaming store 核心）

#### 重试路径选择

重试触发时（自动或手动），store 检查「当前失败 turn 的用户消息」：
- **有 `_messageId`（Source 2）**：发 `retry` 消息（服务端 pop + continue）。本地仅对失败助手气泡做 `markRetrying`
- **无 `_messageId`（Source 1 / 发送失败）**：先从本地消息列表移除尾部「未确认用户消息 + 错误气泡」，再以原 content + attachments 调一次正常 `sendMessage`（追加一条新的乐观消息），避免重复

#### 自动重试（瞬时错误）

`StreamingSession` 新增 `retryCount: number`（默认 0）、`autoRetrying: boolean`（默认 false）。reducer 保持纯函数；编排由 store 在每批事件 apply 后做：

1. 事件批次 apply 后，store 检查最后一条消息：若有 `_errorCode === TRANSIENT` 且 `retryCount < MAX_AUTO_RETRY`（=2）：
   - 派发 `markRetrying` reducer action：清除该消息 `_error`/`_errorCode`、置 `_streaming: true`
   - `autoRetrying = true`、`retryCount++`、session `streaming = true`
   - 退避 `[2000, 5000]` ms（按 retryCount 取）后按「重试路径选择」触发重试
   - UI 显示「重新生成中…」（复用 ThinkingIndicator）
2. 成功（收到正常 `message_end` 完成）→ `retryCount` 归零、`autoRetrying = false`
3. 期间又得 TRANSIENT 且未超上限 → 回到步骤 1
4. `_errorCode` 为 `PERMANENT`/`MODEL_NOT_CONFIGURED`，或 `retryCount` 达上限 → 正常渲染错误气泡、`autoRetrying = false`，等待手动重试

新一次 user turn（`sendMessage` 成功发出）时 `retryCount` 归零。

> Source 1 错误的 `code` 恒为 `PERMANENT`/`MODEL_NOT_CONFIGURED`（config/pre-prompt），不会触发自动重试；只有 Source 2 的瞬时 LLM 错误会自动重试。

#### 手动重试（所有失败）

错误气泡上的「重试」按钮 → 重置 `retryCount = 0`（给手动重试一个全新的自动重试预算）→ `markRetrying` → 按「重试路径选择」触发。无论错误 code 是什么都可手动重试。

#### 发送失败防丢失（A1 / W6 / W16）

- `Composer.send()` 检查 `sendMessage` 返回值：
  - 返回 `true`（已发出）：维持现有行为（清空输入框 + 草稿）
  - 返回 `false`（socket 未就绪/正在 streaming）：仍追加乐观用户消息，但标记 `_sendFailed: true`，输入框照常清空（消息在列表里可见、可恢复）
- `ChatMessage` 新增 `_sendFailed?: boolean`
- 失败用户消息上的「重试」→ 以原 content + attachments 重新 `sendMessage`（属于「无 `_messageId`」路径）：
  - socket 仍断 → toast「连接已断开，请稍后重试」，消息保持 `_sendFailed`
  - socket 就绪 → 清除 `_sendFailed`，转为正常 `_optimistic` pending

### 4. 韧性增强

| 问题 | 修复 |
|---|---|
| **A2 断连不可见** | `Chat`（`index.tsx`）从 store 读 `connectionStatus`；为 `disconnected` 时在消息列表顶部渲染 `ConnectionBanner`（「连接已断开，正在重连…」） |
| **A3 历史卡死** | `chat-session-runtime.reconcileHistory` 失败时重试最多 3 次（退避 `[1s,2s,5s]`）；耗尽设置 session `historyError: true`，UI 显示「会话历史加载失败 · 重试」并提供点击重试（重新触发 reconcile） |
| **C1 无限重连** | 重连次数达到上限（=10）后停止自动重连；`connectionStatus` 保持 `disconnected` 并设 `reconnectFailed: true`；横幅文案切换为「连接失败 · 点击重连」+ 手动重连按钮（调用 `runtime.connect()` 并重置计数） |
| **B1 approval 丢失** | `respondApproval` 返回 boolean；`Chat` 调用处检查返回值，失败时 toast「操作未送达，连接可能已断开」并保持卡片 pending |
| **W2 onerror no-op** | `ChatSessionRuntime` 的 `onerror` 主动关闭当前 ws 并触发重连流程，避免最长 60s 的僵尸 socket 窗口 |

### 5. 数据模型 / UI / i18n

#### 数据模型

`ChatMessage`（`types.ts`）：
- 新增 `_sendFailed?: boolean`（用户消息发送失败标记；助手错误复用现有 `_error`/`_errorCode`）

`StreamingSession`（`streaming-store.ts`）：
- 新增 `retryCount: number`（默认 0）
- 新增 `autoRetrying: boolean`（默认 false）
- 新增 `historyError: boolean`（默认 false）
- 新增 `reconnectFailed: boolean`（默认 false）

reducer（`chat-session-reducer.ts`）：
- 新增 `markRetrying(messages)`：清除最后一条消息的 `_error`/`_errorCode`，置 `_streaming: true`

#### UI

- `ErrorMessageSection`：在错误信息区增加「重试」按钮（`onRetry` 回调，由 `MessageItem`/`Chat` 传入）。所有带 `_error` 的助手消息都显示
- `MessageItem`：对 `_sendFailed` 用户消息，在气泡下方渲染「发送失败 · 重试」条（`text-destructive` token）
- 新增 `ConnectionBanner` 组件（`features/chat/ConnectionBanner.tsx`）：根据 `connectionStatus`/`reconnectFailed` 渲染对应文案与按钮
- 重试中状态：复用 `ThinkingIndicator` + 「重新生成中…」文案
- 全部使用语义 token（`bg-card`/`text-destructive`/`border-border` 等），不硬编码颜色，不写 `dark:`，使用逻辑属性

#### i18n

新增文案（`packages/i18n/src/locales/zh-CN.ts` 为基准，带场景注释）：
- `chat.retry` / `chat.retryGenerating`（重试中）
- `chat.sendFailed` / `chat.sendFailedRetry`（发送失败 + 重试）
- `chat.connectionDisconnected` / `chat.connectionReconnecting` / `chat.connectionReconnectFailed` / `chat.connectionReconnect`
- `chat.historyLoadFailed` / `chat.historyLoadRetry`
- `chat.approvalNotDelivered`
- 同步 `zh-TW`、`en`

### 6. 测试

**core**：
- `classify-run-error` 单测：覆盖 `ModelNotConfiguredError`、各 status（400/401/403/404/429/500/502/503）、无 status 网络错误、不可判定默认

**server**：
- `ws-chat`：`message` 失败时 error 事件携带正确 `code`；`retry` 消息路由
- `ChatSessionHub.retryLastTurn` / `LiveSession.retryLastTurn`：正常 pop+continue、失败结尾才允许、running 时 `ConflictError`、非失败结尾 `ValidationError`
- session store：按 messageId 删除（事务性）

**app**：
- `classify-error`（`classifyErrorMessageString`）单测：覆盖 429/5xx/timeout/network → TRANSIENT、overflow/4xx → PERMANENT、默认 TRANSIENT
- reducer：`message_end` stopReason error 时 `_errorCode` 派生；`markRetrying`（error→streaming）；发送失败消息追加
- `ErrorMessageSection`：重试按钮渲染与回调
- `MessageItem`：`_sendFailed` 渲染「发送失败 · 重试」
- `Composer`：`sendMessage` 返回 false 时不清丢文本、追加 `_sendFailed` 消息
- streaming store：自动重试循环（mock runtime，断言退避/计数/markRetrying/耗尽落错误）、Source 2（发 `retry`）vs Source 1（重发消息）路径选择、新 turn 重置计数、手动重试重置预算
- `ConnectionBanner`：各 `connectionStatus`/`reconnectFailed` 可见性
- reconcile 历史重试 + `historyError`（mock fetch）

## 范围之外

- 不做成功回复的「重新生成」/消息编辑
- 不做服务端应用层 LLM 重试（重试逻辑全在客户端 streaming store）
- 不改 WS 鉴权（token query param）等既有安全项
- 不做未持久化 transient 错误的跨重载保留（仅服务端 `stopReason:"error"` 的助手消息可从历史恢复，维持现状）

## 实现偏差（相对本 spec）

- **Source 1/2 区分：`_messageId` → `_turnError`**。spec 原用「用户消息有无 `_messageId`」判断，但实现发现活的消息永远不会拿到 `_messageId`（reducer 的 `message_end` 只处理 assistant 消息，`_messageId` 仅由历史对账赋值），导致正常 LLM 失败被误判为 Source 1 → 重发 → 服务端重复用户消息。改用 `_turnError` 标记：`message_end`(error) 与「error 事件落到 streaming 气泡」置 true（Source 2），error 事件新建空气泡不置（Source 1）。
- **`classify-run-error.ts` 位置：`@spherse/core` → `@spherse/server`**。它返回 `ErrorEventCode`（server contract 类型），core 不应依赖 server，故放入 server 层。spec 的「core」表述是笔误。
- **`ConflictError`/`ValidationError` → `PERMANENT`**。`classifyRunError` 默认无 status 错误为 TRANSIENT，但这两类是永久状态（已 running / 无失败轮次），显式判为 PERMANENT，避免误触发自动重试。
- **自动重试状态机修正**：`autoRetrying` 仅由 `maybeAutoRetry` 的退避窗口持有（schedule 时置 true、fire 时清 false），`executeRetry` 不再设置它（`streaming` 已防 run 重入）；resend 路径经 `sendMessage({isRetry})` 不重置 `retryCount`，避免瞬时 Source 1 错误无限重试。
- **i18n `chat.retryGenerating` 未使用**：spec 列了该 key，实现中复用 ThinkingIndicator 未单独显示「重新生成中」文案，key 已移除。
