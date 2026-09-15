# Chat Hub 生命周期收口实施计划

design 见同目录 `design.md`。按任务顺序实现，完成即勾选。

## Phase 1：core seam

- [x] `AgentRunner.isBusy(): boolean`（返回 `inFlight`）+ 单测
- [x] `SessionManager.releaseSession(sessionId): boolean`（无 runner / busy → false；idle → 删除并返回 true）+ 单测
- [x] `SessionManager.restoreSession` admission 重检：store-closed-safe → `NotFoundError`；状态检查先于 migration；`initForRestore` 后与 `sessions.set` 同步重检 + 单测（archived 拒绝、init 期间 delete、store 已关闭）

## Phase 2：server chat 域

- [x] `errors.ts`：`RuntimeClosedError`(404) / `ChannelClosedError`(409)
- [x] `chat-channel.ts`：状态机（opening/open/closed）、lazy `ensureReady` 单飞、lease、`close(reason)` 后置条件、await 后继重检、`releaseSession` 替换 `destroySession`、结构化日志、attachment `ready: Promise<void>` 语义
- [x] `chat-session-hub.ts`：runtime 身份 key、`closedRuntimes` + hub latch、`closeRuntime` / `close`、admission
- [x] `ws-chat.ts`：attach 同步 try/catch（error frame + close 1000）、registry miss 显式 close code、ready 布尔门
- [x] `routes/sessions.ts`：调用签名去掉 projectId

## Phase 3：装配层

- [x] `registry.ts`：`onRuntimeRemoved` observer、remove 顺序（摘除 → observer → shutdown）、removal barrier
- [x] `shutdown.ts`（新增）：`closeMultiProjectServer({ hub, registry, fastify, logger }, options)`，阶段超时/缺省 outcome
- [x] `index.ts`：先建 hub 再建 registry、装配 observer、`MultiProjectServer.close()`（幂等共享 Promise）
- [x] `desktop/electron/server.ts`：`closeServerHandle` 委托 `server.close()` 并注入 stage 策略

## Phase 4：测试

- [x] `chat-channel.test.ts`（新增）：状态迁移矩阵、close 后置条件、lease、ready 语义、startDetachedRun 重检
- [x] `chat-session-hub.test.ts`：签名/`releaseSession` 迁移 + admission / closeRuntime / close / 新 runtime 用例
- [x] `ws-chat.test.ts`：签名、attach 拒绝、registry miss close code、terminal 错误码
- [x] `sessions-send-message.test.ts`：签名、releaseSession、closed runtime 404
- [x] `registry.test.ts`：observer 顺序/异常、removal barrier
- [x] `shutdown.test.ts`（新增）：顺序、幂等、阶段超时/失败隔离、缺省日志
- [x] `trigger-log-visibility.test.ts` / `chat-hub-runtime-contract.test.ts`：签名迁移；契约测试补 release 不变量
- [x] `create-server.test.ts` / `browser-security.test.ts`：改走 `server.close()`
- [x] core `session-manager.test.ts` / `agent-runner.test.ts`：Phase 1 用例
- [x] desktop `server.test.ts` / `server-shutdown.test.ts`：mock 补 `close`、委托断言、超时用例迁往 server

## Phase 5：验证与收尾

- [x] `npm run lint` / `npm run build` / `npm run typecheck` / 受影响包测试
- [x] `npm run verify`
- [x] commit + code-review skill（critical 0；important 3 项已修，见第三个 commit）
- [x] doc-sync（design.md 文档同步节）+ design 偏差回写
