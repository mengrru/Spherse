# 实施计划

## 变更清单

1. `packages/core/src/session/session-manager.ts`
   - `sessionExists`：`getSession` 结果要求 `status === "active"` 才视为存在。这是核心修复——归档绑定在下一次触发时惰性治愈（新建会话 + 重新绑定），不需要删除会话时显式解绑。
2. `packages/core/src/trigger/executor.ts`
   - `existing_session` 分支：restore 前用 `sessionExists` 校验目标，失效抛错（failed log + `trigger_failed`）。
   - `emit("trigger_triggered")` 移入 try 块，listener 抛错走 failed 路径并保证 `inProgress` 清理。
   - 新增 `readTurnError`：从 `agent_end` 事件的 `messages` 中取最后一条 assistant 消息，`stopReason` 为 `error` / `aborted` 时返回错误描述。
   - `sendMessage` 完成后：有 turnError 则 throw（进 catch 记 failed + `trigger_failed`）；否则仅在实际收到 `agent_end` 时记 success。

## 测试

- `executor.test.ts`：error / aborted stopReason → failed log（含 sessionId）+ `trigger_failed`、无 `trigger_completed`；`trigger_triggered` listener 抛错 → 不卡 `inProgress`、记 failed；existing_session 目标失效 → 不 restore / 不 create / 不 send、failed log。
- `trigger-manager.test.ts`：真 SessionManager + 真 SQLite 集成用例——`reusable_session` 绑定真实会话 → 删除（绑定保留在磁盘）→ 触发后自动新建并重绑；`existing_session` 目标真实会话正常 restore、目标删除后触发记 failed 且不 send。
- `session-manager.test.ts`：归档 + runner 销毁后 `sessionExists` 返回 false。

## 验证

- `npm test --workspace=packages/core`：全过
- `npm test --workspace=packages/server`：全过
- `npm run lint`：0 error

## 线上数据修复说明

已产生僵尸绑定的存量 trigger 无需手工修复：`sessionExists` 修复后，绑定指向归档会话的 trigger 下次触发时会自动新建会话并重新绑定。
