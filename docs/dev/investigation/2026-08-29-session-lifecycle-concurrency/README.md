# Session 生命周期与并发闭环调研

调研时间：2026-08-29

## 结论

报告属实，两项都需要修复，但应拆成两个边界不同的改动：

1. `AgentRunner` 的 in-flight guard 存在真实且可达的 check-then-set 竞态。它违反 core 已声明的“同一 session 并发 turn 必须 fail-fast”安全不变量，可能持久化未实际执行的 turn，并让后续请求在已有 turn 仍运行时再次越过 guard。该项应作为局部高优先级 bugfix 独立修复，但只解决单个 Runner 内的原子占用；同一物理 session 的并发 restore 仍需在生命周期改造中收口。
2. session 删除、agent 删除和 project shutdown 当前只移除 runner 引用，没有 abort 并等待完整 turn。删除成功后仍可能继续执行工具和落库；agent 删除或 project shutdown 还可能让仍运行的 turn 写入已关闭的 SQLite。该项同样需要修复，但正确闭环涉及 Runner 所有权、SessionManager admission、trigger 后台任务和 server hub 生命周期，不能只补一行 `abort()`。

第一项可做最小修复。第二项在实现前应先形成 lifecycle design，明确“停止接收新工作 -> abort -> drain -> 释放 capability -> 关闭 store”的顺序和跨层契约。

## 1. AgentRunner in-flight 竞态

### 现状

`sendMessage` 在 `packages/core/src/session/agent-runner.ts:119` 检查 `inFlight`，到 `:157` 才设置为 `true`。两者之间存在多个异步边界：

- pending reload：`:120-123`
- `beforeTurn`：`:126`
- attachment preprocessing：`:130-135`

即使没有 capability hook 和附件，竞态仍可达：`composeTurnHooks` 总是返回 async `beforeTurn`（`packages/core/src/kernel/turn-hooks.ts:17-25`），`prepareAttachmentUserMessage` 也始终是 async 函数（`packages/core/src/attachments/index.ts:25-49`）。两个同一 tick 发起的 `sendMessage` 可以先后通过检查，再在第一个 `await` 处让出执行权。

`retryLastTurn` 的普通路径在检查和设置之间没有必经 await，但 pending reload 会引入异步窗口；它也可以在一个尚处于 preflight 的 `sendMessage` 之后进入。因此并发不只发生在 `sendMessage` 与自身之间。

### 具体后果

一个可达的交错顺序是：

1. A、B 都在 `inFlight === false` 时通过检查。
2. A 先追加 `user/message + turn/start`，订阅事件并启动 `agent.prompt()`。
3. B 随后也追加自己的 `user/message + turn/start`，再调用同一个 agent。
4. pi-agent-core 的 `activeRun` guard 拒绝 B，但拒绝发生在 Runner 已经修改 event log、control sink 和订阅关系之后。
5. B 的 `finally` 把 `inFlight` 清为 `false`，即使 A 仍在运行，第三个请求可再次进入。

pi-agent-core 自身的 guard（`node_modules/@earendil-works/pi-agent-core/dist/agent.js:226-255,326-347`）只能阻止两个 provider loop 同时运行，不能回滚 Runner 在调用 agent 前完成的共享状态变更。

主要风险：

- event log 可出现 `user A, turn/start, user B, turn/start, assistant A, turn/end`。B 没有执行但已成为 durable fact。
- 第二个订阅者可能短暂接收并重复处理第一个 run 的事件。
- session 级单一 control sink 可能被错误调用覆盖和恢复。
- retry 竞争者会先追加 `turn/retried`、废弃旧 assistant 并重建 agent buffer，破坏性高于普通 send。
- 错误调用清空 boolean 后，后续调用可进入正在运行的 turn 或 after-turn hook。

正常 UI/WS 路径由 `ChatSessionHub.startRun` 在 `packages/server/src/chat-session-hub.ts:197-217` 做了同步 check-and-set，因此主要聊天入口通常先被 hub 拦截。但 core 的 `SessionManager` 和 `SessionPort` 没有外层串行化，trigger 只按 trigger ID 去重，不按 session 去重（`packages/core/src/trigger/executor.ts:33-58`）。两个 trigger 或 trigger 与 chat 指向同一 session 时可以到达该竞态。core guard 本身也是 `packages/core/README.md:73` 明确规定的安全不变量，不能依赖 server guard 保证。

另有一个相邻但不属于本 check-then-set 报告的缺口：`restoreSession` 只在 await init 前检查一次 map（`packages/core/src/session/session-manager.ts:52-58`）。并发 restore 可以创建两个指向同一 event log 的 Runner，并由后完成者覆盖 map。局部 in-flight guard 不能跨 Runner 互斥；该路径应由 Lifecycle B 的 restore single-flight 和 admission 规则解决。

### 修复建议

在 `ensureNotBusy()` 后同步取得 turn 所有权，并用覆盖整个操作的外层 `try/finally` 释放：

```ts
this.ensureNotBusy();
this.inFlight = true;
try {
  // reload、validation、hooks、附件预处理、持久化、订阅、agent run、after-turn
} finally {
  this.inFlight = false;
}
```

不能只把现有赋值上移而保留当前 `try` 位置，否则 model resolution、hook、附件预处理或 event append 抛错后会永久卡住 runner。订阅、sanitizer 和 control sink 应使用可选局部资源做分层 cleanup，保证部分初始化失败时仍能恢复所有权。

建议回归测试：

- 延迟第一个 `beforeTurn`，并发发起第二个 send；第二个在写 event log 前抛 busy error。
- preflight 抛错后，下一次 send 可以正常取得所有权。
- pending reload 下 retry 与 send/retry 并发，竞争者不追加任何事件。
- send preflight 与 retry 并发，retry 不得提前废弃现有失败 turn。

## 2. 删除和关闭未 abort/drain

### 现状

- `SessionManager.destroySession` 仅执行 `Map.delete`（`packages/core/src/session/session-manager.ts:126-128`）。
- `SessionManager.evictAgent` 仅删除匹配的 map entry（`:140-146`）。
- `SessionManager.closeAll` 仅执行 `Map.clear`（`:148-150`）。
- `ProjectRuntime.deleteSession` 随后立即归档 session（`packages/core/src/project-runtime.ts:53-56`）。
- `ProjectRuntime.deleteAgent` 随后运行 capability cleanup，并关闭、删除 agent store（`:58-68`，`packages/core/src/store/project.ts:214-223`）。
- `ProjectRuntime.shutdown` 在清空 map 后关闭 capabilities 和 project stores（`packages/core/src/project-runtime.ts:96-105`）。

移除 map entry 不会释放 runner。调用中的 `sendMessage` Promise、pi agent active run 和 hub channel 仍持有 runner，并继续执行 `agent.prompt`、event middleware、after-turn hook 和 cleanup。

### 具体后果

#### 删除 session

session archive 只更新 `sessions.status`，`appendEvents` 不检查该状态（`packages/core/src/store/session.ts:207-238`）。因此删除接口返回成功后，原 turn 仍可：

- 继续执行具有文件或命令副作用的工具；
- 向已归档 session 追加 assistant/tool/turn-end 事件；
- 更新已归档 session 的 `updated_at`。

HTTP 静默发送会在后台继续 run（`packages/server/src/routes/sessions.ts:105-125`，`packages/server/src/chat-session-hub.ts:124-157`），随后立刻调用 DELETE 即可到达该交错。

#### 删除 agent / project shutdown

这两个路径会关闭 `SessionStore`。仍运行的 `SessionEventLog` 保留旧 store 引用，下一次 `message_end`、`toolResult` 或 `agent_end` 会通过 `packages/core/src/session/agent-runner.ts:404-435` 写入已关闭数据库。工具副作用也可能发生在删除/关闭成功之后。

单独调用 `agent.abort()` 仍不构成闭环。abort 只是发送信号；删除和 shutdown 必须等待 turn settle。pi agent 的 `waitForIdle()` 会等到 `agent_end` listeners 完成，但 Runner 在 `agent.prompt()` 之后还会执行 `applyAfterTurnHooks()` 和本地 cleanup（`packages/core/src/session/agent-runner.ts:159-170`），因此正确等待对象应是完整 Runner turn Promise，而不只是底层 agent idle Promise。

### 报告之外但同一闭环必须处理的入口

- `createSession` / `restoreSession` 在 async init 后才写入 map（`packages/core/src/session/session-manager.ts:41-58`）。shutdown 若只 drain 当前 map，pending init 可在 `closeAll` 后重新插入 runner。SessionManager 需要 closing admission 状态和对 pending initialization 的所有权。
- trigger fire 是 detached Promise（`packages/core/src/trigger/trigger-manager.ts:43-48,73-84,156-166`），`stopAll` 只清空 `inProgress` 集合，不 abort/await fire（`:151-153`）。它可能在 shutdown 中继续 restore/create/send。
- `ChatSessionHub` 持有 `SessionManager` 的直接引用和独立 running 状态。project registry remove 只 await runtime shutdown（`packages/server/src/registry.ts:159-165`），没有关闭 project 对应 channel；旧 channel 可继续引用已关闭 runtime。
- `ProjectRuntime._shutdownDone` 是提前设置的 boolean。并发 shutdown 的第二个调用会在第一个仍执行时提前返回；中途 capability cleanup 抛错后也无法重试剩余 cleanup。应改为所有调用者共享同一 shutdown Promise。

这些不是拒绝修复的理由，而是说明“在三个 Map 操作前调用 abort”不足以兑现关闭语义。

## 3. 推荐实施边界

### Bugfix A：Runner 原子 fail-fast guard

范围限于 `AgentRunner` 与直接单测：

- 在任何 await 和共享状态变更前取得所有权。
- 全路径 exception-safe 释放。
- 不引入队列、优先级、run source 或 server run-state 下沉。
- 明确该项恢复的是单个 Runner 的 fail-fast，不替代同一物理 session 的 restore single-flight。

这与 `docs/dev/backlog.md` 中“run-state 下沉 core”不是同一事项。当前只修安全不变量，完整调度模型仍按 backlog 的条件触发规则保留。

### Lifecycle B：abort-and-drain 设计与实现

实现前先确定以下契约：

1. `AgentRunner.close()`：同步进入 closed 状态，拒绝新 turn，reject control requests，abort 当前 agent，并 await 完整 Runner turn Promise。close 若发生在 `prompt/continue` 前的 preflight，底层 agent 尚无 active run，`agent.abort()` 无效，因此还需 Runner 级取消状态或进入 agent 前的 closed 重检，保证被接纳但尚未启动的 turn 不会在 close 后继续启动。
2. `SessionManager`：`destroySession`、`evictAgent`、`closeAll` 改为 async drain；先关闭对应 admission，再处理 active runner 和 pending init。restore 按 session single-flight，restore 完成写入 map 前重检 admission 和 session active 状态，避免并发创建多个 Runner 或删除期间把 archived session 重新装回 map。
3. `ProjectRuntime`：删除或 shutdown 必须先 quiesce producer，再 drain runner，随后 shutdown capability，最后关闭 store；并发调用共享 lifecycle Promise。
4. trigger：停止新 dispatch，并拥有、等待已发出的 fire Promise。
5. server hub：提供 project/agent/session 级关闭入口，阻止 pending restore 或旧 channel 在 session、agent 或 runtime 关闭后继续使用它。

建议的全局顺序：

```text
stop admission/producers
-> abort active work
-> await full turns and pending initialization/background tasks
-> release capability resources
-> close persistence
```

验收不变量：删除或 shutdown Promise resolve 后，不再有该 scope 的工具副作用、event append、store access 或新 runner 插入。

## 4. 现有测试缺口

当前 destructive `SessionManager` lifecycle 测试只验证 map 状态：

- `packages/core/src/__tests__/session/session-manager.test.ts:424-429`
- `packages/core/src/__tests__/session/session-manager.test.ts:483-493`
- `packages/core/src/__tests__/session/session-manager.test.ts:536-545`

`closeAll` 测试未 await 声明为 async 的方法；当前实现内部没有 await，因此现有断言仍能观察同步 clear，但引入真实 drain 后该测试必须等待完成。`AgentRunner` 的 busy 测试只手工设置私有 boolean 后测试 withdraw（`packages/core/src/__tests__/session/agent-runner.test.ts:765-775`），没有启动两个真实操作。

生命周期修复至少需要覆盖：

- pending turn + deleteSession：观察 abort，且删除 Promise 在 turn cleanup 前不 resolve。
- pending turn + deleteAgent/shutdown：store close 前已 drain，不产生 late write。
- pending after-turn hook + shutdown：等待 hook 和 event append 完成。
- pending create/restore + shutdown：关闭后不插入 runner。
- concurrent restore：同一物理 session 只创建并安装一个 runner，archived session 不可被 pending restore 复活。
- pending trigger fire + shutdown：不重入 session runtime。
- detached HTTP run + session/project 删除：hub channel 与 runtime 同步收口。
- 并发 shutdown：所有调用者等待同一个 Promise。

## 决策

- 报告第一项：**属实，需要立即 fix，适合独立小 PR。**
- 报告第二项：**属实，需要 fix，风险高于原报告文字所表达的“Map 未清理资源”；应先做跨层 lifecycle design，再实施，不能以单点 abort 作为完成标准。**
