# Chat 前端运行时重构实施计划

对应 [design.md](./design.md)。单 PR 一次到位，按阶段推进，每阶段测试全绿再进入下一阶段。

## Stage 1：model（不接线）

- [x] `model/entry.ts`：ChatEntry 类型 + 身份生成/upsert 规则
- [x] `model/message-group.ts`：assembleGroups + ToolItem 组装 + 卡片投影状态机 + 组装期派生（runChanges / superseded / withdrawable / retry / pendingControls）
- [x] `model/entry-reducer.ts`：reduceLiveEvents（开窗/收窗、owner 跟踪、pendingWithdraw 结算、withdraw 截断、retry 复用）
- [x] `model/history-entries.ts`：page 解析（owner 配对）、applyHistoryPage（latest/loadMore 模式）、settleOptimistic
- [x] 测试：组装器 property test（覆盖/无重复/无孤儿/稳定 key）、reducer live+history 交错与两个断线场景、tool owner 顺序、卡片三路径一致性
- [x] 旧 model 保持可运行，新 model 独立测试通过

## Stage 2：L1

- [x] `lib/ws/ws-connection.ts` 增加 `shouldRetry?: () => boolean`（默认 true）
- [x] 单测：false 时 close 不排重试；bus 不传行为不变

## Stage 3：runtime 拆分与 store 接线

- [x] `runtime/decode.ts`：无损保留 messageId/seq（v2 事件类型仍 ignored）+ 测试
- [x] `runtime/event-queue.ts`：rAF + setTimeout 兜底 + cancel
- [x] `runtime/session-link.ts`：WsConnection 装配、出站控制、fatal codes {4400,4401,4402}、`shouldRetry = isAttached`
- [x] `runtime/session-recovery.ts`：HTTP 对账平移（缓冲/退避/historyError/cancel 打断）
- [x] `runtime/history-loader.ts`：首页/loadMore/refresh（generation guard）
- [x] `runtime/outbound-actions.ts`：send/retry/withdraw/abort/approval/question
- [x] `runtime/session-lifecycle.ts`：引用计数、TTL timer、disconnectProject、initialMessage
- [x] `runtime/session-store.ts`：状态 + actions 组合 + `useSessionStreaming` 窄 hook
- [x] 测试：recovery / queue / lifecycle / link / outbound-actions 分模块

## Stage 4：消费方与组件

- [x] `hooks/useChatSession.ts` + `useChatGroups`
- [x] `MessageList` 接收 groups、稳定 key
- [x] `MessageItem` 拆 UserBubble / AssistantBubble / ToolItemView / ErrorBubble
- [x] `TriggerTurnGroup` 消费 MessageGroup
- [x] `ConnectionBanner` 消费 WsConnectionState
- [x] `useChatScroll` 选择器化
- [x] `ApprovalNoticeBridge` / `TriggerEventBridge` / `project-lifecycle` / `web-resume-probe` / `ui-sdk/send-message` / `SessionRow` 切换
- [x] 组件测试 + 消费方测试迁移

## Stage 5：清理

- [x] 删除 `chat-session-runtime.ts` / `chat-runtime-registry.ts` / `streaming-store.ts` 及测试
- [x] 删除被取代的 model 文件与测试，保留仍复用的投影工具
- [x] `project-data-store` 删 `streamingSessionIds` / `setStreaming`
- [x] `rg` 清点无旧导出残留

## Stage 6：验证与文档

- [x] `npm run verify`
- [x] 受影响 E2E：`chat-streaming-resilience` / `chat-retry` / `chat-withdraw` / `floating-chat` / `ui-sdk`
- [x] doc-sync：按 design §13 清单更新 official docs / app README / 09-05 plan / backlog
