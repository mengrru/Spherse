# Chat 前端自动重试误重放历史 error turn 的分析与修复

## 现象

- 打开会话、history 载入后，若最后一个 turn 状态为 error，前端会自动发起重试（肉眼可见旧错误气泡转为 streaming，服务端开始重跑）。
- 即时返回 error 时，前端自动重试两次（2s / 5s backoff）。

## 排查结论

自动重试机制（`shouldAutoRetry` + `maybeAutoRetry`，budget = 2）存在三处叠加缺陷：

1. **水化的历史 error 与 live error 无法区分**：`parseHistoryMessages`（`packages/app/src/features/chat/model/chat-history.ts`）给持久化 `stopReason === "error"` 的消息打上 `_error/_errorCode/_turnError`，而 `classifyErrorMessageString` 的 fallback 是 TRANSIENT——任何无法识别的错误串（含 "Unknown error"）都被视为可自动重试。
2. **触发条件与事件内容无关**：`flushQueuedEvents` 对每个有排队事件的 session **无条件**调用 `maybeAutoRetry`。服务端 attach 后必然补发 `run_status`（`chat-session-hub.ts`）；客户端 `reconcilingHistory` 在 history fetch 完成后即复位，若该事件晚于 fetch 到达（channel 恢复慢于 HTTP 拉取），就会进入 enqueue 路径触发 `maybeAutoRetry`，对着刚水化的陈年 error turn 判定通过。reconcile 失败路径（`applyEvents` 回调）同样触发。
3. **`retryCount` 是纯前端状态**：新开 session 恒为 0，也不持久化，5 分钟 TTL 清理后归零——每次打开会话都重新获得完整的 2 次重试预算。

次要问题：`maybeAutoRetry` 的 setTimeout 里先清 `autoRetrying` 再 `executeRetry`，后者早退时不消耗预算；`mergeHistoryMessages` 把本地 transient error 气泡追加在持久化消息之后，旧错误气泡可能占据「末条」劫持重试判定。

## 修复方案（与用户商定）

**整体移除前端自动重试**，仅保留手动 retry。理由：agent turn 的自动重试代价高（token + 副作用工具会重复执行），错误串 regex 分类脆弱，且 UI 已有手动 retry 按钮；三个缺陷同源于「自动重试的触发与预算难以做对」，移除即整类消除。

- `retry-plan.ts`：删 `shouldAutoRetry`/`MAX_AUTO_RETRY`/`isAuto` 参数，`planRetry` 只保留手动语义（`_withdrawError` → none、`_turnError` → retry-last、Source-1 error → resend、`_sendFailed` → resend）。
- `streaming-store.ts`：删 `maybeAutoRetry`、backoff 表、`retryCount`/`autoRetrying` 状态、`flushQueuedEvents`/`applyEvents` 两处触发点；`sendMessage` 移除无用的 `isRetry` opts。
- `_errorCode` 保留用于错误展示分类（`ErrorMessageSection`）。
- 服务端 `retryLastTurn`（WS `retry`）契约不变，仍由手动按钮触发。

残余风险（backlog 已有对应条目）：TRANSIENT 误分类仍影响错误展示与手动重试诱导；手动 retry-last 会重新执行副作用工具。

## 影响面

- app：`features/chat/model/retry-plan.ts`、`runtime/streaming-store.ts`、`hooks/useChatSession.ts`
- desktop：`e2e/chat-retry.spec.ts`（删除 auto-retry 用例，手动重试用例保留）
- 文档：`docs/official/architecture/chat.md`、`docs/dev/backlog.md` 同步

## 验证

- `npm test --workspace=packages/app`：115 文件 / 1007 测试全过（含新增「无自动重试」「手动 retry-last 编排」用例）
- `npm run typecheck --workspace=packages/app`、`npm run lint --workspace=packages/app`：通过
- `npm run test:e2e --workspace=packages/desktop -- e2e/chat-retry.spec.ts`：2 用例通过
