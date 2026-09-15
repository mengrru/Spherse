# [Infra] Chat Hub 生命周期与所有权收口

> 关联：backlog `## Bug`「补齐 session/agent/project abort-and-drain 生命周期」的 server hub 部分；`docs/dev/investigation/2026-08-29-session-lifecycle-concurrency/README.md` §3 Lifecycle B 第 5 项。
> 前置阅读：`docs/official/architecture/chat.md` §Server、`docs/official/architecture/server.md` §组合根与生命周期。
> 范围：`packages/server/src/chat` + `registry.ts` / `index.ts` / `errors.ts` + `packages/core` 三处最小 seam + desktop 关停委托。不改 wire 协议。

## 背景

chat 的 `hub → channel → projector` 分层本身是干净的（projector 是无框架纯状态机），问题集中在 hub/channel 与 `ProjectRuntime` / `ProjectRegistry` / Fastify 的接缝：三处所有权不对称，且 hub 没有任何生命周期入口。以下四条是本次要收口的问题，A/C/D 已有部分记录，B/D 的 server 侧可达路径未归入 hub 职责。

### A. Hub 没有生命周期入口，且外部不可达

`ChatSessionHub` 只有 `attach` / `startDetachedRun`（`chat-session-hub.ts:12-53`），没有 close/dispose；`chatHub` 只是 `createMultiProjectServer` 的闭包局部量（`index.ts:116-124`），`MultiProjectServer` 不暴露它（`index.ts:28-34`）。后果：

- `ProjectRegistry.remove` 只 `await runtime.shutdown()`（`registry.ts:159-165`），不通知 hub。旧 channel 继续持有已关闭的 `SessionManager`、log 订阅与 subscriber。
- key 是 `projectId:sessionId` 字符串（`chat-session-hub.ts:42`），同 projectId 重新 register 后 `getOrCreate` 命中旧 channel（`:43-44`），channel 绑定的是已 shutdown 的旧 runtime。
- server 关闭时唯一路径是 desktop 手工 `registry.removeAll()` + `fastify.close()`（`desktop/electron/server.ts:27-34`）；socket close 触发的 `attachment.close()` 只归还 lease 与订阅，channel 因 `running`/`openTurn` 不 dispose（`chat-channel.ts:351-362`），直到 run 结束才释放；同进程 `restartServer` 会让旧 hub/channel 在两个 server 实例间残留（`desktop/electron/server.ts:81-91`）。

已记录：investigation README:110、136；backlog §Bug。

### B. channel 对 runtime 的身份与存活性没有约束，lazy restore 可复活 archived session

- 首次 `runtime` 被 capture 后不再校验（`chat-session-hub.ts:42-50`）；`attach` 传错 runtime 不会失败。
- `ChatChannel.open` 构造即 `runtime.restoreSession`（`chat-channel.ts:51-62`），而 core `restoreSession` 不检查 session 状态（`session-manager.ts:53-59`）。`DELETE .../sessions/:id` 直接 archive + 删 runner（`routes/sessions.ts:161-168`），竞态下 attach 的 restore 可以把 archived session 重新装回 `sessions` map（investigation README:133 的 server 侧可达路径）。

### C. transport 层握有 core session runner 的销毁权

`cleanupIfIdle` 直接调 `runtime.destroySession`（`chat-channel.ts:360`）。runner 的创建入口分散（HTTP `createSession`、channel `restoreSession`、trigger `createSession`），删除权在 DELETE 路由，关闭权在 `ProjectRuntime.shutdown`（`project-runtime.ts:99-123`）。hub 用 `projector.isRunActive()`（log 派生）当作"直连 run 是否在跑"的判据——这是启发式而非 core 权威状态；判错会产生同 session 双 runner。

### D. 装配层关停顺序由 consumer 手工编排

`MultiProjectServer` 没有 `close()`，desktop 必须知道"先 registry.removeAll 再 fastify.close"（`desktop/electron/server.ts:27-34`），且不知道 hub 的存在。`ProjectRegistry.remove` 自身顺序也不严格：`await shutdown` 在 `projects.delete` 之前（`registry.ts:159-165`），shutdown 期间新请求仍能拿到 ctx。

## 目标

- hub/channel 有显式、终态、可测试的生命周期：admission 关闭 → 资源释放，全部同步可判定，无隐式状态机
- 一个资源一个 owner：registry 拥有 runtime，hub 拥有 channel，core 拥有 runner 的空闲释放决策，server `close()` 拥有关停顺序
- 消灭 stale channel（runtime 身份校验）、archived session 复活（core restore admission 重检）、transport 越权销毁（`releaseSession` seam）
- `MultiProjectServer.close()` 成为唯一 server 关停入口，desktop 不再拼装关停顺序
- 不变量以测试钉住（含真 runtime 契约测试与关停顺序单测 seam）

## 非目标

- core 完整 abort-and-drain：`AgentRunner.close()`、`SessionManager` admission 状态机、pending init/trigger drain、`ProjectRuntime` 共享 shutdown Promise、删除时 abort —— 仍属 backlog「abort-and-drain」剩余范围
- restore single-flight 与 trigger `restoreSession → sendMessage` 间隙的并发收口（investigation README:50、:109）—— core 后续工作，本设计在已知取舍中显式保留
- session/agent 级 delete 时主动 quiesce hub channel（需要先定义"删除时已连接客户端应观察到什么"，依赖 core delete 语义）—— 本设计只提供 project(all) 级入口
- 出站背压（backlog §chat WS 出站背压）、wire 事件类型化、run-state 下沉 core（backlog 条件触发项）
- 不改任何 wire 协议与 contracts

## 方案

### 1. 所有权模型

```
createMultiProjectServer (组合根, 拥有 MultiProjectServer.close)
├─ ChatSessionHub            owns ChatChannel（按 SessionManager 身份 + sessionId）
│   └─ ChatChannel           owns log 订阅 / subscriber 集合 / lease / 快照
│       └─ ChatSessionAttachment  per-socket 句柄（由 ws-chat 持有并 close）
├─ ProjectRegistry           owns ProjectRuntime（register / remove）
│   └─ ProjectRuntime        owns SessionManager + capabilities + stores
│       └─ SessionManager    owns AgentRunner（restore / release / destroy）
└─ Fastify                   owns socket（forceCloseConnections）
```

四条不变量：

1. `ChatChannel` 不晚于其 `SessionManager` 存活：runtime 收口（`closeRuntime`）必然先关闭其全部 channel；`closedRuntimes` 阻断迟到的 attach 重建 channel
2. `ChatSessionAttachment` 的命令在 channel 终态后确定性失败/无操作，不再触达 runtime 与 subscriber
3. runner 的空闲释放决策属于 core：hub 只能请求 `releaseSession`（core 自带 idle 守卫），不再调用 `destroySession`
4. server 关停顺序由 `MultiProjectServer.close()` 单点定义：hub 收口 → registry 收口 → fastify 收口

### 2. ChatChannel：显式状态机与严格终态

```ts
type ChannelState = "opening" | "open" | "closed";
type ChannelCloseReason = "idle" | "runtime-closed" | "server-closed" | "restore-failed";
```

- **不在构造函数里发起 I/O**。`ChatChannel.open` 只创建对象；restore 推迟到 `ensureReady()`，由首个 `attach` / `startDetachedRun` 触发，单飞（`readyPromise ??= ...` 共享）
- **状态迁移**：
  - `opening --restore ok--> open`：`initRunStateFromLog` + `subscribeSessionEvents` 仍在同一同步块内完成（保持现有"切片与订阅同 tick"约束）→ `cleanupIfIdle()`
  - `opening --restore fail--> closed(restore-failed)`：`dispose()`，`ready` reject
  - `opening/open --close(reason)--> closed`：同步终态，首个 reason 生效，幂等
  - `closed` 是吸收态
- **close-during-opening 的确定性规则**（消除歧义）：
  - `attachment.close()` 归还 lease 不改变 channel 状态；若此时仍在 `opening`，restore settle → `open` → `cleanupIfIdle()` 正常 `releaseSession` + `close("idle")`
  - `closeRuntime` / hub `close()` 在 `opening` 期间触发 channel.close：restore settle 的后继只判空，**不订阅、不回调、不 release**（runtime 正在关闭，release 无意义且可能触碰已关闭 store）；由此 restore 创建的 runner 驻留到 runtime shutdown，由 core 生命周期收口
- **lease 取代 `attachments`**：`attach` 与 `startDetachedRun` 各持一个 lease；`cleanupIfIdle` 仅在 `state === "open" && leases === 0 && !running && !projector.isRunActive()` 时触发 `runtime.releaseSession(sessionId)` 后 `close("idle")`——**close 不释放，release 不关闭**
  - `running`（自有 run）与 `isRunActive()`（log open turn，覆盖 trigger 直连 run）保持双条件：前者是串行化状态，后者防"直连 run 期间释放 → 新 attach restore 出第二个 runner"
- **所有 await 后继重检状态**（含 `startDetachedRun` 的 `await ensureReady`）：
  - `sentinel` 检查点：`if (this.state !== "open") throw/downgrade`；在途 `startRun` 的回调经状态判定降级为 no-op，但 `finally` 的 lease 归还与 `running=false` 必须执行（不依赖状态）
- **attachment `ready: Promise<void>` 语义**（替代 boolean，消除双重含义）：
  - restore 失败 → reject 原始错误（ws 仍按 NotFound → 4401 / MigrationRequired → 4402 映射）
  - attach 期间 channel 被收口（`closeRuntime` / hub `close()`）→ reject `ChannelClosedError`（ws 映射 1000，可重连）
  - **attachment 自身先被 close** → 无论 restore 成败均 resolve（socket 已在关闭，调用方不需要信号）；ws-chat 用 `ready.then(() => true, () => false)` 作为 abort/控制响应的门（无 unhandled rejection）
- **close 后置条件**（全部同步成立，测试逐条钉住）：

  | 后置条件 | 保证方式 |
  |---|---|
  | 无任何 subscriber 回调（含 handshake 路径） | close 清空 `subscribers`；`publish` / `handshake` 入口判 `state !== "open"` 早退（`notify` 仅由二者调用） |
  | log 订阅恰好解除一次 | `releaseSubscription()` 幂等，close 只调一次 |
  | hub map 无条目 | identity-guarded `dispose()` |
  | 命令确定性失败 | `sendMessage`/`retryLastTurn`/`withdrawLastTurn` reject `ChannelClosedError`；`abort`/`resolveControlRequest`/attachment `close()` no-op 且幂等 |
  | 生命周期可观测 | open/close/release 各打一条结构化日志（reason、sessionId、leases、run-in-flight、release 是否被 core 拒绝） |

### 3. ChatSessionHub：admission 与收口入口

```ts
class ChatSessionHub {
  private readonly channels = new Map<SessionManager, Map<string /* sessionId */, ChatChannel>>();
  private readonly closedRuntimes = new WeakSet<SessionManager>();
  private closed = false; // hub 级 admission latch

  attach(runtime, agentId, sessionId, subscriber, options?): ChatSessionAttachment;
  startDetachedRun(runtime, agentId, sessionId, content): Promise<void>;
  closeRuntime(runtime: SessionManager): void;   // project 级收口
  close(): void;                                 // server 级收口（替代 closeAll 命名，避免与 SessionManager.closeAll 混淆）
}
```

- **key 去掉 `projectId`，改为 runtime 对象身份 + sessionId**。sessionId 由 `crypto.randomUUID()` 生成、在 core 内全局唯一（`store/session.ts:156`，`session-manager.ts:48` 以 sessionId 为唯一键）；runtime 身份进 key 后，重新 register 的新 runtime 天然得到新 channel，旧 channel 不可能被复用
- **admission 检查覆盖全部入口**，命中即 throw `RuntimeClosedError`：
  - hub `closed` latch（`close()` 后，server 级收口）
  - `closedRuntimes.has(runtime)`（`closeRuntime` 后，project 级收口）
  - `close()` 必须同时设置 hub latch：只依赖 per-runtime 集合无法枚举"从未创建过 channel"的 runtime
- `closeRuntime(runtime)`：`closedRuntimes.add` → 摘除该 runtime 的 map 条目 → 逐个 `channel.close("runtime-closed")`。同步完成，不等待 run
- `close()`：`closed = true` → 对 map 内全部 runtime 执行同一动作 → 清空 map；幂等
- 可见性：hub 仍只经 `chat/index.ts` 对包内导出；外部唯一生命周期 API 是 `MultiProjectServer.close()`

### 4. core 最小 seam（三处）

1. `AgentRunner.isBusy(): boolean`（返回 `inFlight`；`agent-runner.ts:127-128` 已在任何 await 前原子取得所有权，bugfix A 已合入）
2. `SessionManager.releaseSession(sessionId): boolean`：runner 不存在或 busy 时返回 `false`（no-op），否则从 `sessions` map 移除并返回 `true`（便于 hub 记录 release 是否被 core 拒绝）。语义 = "空闲即释放内存驻留"，不触碰持久化、不归档
3. `restoreSession` admission 重检（store-closed-safe）：
   - 取 agent store 与 session 行；session 不存在或 `status !== "active"` → `NotFoundError`；store 已关闭（better-sqlite3 抛 `The database connection is not open`）同样映射 `NotFoundError`，不把 SQLite 原文泄给 HTTP/WS
   - 状态检查先于 `migrateLegacySession`（避免对 archived legacy session 做迁移副作用）；migration 之后 `await initForRestore`，再在**与 `sessions.set` 同一同步块内重检一次**（delete 路径的 `destroySession` + archive 均为同步，重检后可杜绝复活）
   - agent 删除（`deleteAgent` 先 close DB、`await fs.rm` 后才从 map 摘除，`store/project.ts:214-224`）与项目 shutdown 期间的重检失败同样映射 `NotFoundError`；`initForRestore` 在 await 中抛出的 store-closed 错误也走同一归一化（agent 缺失/迁移要求等语义错误保持原类型）

`destroySession` 保留，当前生产调用方仅 `ProjectRuntime.deleteSession`（`project-runtime.ts:57`）；`evictAgent` / `closeAll` 不调用它。hub 不再引用。

### 5. 装配层：registry observer、removal barrier、`MultiProjectServer.close()`

**ProjectRegistry** 新增可选 observer（构造选项，registry 不依赖 server 内模块类型）：

```ts
onRuntimeRemoved?: (runtime: SessionManager) => void;
```

`remove(projectId)` 顺序与并发防护：

1. 记录 `removing: Map<projectId, { root, promise }>`（**removal barrier**）
2. `projects.delete` → `lastOpenedMap.delete`（registry admission 关闭）
3. `onRuntimeRemoved?.(ctx.sessionRuntime)`（try/catch + log，传递失败不阻塞）
4. `await ctx.runtime.shutdown()`；完成后清除 barrier 条目

`register` 在 root 去重前检查 `removing`：命中同 root 则先 `await` 该 removal 完成再走 `doRegister`。否则 `projects.delete` 先于 shutdown 会让同一目录在旧 runtime 尚未关闭时注册出第二个 runtime（同 SQLite 双开）。

**MultiProjectServer** 新增唯一关停入口（幂等共享 Promise）：

```ts
interface ServerCloseOptions {
  stageTimeoutMs?: number;                                                    // 默认 10s
  onStageOutcome?: (stage: "registry.removeAll" | "fastify.close", outcome: "timeout" | "error", detail: unknown) => void; // 默认写 server logger
}
close(options?: ServerCloseOptions): Promise<void>;
```

- 顺序：`chatHub.close()`（同步）→ `settleWithin(registry.removeAll(), timeout)` → `settleWithin(fastify.close(), timeout)`；单阶段超时/失败不阻塞后续阶段
- 编排抽成 `packages/server/src/shutdown.ts` 的 `closeMultiProjectServer({ hub, registry, fastify, logger }, options)`（顶层跨域编排，符合 server README 的目录约定），让顺序/超时/幂等可用 fakes 单测，不必启动真 server
- `stageTimeoutMs` 有默认值（`settleWithin` 要求 number，缺省会导致 0ms 立即超时）；`onStageOutcome` 缺省时由 server logger 记录，阶段失败/超时永不静默
- `chatHub.close()` 用 try/catch 包裹：hub 收口即使抛错也不阻断后续阶段

**desktop** `closeServerHandle` 改为 `await handle.server.close({ stageTimeoutMs: SERVER_STAGE_TIMEOUT_MS, onStageOutcome: logStageOutcome })`；`stopServer` / `restartServer` 结构不变。`ServerHandle` 保留 `registry`（日常 API 仍需要）。

### 6. 关键交错与保证

| 交错 | 保证 |
|---|---|
| `attach` 与 `closeRuntime` 竞争 | 同一 hub 内串行：先到者生效；关闭后 attach 命中 `closedRuntimes` / hub latch 立即失败；已存在 channel 被 close，命令确定性失败 |
| `startDetachedRun` 与 `closeRuntime` 竞争 | `await ensureReady` 后继重检 state，terminal 即 reject；不会在已收口 runtime 上启动 run |
| attach 后 socket 立刻断开（restore 在途） | attachment.close 归还 lease；restore settle → `cleanupIfIdle` 必然 release + close（opening 期间不提前释放，避免与后续 attach 共享 runner 时误删） |
| channel 在 `opening` 期间被 runtime/hub 收口 | restore settle 只判空：不订阅、不回调、不 release；runner 驻留交 runtime shutdown |
| `DELETE session` 与 attach 的 restore 竞争 | core restore 两次 admission 重检拒绝 archived session / 已关闭 store；不产生复活 runner |
| 自有 run 在途时 `closeRuntime` | channel 同步终态，run 回调降级为 no-op；core run 继续（core abort-and-drain 负责），hub 不再持有引用 |
| trigger 直连 run 期间最后一个 socket 断开 | `isRunActive()` 挡住 `releaseSession`，channel 保留直到 run 边界；core 的 busy 守卫是第二道防线 |
| server close 与 socket close 回调 | `close()` 先行；fastify force-close 触发的 `attachment.close()` 是 terminal 态 no-op |
| `registry.remove` 期间重新 register 同目录 | removal barrier 等待旧 runtime shutdown 完成后才允许新注册 |
| `registry.remove` 中 shutdown 抛错 | ctx 已摘除、channel 已收口；错误透传（`removeAll` allSettled 记录），barrier 清除，不残留半注册态 |
| WS 连接时 project 已不存在 | `ws-chat` 关闭 socket 时给出显式 1000 + "project not found"（现状是无 code 的裸 close） |

## 已知取舍

- **close 是同步终态、不等待在途 run**：等待会把项目关闭绑在模型调用上，且 hub 并不拥有 run 的取消权（core 负责）。代价是 core run 在 channel 关闭后继续执行——backlog「abort-and-drain」要解决的问题；本设计只保证 hub 侧引用与回调干净
- **trigger `restoreSession → sendMessage` 间隙仍是释放竞态**：runner 已存在但 `isBusy()` 为 false 且 log 无 open turn，`releaseSession` 可在两 await 之间命中，导致 trigger 收到 `NotFoundError`。这是 core admission 的剩余缺口（investigation README:109），本设计不假装关闭它；作为 backlog follow-up 记录，随 core 生命周期工作修复，不作为本次验收条件
- **`releaseSession` 被 core 拒绝（返回 false）时 `cleanupIfIdle` 仍收口 channel**：唯一已知窗口是 trigger run 的 preflight（`inFlight` 已置但 `turn/start` 未落库，`isRunActive()` 尚为 false）。此时关闭 channel 是安全的——core runner 保留、后续 attach 的 `restoreSession` 直接复用；日志会同时出现 `released: false` 与 `close(idle)`，用于观测该窗口
- **registry removal barrier 语义**：`remove` 先装 barrier（总是 resolve 的 Promise），`register` 等待 barrier 而非 removal 结果——removal 的 shutdown 失败只透传给 `remove` 调用方，不阻塞同 root 重注册；若 shutdown 永久挂起，同 root 的 register 会一直等待（design 有意取舍，项目关闭本就异常）
- **restore 挂起仍会 pin channel**：无法取消 core restore（需要 AbortSignal/admission，属 core 工作）。取舍是 `opening` 期间 lease 归零不提前 close，等 settle 后统一 release，避免"新 attach 复用同一 runner 时被旧 channel 误释放"
- **`closeRuntime` 不主动断开 socket**：channel 终态后命令失败，客户端由项目关闭导航负责断开；server close 由 fastify force-close 兜底
- **错误映射规则**：`RuntimeClosedError` = 404（admission 拒绝、项目/会话命名空间不可用；WS attach 路径 → error frame + close 1000，客户端可重连到重新注册的项目）；`ChannelClosedError` = 409（已接纳连接在 channel 终态后的命令；`HttpError` 自带 `statusCode`，现有 `classifyRunError` 的 4xx → `PERMANENT` 规则自动生效，无需改分类逻辑，仅补测试）。错误消息为英文并随 error frame 可见于 UI——仓库暂无 server 错误 i18n，沿用现状
- **detached run 失败在无订阅者时仍只落日志**：失败事件不持久化，随后 attach 的客户端看不到旧错误。补齐需要事实流统一（backlog §统一 chat 事实流），不在本次范围
- **project shutdown 的 `closeAll()` 与 store close 之间仍有 pending restore 落入窗口**：第二次 admission 重检通过后、`sessions.set` 完成前 runtime 进入关闭（capability shutdown 阶段 store 仍开）时，runner 会装入正在关闭的 runtime；hub 侧因 runtime 身份与 admission 已不可再用它，仅对象驻留至回收。该窗口属 core admission 剩余范围（backlog），本设计不覆盖
- **hub 仍保留 `projector.isRunActive()` 作为释放守卫**：core `releaseSession` 的 busy 守卫才是权威；保留前者避免直连 run 期间的释放-恢复抖动

## 影响文件

| 文件 | 变更 |
|---|---|
| `packages/server/src/chat/chat-channel.ts` | 状态机、lazy `ensureReady` 单飞、lease、`close(reason)` 后置条件、await 后继重检、`releaseSession` 替换 `destroySession`、日志（快照与重放拆至下列新模块） |
| `packages/server/src/chat/chat-run-snapshot.ts` | **新增**（实现后按职责拆分）：`RunSnapshot` in-flight 快照压缩 |
| `packages/server/src/chat/chat-replay.ts` | **新增**（实现后按职责拆分）：`detectOpenTurn` / `replayHandshake` 纯函数 |
| `packages/server/src/chat/chat-session-hub.ts` | runtime 身份 key、`closedRuntimes` + hub latch、`closeRuntime` / `close`、admission |
| `packages/server/src/chat/ws-chat.ts` | `hub.attach` 同步 try/catch（error frame + close 1000）、registry miss 显式 close code、attachment ready 门改造 |
| `packages/server/src/routes/sessions.ts` | 调用签名去掉 projectId |
| `packages/server/src/registry.ts` | `onRuntimeRemoved` observer、remove 顺序、removal barrier |
| `packages/server/src/shutdown.ts` | **新增**：`closeMultiProjectServer` 编排（顺序 / 超时 / 幂等） |
| `packages/server/src/index.ts` | 先建 hub 再建 registry、`MultiProjectServer.close()` 装配 |
| `packages/server/src/errors.ts` | `RuntimeClosedError`(404) / `ChannelClosedError`(409) 工厂 |
| `packages/core/src/session/agent-runner.ts` | `isBusy()` |
| `packages/core/src/session/session-manager.ts` | `releaseSession`；`restoreSession` store-closed-safe admission 重检 |
| `packages/desktop/electron/server.ts` | `closeServerHandle` 委托 `server.close()`，注入 stage 策略 |
| 测试（server） | `chat-session-hub.test.ts`、`ws-chat.test.ts`、`sessions-send-message.test.ts`、`registry.test.ts`、`create-server.test.ts`、`browser-security.test.ts`、`trigger-log-visibility.test.ts`、`chat-hub-runtime-contract.test.ts`、`classify-run-error.test.ts`；新增 `shutdown.test.ts`、`chat-channel.test.ts`（状态机与后置条件） |
| 测试（core） | `__tests__/session/session-manager.test.ts`、`agent-runner.test.ts` |
| 测试（desktop） | `electron/server.test.ts`、`electron/server-shutdown.test.ts` |
| 文档 | `docs/official/architecture/{server,chat,desktop,core}.md`、`docs/official/glossary.md`、`docs/official/project-structure.md`（新增 `shutdown.ts`）、`docs/dev/decisions/*`、`packages/{core,server}/README.md`、`docs/dev/backlog.md` |

## 测试计划

**server / hub / channel（单测，mock SessionManager；mock 工厂需补 `releaseSession` 与可控 deferred restore）**

- lazy restore：`ChatChannel.open` 不调用 `restoreSession`；首个 attach 才触发；并发 attach 只 restore 一次
- 状态迁移矩阵：opening 期间 attachment close → settle 后 release + close("idle") + map 空；opening 期间 channel close → settle 后不订阅/不回调/不 release；restore 失败 → closed + map 空 + `ready` reject
- close 后置条件：5 条逐条断言（含 handshake 路径）
- attachment ready 语义：自身 close → resolve 且无错误帧；channel 期间关闭 → reject 且 ws 映射 error + close 1000
- lease：detached run 在途时 socket 断开不释放；run settle 后释放；`running` 与 `isRunActive()` 双重守卫各一条；自有 run 在途时 `closeRuntime` → 回调降级 no-op、命令 promise 正常 settle、不 release
- `startDetachedRun`：closeRuntime 在 restore 在途时 → reject，不在已收口 runtime 上启动
- admission：`closeRuntime` / `close()` 后 attach 与 detached run 均拒绝（含"runtime 无 channel"时 `close()` 后拒绝）；新 runtime 同 sessionId 得到新 channel
- ws 边界：registry miss 的显式 close code；attach 同步抛错的 error frame + close 1000（单测走 fake fastify，`@fastify/websocket` 真插件将 handler 抛错转为 `socket.terminate()`/1006，故真路径由 E2E 或集成测试覆盖）；channel 终态后 message 的 error code = PERMANENT；close 后 socket close 回调的双处理为 no-op
- HTTP：closed runtime 的 POST message → 404

**core**

- `releaseSession`：无 runner / busy runner no-op；idle 移除；不影响持久化
- `restoreSession`：archived session 拒绝；delete 在 `initForRestore` 期间发生 → 重检拒绝且不写 map；store 已关闭 → `NotFoundError`（非 SQLite 原文）
- 真 runtime 契约测试（仓库红线）：现有 `chat-hub-runtime-contract.test.ts` 增加"最后一个 lease 释放 → `hasActiveSession() === false`"；"直连 run 在途 → 不释放"由 `trigger-log-visibility.test.ts`（真 trigger run）覆盖
- `agent-runner.test.ts`：`isBusy()` 直接用例（false → true → false）

**装配**

- `registry.remove`：observer 在 shutdown 前调用；observer 抛错不阻塞；removal barrier 下同 root 重新 register 等待旧 shutdown；removal 失败不阻塞并发 register；shutdown 失败仍保持"已摘除"
- `shutdown.test.ts`（fakes + fake timers，承接 desktop 现有超时用例）：hub → registry → fastify 顺序；并发 close 共享 Promise（`index.ts` 的共享 Promise 用 fastify.close spy 钉住）；单阶段超时/失败不阻塞后续；缺省 10s 超时与缺省 outcome 日志
- desktop：`server.test.ts` / `server-shutdown.test.ts` 的 mock handle 补 `close`，断言委托与 stage 策略透传

**E2E**

- 按 `docs/official/testing.md` 影响面选：项目关闭/重开（`project-close` 类场景——注意该 spec 的 socket 关闭断言来自 renderer 导航，不归因 server）、`chat-streaming-resilience`（重连 + 释放守卫）；合并前 `npm run verify:e2e`

## 验收标准

- hub 不存在绑定已关闭 runtime 的 channel；`attach` / detached run 对 closed runtime / hub 确定性失败（测试）
- `ChatChannel.close` 5 条后置条件全部由测试钉住；hub / channel 中 grep 不到 `destroySession`
- `DELETE session` 与 attach 竞争不复活 archived session；store 关闭竞态给 `NotFoundError`（core 测试）
- `MultiProjectServer.close()` 是唯一关停入口：desktop 不再直接调 `fastify.close()` 或依赖 `registry.removeAll()` 顺序；顺序/幂等/阶段隔离有单测
- 现有 chat / registry / desktop / core 测试全绿；`npm run verify` 通过

## 文档同步（实现后按 doc-sync skill 执行）

- `docs/official/architecture/server.md`：组合根与生命周期（`close()` 契约与阶段）、ProjectRegistry（observer、removal barrier、remove 顺序）
- `docs/official/architecture/chat.md`：Server hub/channel（状态机、lazy restore、`closeRuntime`/`close`、release 语义、错误映射）
- `docs/official/architecture/desktop.md`：关停链改为委托 `server.close()`
- `docs/official/architecture/core.md`：SessionManager 的 `releaseSession` / `isBusy` / restore admission
- `docs/official/glossary.md`：hub/channel 词条（现为 `Map<projectId:sessionId, ...>` + "空闲销毁"，需重写）
- `docs/official/project-structure.md`：新增 `packages/server/src/shutdown.ts`
- `docs/dev/decisions/`：新增 ADR（hub 生命周期决策；按 thin ADR 规则可拆为 identity-key/close 语义与 core release 权两条），并在 `README.md` 索引补 0011 遗漏行 + 新行
- `packages/core/README.md`（Runner 并发/释放语义）、`packages/server/README.md`（chat 域生命周期入口）
- `docs/dev/backlog.md`：删除已完成的 hub 收口部分，保留 core abort-and-drain 剩余项；新增拆出的 follow-up（session/agent 级 quiesce、trigger 间隙收口）
