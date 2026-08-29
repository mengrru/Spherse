# E2E `app.close()` 间歇悬死（Electron 退出链路无界等待）

## 现象

backlog #Bug 首条：顺序启动多个 Electron E2E 实例时，`app.close()` 偶发 60s 悬死——无断言失败、无页面快照，逐步日志定位到 close 不返回；干净 main 可复现。

Playwright 的 `app.close()` 等待 Electron **主进程退出**。主进程退出依赖 `gracefulShutdown`（`electron/main.ts:35`）链完成：

```
window-all-closed / before-quit
  → gracefulShutdown()                ← 无任何超时
    → await tunnelManager.stop()      （E2E 下 no-op）
    → await stopServer()              （electron/server.ts:97）
      → await registry.removeAll()    （逐项目 runtime.shutdown）
        → sessionRuntime.closeAll()   （同步清 map）
        → capability.shutdown?.()     （trigger 同步；mcp → client.close()）
        → projectManager.close()      （better-sqlite3 同步）
      → await fastify.close()
    → app.quit()
```

链上任一 await 悬死 → `app.quit()` 永不执行 → 进程不退 → Playwright 60s 超时。这就是「悬死」的传导机制。

## 根因

### 结构性放大器：退出链零超时

`gracefulShutdown` → `stopServer` → `removeAll` → `runtime.shutdown` → `fastify.close` 全链无超时、无兜底退出。任何一个 await 挂起即无限期阻塞进程退出，flake 必然表现为整条 E2E 悬死而非可诊断的局部错误。

### 最可能的具体悬点：`fastify.close()` 等待残留连接（机制已验证）

读依赖源码确认的机制链：

1. `@fastify/websocket` v11 的 `defaultPreClose`（`@fastify/websocket/index.js:218-231`）对每个 ws client 调 `client.close()`——**优雅关闭握手**（发 close 帧后等对端回应），非 `terminate()`；已进入 `wss.clients` 的连接，ws 8.x 的 `closeTimeout`（默认 30s）会让停滞握手最终 terminate——**有界但长达 30s**；
2. **无界悬死**来自不在 `wss.clients` 内的活跃连接：升级后的 ws raw socket 对 Node http server 是「活跃连接」，`server.close()` 回调要等所有活跃连接结束；若连接恰处 mid-upgrade（尚未完成升级交接，不在 `wss.clients`，`preClose` 不可见）或因 renderer 销毁时序竞态未走完关闭握手，该 socket 无任何超时机制兜底；
3. Fastify 5 的 `forceCloseConnections` 默认值：Node 支持 `closeIdleConnections` 时为 `'idle'`（`fastify/lib/server.js:134-136`）——只关**空闲**连接，不覆盖活跃 ws。

间歇性、顺序多实例才复现的特征与「renderer 销毁 / mid-upgrade 时序竞态」一致。E2E 观察到的 60s 悬死要求无界变体（30s 有界变体单独不足以触发 Playwright 超时）。确切触发该 socket 残留的具体窗口期无法静态钉死，但修复不依赖于此：`forceCloseConnections: true` 对「连接残留」整类悬死（有界/无界变体）均有效。

### 次级悬点与脆弱点

- MCP capability shutdown（`core/src/capabilities/mcp/index.ts:102` → `client.close()`）：stdio transport 的 close 等子进程退出，无界（E2E fixture 不配 MCP server，概率低，真实用户可踩）；
- `ProjectRuntime.shutdown`（`core/src/project-runtime.ts:101-103`）逐个 `await capability.shutdown?.()`，**某个 capability 抛错会中断后续 capability 与 `projectManager.close()`**——顺带修复（错误隔离）。

### 排除项（同步 API，不可能悬死，推翻 backlog 原猜想）

- sqlite：better-sqlite3 同步 `close()`（阻塞但不悬死）；
- fs-watch：`FSWatcher.close()` 同步；
- `sessionRuntime.closeAll()`：同步清 map；
- tunnel stop：E2E 下 mobile 未启用，no-op。

## 修复方案（三层防御）

### 层 1：退出出口兜底（消灭症状，必做）

**`electron/main.ts` `gracefulShutdown`**：

- 入口处布置硬兜底定时器：30s 后仍未走完则 `console.error` 诊断 + `app.exit(1)` 强制退出（`unref()`，正常退出时进程终止即作废，无需手动清理）。`app.exit` 无视一切未决 handle 与 quit 拦截，保证进程退出有界；
- tunnel stop 包 5s 超时：超时记日志继续（cloudflared 子进程随强制退出路径终结局可接受）。

最坏路径：5s（tunnel）+ 10s（removeAll）+ 10s（fastify）= 25s < 30s 硬兜底，各阶段超时日志先行落盘，硬兜底只兜「app.quit 本身挂住」等未预期路径。

### 层 2：根因修复 + 全链超时审计（定位并消灭悬死本身）

**`server/src/index.ts`**：Fastify 构造选项加 `forceCloseConnections: true`。Fastify 5 关闭时序（`fastify.js:381` 已验证）为 `preClose` hooks → `closeAllConnections()`（Node ≥ 18.2，Electron 41 = Node 22 可用）→ `server.close()`。注意：`@fastify/websocket` 的 `defaultPreClose` 在发起优雅关闭后**同步** `done()`（`index.js:228-230`），`closeAllConnections` 会在约一个 tick 后强杀残留 socket——早于 WS 关闭握手完成，客户端实际观察到的是异常关闭（1006）而非干净关闭（1000）。已验证 renderer 侧容忍：chat runtime 仅把 `SESSION_UNRECOVERABLE` 视为 fatal（`chat-session-runtime.ts:21-23`），1006 走重连退避路径；bus store 同款 `scheduleReconnect`。`restartServerWithAuth` 路径 server 会重启，客户端靠重连恢复，语义不变。本地桌面 server 在应用退出时切断客户端连接，语义可接受。

**`electron/server.ts`**：抽 `closeServerHandle`（`stopServer` 与 `restartServerWithAuth` 复用），**入口即置空模块级 `serverHandle`**（并发 stop/restart 双重进入时第二次调用直接 no-op，消除对同一 handle 的 double-close 竞态），`registry.removeAll()` 与 `fastify.close()` 各包 10s 超时，超时 `console.error` 记录卡住的 stage 名。

**`core/src/project-runtime.ts` `shutdown`**：逐 capability 的 `shutdown?.()` 包超时（5s）+ 错误隔离——超时或抛错记 `logger.warn` 后继续下一个 capability，保证 `projectManager.close()` 必达。

**共享工具 `core/src/utils/settle-within.ts`**：`settleWithin(promise, timeoutMs, onSettle)`——永不 reject；正常完成时 `clearTimeout` 且**不**回调 `onSettle`（settled-guard，防止迟到的定时器在健康关闭路径打出伪错误日志）；仅超时或源 promise reject 时一次性回调 `onSettle("timeout" | "error", detail?)` 后 resolve；timer `unref()`；`promise` 为空时立即 resolve。core 与 desktop 三处复用，从 `@spherse/core` 导出（外部实际使用，符合导出规范）。

### 层 3：E2E 侧防御（冗余保险）

`e2e/helpers/electron.ts` 新增导出 `closeApp(app)`：`Promise.race(app.close(), 20s timeout)`，超时 `app.process().kill("SIGKILL")` 兜底——提炼自 `floating-chat.spec.ts:75-87` 既有本地实现，替换全部 spec 的 `await app.close()` / `app?.close()` 调用（含 `unsafe-location-guard.spec.ts`、`app-launch.spec.ts`、`packaged-smoke.spec.ts` 的 optional-chaining 变体，共 18 个 spec 文件）。20s 选择：正常退出 < 2s；主进程侧 stage 超时日志（5s/10s/10s 档）在最坏 25s 叠加路径下也能先于 kill 落盘前两条，诊断信息基本不丢；主进程 30s 硬兜底作为真实用户场景的最终防线，E2E 无需等它。

## 影响面

- core：新增 `utils/settle-within.ts` + 测试；`project-runtime.ts` shutdown 错误隔离 + 超时；`index.ts` 导出 `settleWithin`
- server：`index.ts` Fastify 选项 `forceCloseConnections: true` + `create-server.test.ts` 契约断言
- desktop：`electron/main.ts` 硬兜底 + tunnel 超时；`electron/server.ts` `closeServerHandle` 分阶段超时；`e2e/helpers/electron.ts` `closeApp` + 18 个 spec 调用点机械替换（`floating-chat.spec.ts` 删本地重复实现）
- i18n / app：不改（无用户可见文案变化；30s 强退仅在已挂死路径发生）

## 测试

- core `__tests__/utils/settle-within.test.ts`：正常完成即透传且**不触发 onSettle（含迟到的定时器不回调）**、超时回调并 resolve、源 promise reject 回调并 resolve（不产生 unhandled rejection）、空 promise 立即 resolve。
- core `__tests__/project-runtime-shutdown.test.ts`：直接构造 `ProjectRuntime`（fake projectManager/sessionRuntime/capabilities）——① 某 capability shutdown 永不 resolve → `runtime.shutdown()` 在超时内返回且后续 capability 的 shutdown 与 `projectManager.close` 仍执行；② 某 capability shutdown 抛错 → 不中断后续 capability；③ 正常路径行为不变（close 仍被调用）。
- server `__tests__/create-server.test.ts`：断言 `fastify.initialConfig.forceCloseConnections === true`（钉住配置不回退）。
- desktop `electron/server-shutdown.test.ts`（co-located，仿包内 `updater.test.ts` 惯例）：mock `electron` / `./settings.js` / `./model-catalog.js` / `@spherse/server`——① `ensureServer` 注入永不 resolve 的 `registry.removeAll()` → `stopServer()` 在超时内返回且输出 stage 超时日志，且 `fastify.close` 仍被调用；② `restartServerWithAuth` 同样走 `closeServerHandle`（断言两阶段均执行）；③ stop 后再次 `stopServer()` no-op（handle 已入口置空）。
- `main.ts` `gracefulShutdown` 不做单测（入口模块依赖重、mock 成本高于收益），由 E2E 与 code review 覆盖。
- E2E 验证：改动涉及 Electron 启动与 E2E helper，跑 `app-launch.spec.ts` + `file-tree.spec.ts` + `floating-chat.spec.ts`（共享 `closeApp` 的直接消费者），以及调用点被机械替换的 `chat-retry` / `chat-streaming-resilience` / `chat-withdraw` / `project-close` / `text-selection-session`。

## 行为变更说明

- 所有用户的 app 退出：最坏多等 ~30s 后强制退出（此前无限挂死）；正常路径无感知。
- server 关闭时主动切断仍开着的客户端连接（chat/bus ws、keep-alive）：客户端观察到 1006 异常关闭并走既有重连路径（chat runtime / bus store 均容忍，仅 `SESSION_UNRECOVERABLE` 为 fatal）；桌面单用户与 hosted web 远程连接语义一致——退出本就无法服务，`restartServerWithAuth` 重启后靠重连恢复。
- capability shutdown 抛错不再中断其余 capability 与 sqlite 关闭（此前会跳过）。

## 残余风险（接受）

- 30s 硬兜底只覆盖 `gracefulShutdown` 入口之后的挂死；入口之前（如 `window-all-closed` 因窗口未关而不触发）真实用户场景无兜底——E2E 由 SIGKILL 层覆盖。
- stage 超时不取消底层工作：`removeAll` 超时后各 runtime 仍在后台继续关闭，最坏被 30s `app.exit(1)` 截断在 sqlite 关闭之前，依赖 WAL 恢复兜底。
- 逐 capability 顺序 5s 超时 × N 在多 capability 场景叠加可超过外层 10s `removeAll` 预算，stage 日志只能定位到 `removeAll` 档，需结合 capability warn 日志进一步定位（两者时间戳可对齐）。

## 不做的事（记录理由）

- **不静态钉死「哪个 await 挂」作为修复前提**：间歇竞态无法离线复现穷举；分层超时 + stage 日志让下一次复发时日志直接点名（backlog 修复方向「审计具体卡住的 await」由此达成）。
- **不给 `app.quit()` 之后的窗口关闭流程再加超时**：30s 硬兜底 `app.exit(1)` 已覆盖该路径全部挂法。
- **不改 `@fastify/websocket` preClose 的优雅关闭语义**：`closeAllConnections` 在 preClose 后强杀残留，客户端 1006 + 重连的代价已由 renderer 既有重连逻辑吸收，无需自定义 preClose。

## 文档同步（实现完成后执行 doc-sync）

- `docs/dev/backlog.md`：删除「E2E `app.close()` 间歇悬死」条目（完成即删）
- `docs/official/project-structure.md`：新增 `packages/core/src/utils/settle-within.ts`（及两个测试文件）
