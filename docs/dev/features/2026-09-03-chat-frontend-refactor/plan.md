# Chat 前端重构实施计划

对应 design.md。实现顺序：model 层（纯函数，先行 + 测试）→ runtime 层 → hooks/组件层 → 测试迁移 → 验收。

## 任务

- [x] 1. `types.ts`：新 slice 类型（HistoryState/RunState/AssistantSegment/OutboxEntry/InteractionState/ChatSessionData/RenderItem）+ 瘦身 ChatMessage + `isSessionStreaming`（含 `seq` 共享计数器：outbox 条目与 run 按 seq 排序渲染）
- [x] 2. `model/history.ts`：`parseHistoryMessages` 瘦身（去 merge/卡片/runChanges，toolResult details 存入 ToolCallInfo）+ 页归并/前插 + `consumeOutbox`（仅最新页拉取调用）
- [x] 3. `model/tool-card.ts`：统一投影 `projectChatCard`（合并 chat-tool-projection 与 reducer 内卡片分支）；删除 `chat-tool-projection.ts`
- [x] 4. `model/session-events.ts`：事件归约（事件表全量：settle 规则、turnError 分流、toolCall run 内全量检索、interactions（含 kind 校验）、run_status/agent_end/error/abort/fatal、turn_withdrawn 跨 slice 截断）+ `applyHistoryResult`/`applyRetryLast`/`truncateForResend`/`applyAbort`/`applyFatalClose`/history 状态 helpers。run-reducer 并入 session-events（规模不需要拆两文件）
- [x] 5. `model/render-list.ts`：`buildRenderList`（history user 边界 + run 边界 runChanges、卡片投影、稳定 key、sendFailed/withdrawError meta）
- [x] 6. model 适配：`turn-groups` / `withdrawable` / `retry-plan`（去 dropCount，签名 `(items, session)`）/ `html-card-dedup` / `approval-notice`（改读 interactions）
- [x] 7. `runtime/streaming-store.ts`：session shape 换新、`isSessionStreaming` 统一守卫、模块级 subscribe 派生单点同步、executeRetry（retry-last 剥离 error 并复用激活 run）/sendMessage/loadMore（不消费 outbox）/refreshHistory（保留 streaming 双重门槛）/cleanupExpired 适配
- [x] 8. `runtime/chat-session-runtime.ts`：reconcile 改为 applyHistoryResult("reconcile") + 重放 buffered、fatal close applyFatalClose、删 setStreaming 回调。连接/心跳/重连/退避原样
- [x] 9. hooks/组件：`useChatSession`（render list memo + isSessionStreaming）、`MessageList`（RenderItem 消费）、`MessageItem` 拆分（UserMessageBody/AssistantMessageBody/CardRenderer/useChatLinkHandler，DOM 属性原样）、`chat-actions-context`、`ApprovalNoticeBridge` 改读 interactions、`ui-sdk/handlers/send-message.ts` 改 isSessionStreaming
- [x] 10. 测试迁移与新增：`session-events.test.ts`（52 用例，旧 reducer 语义迁移 + 新规则）、`history.test.ts`（23）、`render-list.test.ts`（10）、`tool-card.test.ts`（16）、`streaming-store.test.ts`（34 断言迁移）、withdrawable/turn-groups/retry-plan/html-card-dedup/approval-notice/MessageItem/project-lifecycle/ui-sdk send-message 适配
- [x] 11. 验收：`npm run verify` ✅；E2E chat-streaming-resilience + chat-retry + chat-withdraw + floating-chat（18/18）+ ui-sdk-html-card（2/2）✅

## 验收状态

- `npm run verify`：通过（lint 0 errors，新增 1 个 react-refresh warning 与仓库既有 context 文件 pattern 一致）
- app 包单测：1011/1011
- chat E2E 选型 4 条 + ui-sdk-html-card：全部通过

## 实现中的设计偏差记录

1. `applyRetryLast` 未按 design 原文"删除尾部 error run"，而是**剥离 error segment 并复用激活该 run**（对齐现状 `markRetrying` 语义：server retryLastTurn 只 abandon 最后一条失败 assistant 消息，早前 segment 保留；复用 run id 保证 key 稳定）；history 宿主的 error 则做尾部截断（sanctioned，server 同步 abandon）
2. `applyHistoryResult` loadMore 模式**保留 active run**（design 原文写三条路径一致丢弃 active run——loadMore 无重放跟随，丢弃会丢内容；旧页与 active run 无重叠，保留是安全的）
3. error 事件先于 message_end 到达时，新实现原地终结 segment（旧实现会追加第二条消息）——记为有意改进
