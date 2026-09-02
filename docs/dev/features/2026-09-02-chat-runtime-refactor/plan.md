# Chat runtime 重构实施计划

设计：[design.md](./design.md)

- [x] 1. `model/chat-session-reducer.ts`：新增 `settlePendingWithdraw` / `applySessionEvents`（含 `flagWithdrawError` 私有化）
- [x] 2. 新建 `runtime/history-reconciler.ts`（reconcile 状态机逐字移植，含 `applyClosedState`）
- [x] 3. 新建 `runtime/history-actions.ts`（`loadMoreHistory` / `refreshSessionHistory` + port 接口）
- [x] 4. 重写 `chat-session-runtime.ts`：connect 接 reconciler、`armProbeTimeout`、`sendPayload`
- [x] 5. 精简 `streaming-store.ts`：管线去重（`applyEventsAndNotify`）、history 委托、删 re-export
- [x] 6. 测试：reducer 纯函数用例（7）、history-reconciler 套件（9）、history-actions 套件（6）、streaming-store #4 专项（2）
- [x] 7. 验证：lint（0 error）+ typecheck 通过 + `npm test --workspace=packages/app` 1006 用例全绿（存量 34 个 streaming-store 用例原样通过）
- [ ] 8. commit + code-review + doc-sync + PR
