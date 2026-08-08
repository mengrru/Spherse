# 实施计划

按依赖顺序分阶段实施。每阶段完成后跑对应 workspace 的 lint/test。

## Phase 1 — 服务端契约 + core 分类 + retry 原语

1. `contracts/websocket.ts`：`ErrorEventCode` 改为 `ModelNotConfigured | Permanent | Transient`；`chatClientMessage` 新增 `{ type: "retry" }` 变体；更新 `parseChatClientMessage`
2. `core/classify-run-error.ts`：`classifyRunError(err)` + 单测
3. `core/store/session.ts`：新增 `deleteMessage(sessionId, messageId)`（事务内 + 更新 updated_at）
4. `core/session/live-session.ts`：`retryLastTurn()`（pop 失败助手消息 + deleteMessage + `agent.continue()`）；streamFn options 设 `maxRetries: 1`
5. `server/chat-session-hub.ts`：`retryLastTurn()`（走 `startRun` 路径，ConflictError/ValidationError 语义）
6. `server/ws-chat.ts`：`message` 失败时用 `classifyRunError` 填 code；新增 `retry` 分支

## Phase 2 — 客户端分类 + 数据模型 + reducer

7. `app/features/chat/model/classify-error.ts`：`classifyErrorMessageString` + 单测
8. `app/features/chat/types.ts`：`ChatMessage` 增 `_sendFailed?`
9. `app/features/chat/model/chat-session-reducer.ts`：`message_end`(error) 派生 `_errorCode`；新增 `markRetrying`
10. `app/features/chat/model/chat-history.ts`：`parseHistoryMessages` 失败消息派生 `_errorCode`
11. `app/features/chat/runtime/streaming-store.ts`：`StreamingSession` 增 `retryCount/autoRetrying/historyError/reconnectFailed`

## Phase 3 — 客户端重试状态机

12. `chat-session-runtime.ts`：`retry()` 方法（发 `{type:"retry"}`）；`reconnect()` 手动重连入口
13. `streaming-store.ts`：重试编排（路径选择、自动重试 post-batch、手动重试）、`sendMessage` 失败追加 `_sendFailed` 消息

## Phase 4 — 韧性修复

14. `chat-session-runtime.ts`：`reconcileHistory` 重试 + `historyError`；重连上限 + `reconnectFailed`；`onerror` 触发 close
15. `streaming-store.ts`：`respondApproval` 返回 boolean
16. `index.tsx`：approval 返回值检查 + toast

## Phase 5 — UI

17. `ErrorMessageSection.tsx`：重试按钮
18. `MessageItem.tsx`：`_sendFailed` 渲染「发送失败·重试」
19. `ConnectionBanner.tsx`：新组件
20. `index.tsx`：接 connectionStatus/retry 回调
21. `Composer.tsx`：send 返回值检查

## Phase 6 — i18n

22. `zh-CN.ts`（基准）+ `zh-TW.ts` + `en.ts`：新增重试/断连/历史失败文案

## Phase 7 — 验证

23. `npm run lint`、`npm run build`、各 workspace 测试、i18n check
