# Chat 前端运行时重构实施计划

对应 [design.md](./design.md)。单 PR 一次到位，按阶段推进，每阶段测试全绿再进入下一阶段。

## Stage 1：model（不接线）

- [ ] `model/entry.ts`：ChatEntry 类型 + 身份生成/upsert 规则
- [ ] `model/message-group.ts`：assembleGroups + ToolItem 组装 + 卡片投影状态机 + 组装期派生（runChanges / superseded / withdrawable / retry / pendingControls）
- [ ] `model/entry-reducer.ts`：reduceLiveEvents（开窗/收窗、owner 跟踪、pendingWithdraw 结算、withdraw 截断、retry 复用）
- [ ] `model/history-entries.ts`：page 解析（owner 配对）、applyHistoryPage（latest/loadMore 模式）、settleOptimistic
- [ ] 测试：组装器 property test（覆盖/无重复/无孤儿/稳定 key）、reducer live+history 交错与两个断线场景、tool owner 顺序、卡片三路径一致性
- [ ] 旧 model 保持可运行，新 model 独立测试通过

## Stage 2：L1

- [ ] `lib/ws/ws-connection.ts` 增加 `shouldRetry?: () => boolean`（默认 true）
- [ ] 单测：false 时 close 不排重试；bus 不传行为不变

## Stage 3：runtime 拆分与 store 接线

- [ ] `runtime/decode.ts`：无损保留 messageId/seq（v2 事件类型仍 ignored）+ 测试
- [ ] `runtime/event-queue.ts`：rAF + setTimeout 兜底 + cancel
- [ ] `runtime/session-link.ts`：WsConnection 装配、出站控制、fatal codes {4400,4401,4402}、`shouldRetry = isAttached`
- [ ] `runtime/session-recovery.ts`：HTTP 对账平移（缓冲/退避/historyError/cancel 打断）
- [ ] `runtime/history-loader.ts`：首页/loadMore/refresh（generation guard）
- [ ] `runtime/outbound-actions.ts`：send/retry/withdraw/abort/approval/question
- [ ] `runtime/session-lifecycle.ts`：引用计数、TTL timer、disconnectProject、initialMessage
- [ ] `runtime/session-store.ts`：状态 + actions 组合 + `useSessionStreaming` 窄 hook
- [ ] 测试：recovery / queue / lifecycle / link / outbound-actions 分模块

## Stage 4：消费方与组件

- [ ] `hooks/useChatSession.ts` + `useChatGroups`
- [ ] `MessageList` 接收 groups、稳定 key
- [ ] `MessageItem` 拆 UserBubble / AssistantBubble / ToolItemView / ErrorBubble
- [ ] `TriggerTurnGroup` 消费 MessageGroup
- [ ] `ConnectionBanner` 消费 WsConnectionState
- [ ] `useChatScroll` 选择器化
- [ ] `ApprovalNoticeBridge` / `TriggerEventBridge` / `project-lifecycle` / `web-resume-probe` / `ui-sdk/send-message` / `SessionRow` 切换
- [ ] 组件测试 + 消费方测试迁移

## Stage 5：清理

- [ ] 删除 `chat-session-runtime.ts` / `chat-runtime-registry.ts` / `streaming-store.ts` 及测试
- [ ] 删除被取代的 model 文件与测试，保留仍复用的投影工具
- [ ] `project-data-store` 删 `streamingSessionIds` / `setStreaming`
- [ ] `rg` 清点无旧导出残留

## Stage 6：验证与文档

- [ ] `npm run verify`
- [ ] 受影响 E2E：`chat-streaming-resilience` / `chat-retry` / `chat-withdraw` / `floating-chat` / `ui-sdk`
- [ ] doc-sync：按 design §13 清单更新 official docs / app README / 09-05 plan / backlog
