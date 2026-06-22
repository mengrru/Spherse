# Bus WebSocket Refactor — Implementation Plan

- **关联 design**：`docs/dev/infra/2026-06-21-bus-ws-refactor/design.md`
- **执行模式**：subagent-driven（任务间依赖见末尾依赖图，可并行处已标注）
- **验证基线**：每个任务完成后须通过自身 `lint` + `typecheck` + 指定测试；全部完成后跑 `npm run verify`

## 实现备注（design 的细化与澄清）

实现前需知悉以下 design 未点透的细节（已与现有代码核对）：

1. **baseUrl 是全局的**：`getServerPort()`（`packages/app/electron/server.ts:17`）返回单一端口，`createMultiProjectServer`（`packages/server/src/index.ts:24`）是单实例 + `ProjectRegistry` 多项目。所有项目的 `ctx.baseUrl` 相同。→ bus-store 的「全局单连接」成立。
2. **bus-store init 时机与方式**：design §6.1 写 `init(baseUrl)`，但 App.tsx 不直接持有 baseUrl。改为 `busStore.init()` 无参——内部调 `window.electronAPI.getServerPort()` 构造 wsUrl（与 `app-store.ts:38` 同模式），由 App.tsx 的 `restoreProjects` effect 在 restore 完成后调用一次。可测性同 `app-store.test.ts`（stub `window.electronAPI`）。
3. **debug 通道 fan-out 不能用 `Set<WebSocket>`**：`logger.ts:17` 在 server 启动时（任何连接到来前）调 `createDebugStream()` 喂给 pino multistream。当前 `ws-debug.ts` 用模块级 `clients: Set<WebSocket>` 让 logger 和 handler 共享。重构后此 Set 须移到 `ws-bus.ts`，但改为**回调 Set**（`Set<(envelopeJson: string) => void>`）以解耦 logger 对 socket 的依赖。数据流约定：`createDebugBusStream` 收到 pino 原始 chunk → trim 成 `line` → 包装成 `{channel:"debug", type:"log", payload:{line}}` → `JSON.stringify` → 对每个 subscriber 调 `subscriber(envelopeJson)`。`BusConnectionHandler` 在 debug subscribe 时注册 `subscriber = (envelopeJson) => safeSend(envelopeJson)`（safeSend 接收已序列化的字符串）。`logger.ts` 改 import `createDebugBusStream` from `ws-bus.ts`。
4. **契约迁移**：`scheduleServerEvent`/`parseScheduleServerEvent`/`ScheduleServerEvent` 从 `contracts/websocket.ts` 迁到 `contracts/bus.ts`；`contracts/websocket.ts` 仅留 chat 相关。`contracts/index.ts` 的导出随之调整。
5. **`toServerEvent` 迁移**：`ws-schedule.ts:8-40` 的 `toServerEvent` 函数搬入 `ws-bus.ts`（schedule 通道桥接用），逻辑不变。

---

## Task 1 — 新建 bus 契约（`contracts/bus.ts`）

**目标**：用 typebox 定义 bus envelope 与 client/server 消息 schema + parser，迁移 schedule 事件契约。

**参照模式**：`packages/server/src/contracts/websocket.ts`（`Type.Union` + `parseContract` + `schemas` 导出）。

**文件**：
- **新建** `packages/server/src/contracts/bus.ts`：
  - `busServerMessage`：`Type.Union` 覆盖 schedule(4) / fs-watch(change) / debug(log) / `__system__`(pong, fs_watch_error)，每条带 `channel`/`projectId?`/`type`/`payload`。实现上用 `Type.Object({ channel: Type.Literal(...), type: Type.Literal(...), payload: ..., projectId: Type.Optional(Type.String()) })` 的 union，projectId 仅 debug/`__system__:fs_watch_error` 需要时带上。
  - `busClientMessage`：`Type.Union` of subscribe/unsubscribe/ping（按 design §4.2）。
  - 从 `websocket.ts` 迁入 `scheduleServerEvent` schema 与 `ScheduleServerEvent` 类型（payload 复用）；`fsWatchChangeEvent = Type.Object({ eventType: Type.Union([Type.Literal("rename"), Type.Literal("change")]), path: Type.String() })`；`debugLogEvent = Type.Object({ line: Type.String() })`。
  - 导出 `schemas.busServerMessage` / `schemas.busClientMessage`、类型 `BusServerMessage`/`BusClientMessage`、parser `parseBusServerMessage`/`parseBusClientMessage`。
- **修改** `packages/server/src/contracts/websocket.ts`：删除 `scheduleServerEvent`、`ScheduleServerEvent`、`parseScheduleServerEvent`、`schemas.scheduleServerEvent`（仅留 chat）。
- **修改** `packages/server/src/contracts/index.ts`：`import * as bus from "./bus.js"`；`schemas` 合并 `...bus.schemas`；`export` 区块加 `parseBusServerMessage`/`parseBusClientMessage` 与类型 `BusServerMessage`/`BusClientMessage`；移除从 `websocket.js` 导出的 schedule 符号。

**验证**：
- `npm run typecheck --workspace=packages/server`
- 新增 `packages/server/src/__tests__/contracts/bus-contracts.test.ts`（参照 `api-contracts.test.ts`）：校验各 channel envelope parse 成功、malformed 抛 `/Invalid payload/`、subscribe/unsubscribe/ping 三种 client 消息。

**依赖**：无。

---

## Task 2 — 新建共享 `ProjectFsWatcher`（`fs-watcher.ts`）

**目标**：per-project 引用计数的 fs.watch 共享管理，多订阅者共享 1 个 OS watcher。

**参照模式**：`ws-fs-watch.ts:23-43`（`fs.watch(root, {recursive:true})` + `PROJECT_META_DIR` 过滤）。

**文件**：
- **新建** `packages/server/src/fs-watcher.ts`：
  - `type FsWatchListener = (projectId: string, evt: { eventType: "rename" | "change"; path: string }) => void;`
  - `class ProjectFsWatcher { watcher, listeners: Set<FsWatchListener>, error: Error | null }`
  - 模块级 `Map<projectId, ProjectFsWatcher>` 单例表。
  - `acquireFsWatch(projectRootResolver, projectId, listener): { ok: true } | { ok: false; error: Error }`：
    - 无 entry → `fs.watch(root, {recursive:true})`，回调里 ignore `segs[0]===PROJECT_META_DIR`，遍历 `listeners` 调 `listener(projectId, evt)`；`watcher.on("error")` → 标记 error、close watcher、向当前 listeners 广播（通过返回/异常由调用方处理 fs_watch_error）、清空 listeners、从 map 移除。
    - `fs.watch` 同步抛 → 返回 `{ok:false, error}`，**不**加入 listeners。
    - 已存在 → 加入 `listeners`。
    - **全程同步**，不得 await（design §5.6）。
  - `releaseFsWatch(projectId, listener)`：`listeners.delete(listener)`；空 → `watcher.close()` + map.delete。
  - 需要 `projectRoot`：从 `registry.get(projectId).projectManager.getRootPath()` 取。签名接受 `projectRoot: string`（由 `ws-bus.ts` 传入，避免 fs-watcher 依赖 registry）。
- **注意**：acquire 接收 `projectRoot` 而非 `registry`，保持模块纯净可测。

**验证**：
- `npm run typecheck --workspace=packages/server`
- 新增 `packages/server/src/__tests__/fs-watcher.test.ts`：
  - 多 acquire 同 projectId → 只 1 个 `fs.watch` 调用（spy `fs.watch`）。
  - 等量 release → watcher.close 被调、map 清空。
  - acquire 失败（mock `fs.watch` 抛）→ 返回 error、listeners 不增。
  - watcher onChange → 所有 listener 被调（含 `.spherse/` 过滤）。

**依赖**：无（与 Task 1 完全独立，可并行）。

---

## Task 3 — 新建 `BusConnectionHandler`（`ws-bus.ts`）

**目标**：per-connection 订阅表 + 三通道桥接 + debug fan-out 回调注册。

**依赖**：Task 1（contracts）、Task 2（fs-watcher）。

**文件**：
- **新建** `packages/server/src/ws-bus.ts`：
  - 模块级 `debugSubscribers: Set<(envelopeJson: string) => void>`；导出 `addDebugSubscriber`/`removeDebugSubscriber`/`createDebugBusStream()`。`createDebugBusStream` 返回 `Writable`，其 `write(chunk)`：`const line = chunk.toString().trim(); if(!line) return; const envelopeJson = JSON.stringify({channel:"debug", type:"log", payload:{line}}); for (const fn of debugSubscribers) fn(envelopeJson);`。subscriber 由 `BusConnectionHandler` 注册为 `(envelopeJson) => safeSend(envelopeJson)`，即直接把已序列化的 envelope 字符串发给 socket。
  - 从 `ws-schedule.ts` 迁入 `toServerEvent`（design §5.3）+ `EVENT_TYPES`。
  - `handleBusWebSocket(fastify, registry)`：
    - `fastify.get("/ws/bus", {websocket:true}, (socket, req) => new BusConnectionHandler(socket, registry))`
  - `class BusConnectionHandler`：
    - `subscriptions: Set<string>`（key `${projectId}::${channel}`）
    - `fsWatchListener: (projectId, evt) => safeSend(envelope{channel:"fs-watch", projectId, type:"change", payload: evt})`（固定实例字段）
    - `scheduleHandlers: Map<type, fn>`（per-project，按 projectId 缓存，因同一连接可订阅多项目 schedule）
    - `onMessage(raw)` → `parseBusClientMessage` → dispatch subscribe/unsubscribe/ping
    - subscribe fs-watch：从 registry 取 ctx → `acquireFsWatch(root, projectId, this.fsWatchListener)`；失败 → `safeSend(fs_watch_error envelope)`
    - subscribe schedule：`ctx.scheduler.on(type, handler)` × 4
    - subscribe debug：`addDebugSubscriber(this.debugSend)` where `this.debugSend = (envelopeJson) => safeSend(envelopeJson)`（直接转发已序列化的 envelope）
    - unsubscribe/close：对称释放（releaseFsWatch / scheduler.off × 4 / removeDebugSubscriber）
    - `safeSend`：try/catch 吞错（沿用 `ws-schedule.ts:57-63`）

**验证**：
- `npm run typecheck --workspace=packages/server`
- 新增 `packages/server/src/__tests__/ws-bus.test.ts`（mock socket + mock registry/scheduler + spy fs-watcher）：
  - subscribe schedule → scheduler.on 被调 4 次；emit 事件 → socket.send 收到正确 envelope
  - subscribe fs-watch → acquireFsWatch 被调；fs 事件 → envelope
  - subscribe debug → debugSubscribers 含该回调；createDebugBusStream.write → socket 收到 debug envelope
  - unsubscribe → 对称释放
  - close → 所有订阅释放、无泄漏
  - 重复 subscribe 同 key → 幂等
  - ping → 回 pong

**依赖**：Task 1、Task 2。

---

## Task 4 — 服务端接线（删旧 + 注册 bus + 重接 debug stream）

**目标**：删除 3 个旧 handler，注册 `handleBusWebSocket`，让 logger 用新 debug stream。

**依赖**：Task 3。

**文件**：
- **修改** `packages/server/src/index.ts`：
  - 删 import `handleFsWatchWebSocket`/`handleDebugWebSocket`/`handleScheduleWebSocket`
  - 加 import `handleBusWebSocket` from `./ws-bus.js`
  - 将 `index.ts:63-65` 三行替换为 `handleBusWebSocket(fastify, registry);`
- **修改** `packages/server/src/logger.ts:3`：`import { createDebugStream } from "./ws-debug.js"` → `import { createDebugBusStream } from "./ws-bus.js"`；`createServerLogger` 内 `createDebugStream()` → `createDebugBusStream()`。
- **删除** `packages/server/src/ws-fs-watch.ts`、`packages/server/src/ws-schedule.ts`、`packages/server/src/ws-debug.ts`。

**验证**：
- `npm run typecheck --workspace=packages/server`
- `npm run lint --workspace=packages/server`
- `npm test --workspace=packages/server`（合约 + ws-bus + fs-watcher 全过）
- 启动冒烟：`npm run build --workspace=packages/server` 成功，无 dangling import。

**依赖**：Task 3。

---

## Task 5 — 新建客户端 `bus-store` + `useBusSubscription`（可与 Task 3/4 并行）

**目标**：全局单连接 zustand store（重连/重放/心跳）+ 订阅 hook。

**依赖**：Task 1（contracts 类型）。

**文件**：
- **新建** `packages/app/src/stores/bus-store.ts`（参照 `app-store.ts` 的 electronAPI 用法 + `streaming-store.ts` 的 WS 管理）：
  - 状态：`status: "idle" | "connecting" | "open" | "closed"`；内部（非响应式）`ws`/`handlers: Map<string, Set<(type,payload)=>void>>`/重连 timer/心跳 timer。
  - `init()`：`const port = await window.electronAPI.getServerPort(); const wsUrl = \`ws://localhost:${port}/ws/bus\`;` 建 WS；设 onopen/onmessage/onclose/onerror。
  - `onmessage` → `parseBusServerMessage`：
    - `channel==="__system__"`（pong/fs_watch_error）→ 内部消化（pong 重置心跳计时；fs_watch_error 仅 console.debug）
    - debug 通道 → 固定按 `__global__::debug` 查 handlers
    - 其它 → 按 `${projectId}::${channel}` 查 handlers，遍历调 `handler(type, payload)`
  - `addHandler(projectId, channel, handler)` / `removeHandler(...)`：维护 Set；首个 add → 发 subscribe；最后 remove → 发 unsubscribe。
  - 重连：onclose → status=connecting，指数退避 1→2→5→10→30s；onopen → status=open + **重放订阅**（遍历 handlers keys 发 subscribe）+ 启心跳（30s ping）。
  - 心跳：30s 发 ping；用 `lastPongAt` 时间戳，onopen 后启动一个检查：若 `Date.now()-lastPongAt > 60000` → ws.close() 触发重连。
  - `teardown()`：清 timer、关 ws、清 handlers（测试用）。
- **新建** `packages/app/src/stores/useBusSubscription.ts`：
  - `useBusSubscription(projectId, channel, handler)`：handler 用 `useRef` 持有最新值（每次 render 更新 ref，不进依赖）；`useEffect([projectId, channel])` mount 时 addHandler、unmount 时 removeHandler。
  - debug 通道约定：调用方传 `projectId="__global__"`。

**验证**：
- `npm run typecheck --workspace=packages/app`
- 新增 `packages/app/src/stores/bus-store.test.ts`（stub `window.electronAPI.getServerPort` + mock WebSocket via `vi.stubGlobal`）：
  - init → 建连、status=open
  - addHandler 首个 → 发 subscribe；removeHandler 最后 → 发 unsubscribe
  - onmessage 分发到 handler
  - onclose → 重连（用 fake timer 推进）；onopen → 重放订阅
  - 心跳：fake timer 推进 60s 无 pong → close
- 新增 `packages/app/src/stores/useBusSubscription.test.ts`（@testing-library/react renderHook）：mount→addHandler 被调；unmount→removeHandler 被调。

**依赖**：Task 1。

---

## Task 6 — 客户端迁移 4 个调用点 + 删 api 工厂

**目标**：把 4 处旧 WS 调用换成 `useBusSubscription`；删除 `api.ts` 三个工厂；App.tsx 启动 bus-store。

**依赖**：Task 5。

**文件**：
- **修改** `packages/app/src/App.tsx`：在 `restoreProjects` effect（`App.tsx:39-53`）restore 完成后调 `void useBusStore.getState().init()`。import bus-store。
- **修改** `packages/app/src/layouts/ProjectScope.tsx:81-102`：删除 `createScheduleWebSocket` effect；改为在组件体内 `useBusSubscription(projectId, "schedule", (event) => { handleScheduleEvent(...); if completed showNotification })`。`showScheduleNotification` 用 `useCallback` 或 ref 稳定化以符合 hook handler 约定。注意删除已不用的 import（`client` 在此 effect 的依赖移除）。
- **修改** `packages/app/src/features/file-tree/hooks/useFsWatchRefresh.ts`：整个 hook 改为调 `useBusSubscription(projectId, "fs-watch", debouncedRefresh)`；projectId 需从调用方传入或从 `useProjectCtx` 取（当前签名是 `(client, refreshRoot)`——改为 `(projectId, refreshRoot)`，调用方 `useFileTreeController` 传 projectId；client 参数移除因不再需要）。debounce 300ms 逻辑保留（在 handler 内 setTimeout）。
- **修改** `packages/app/src/features/file-tree/hooks/useFileTreeController.ts`：调用 `useFsWatchRefresh` 处传 projectId（从 ctx 取）而非 client。
- **修改** `packages/app/src/features/content-browser/hooks/useContentEditor.ts:109-115`：改为 `useBusSubscription(projectId, "fs-watch", () => setConflict(true))`（仅 isEditing 时挂——用条件 hook? 不行，hook 不能条件调。解法：始终调用 hook，handler 内 `if (!isEditingRef.current) return;`，用 `isEditingRef` 同步最新状态）。projectId 从 hook 参数补入（当前 useContentEditor 接收 client；改为也接收 projectId，或从 useProjectCtx 取）。
- **修改** `packages/app/src/features/debug-tools/LogPanel.tsx:54-82`：删除自建 WS effect；改 `useBusSubscription("__global__", "debug", (type, payload) => { if pausedRef skip; const line = (payload as {line}).line; 解析 JSON 或 fallback })`。保留 paused/autoScroll 逻辑。`baseUrl` prop 若不再他用则删除。
- **修改** `packages/app/src/lib/api.ts:366-392`：删除 `createScheduleWebSocket`/`createFsWatchWebSocket`/`createLogWebSocket` 三个方法；删除 `wsUrl`/`wsProjectBase` 局部变量（若无其它使用）；删除 `ScheduleServerEvent` import（从 types）若不再用。
- **修改** `packages/app/src/lib/types.ts`：若 `ScheduleServerEvent` 仅被 api.ts 用，移除（改由 bus-store 从 contracts 导入类型）。
- **检查** `packages/app/src/features/agent-schedule/store.test.ts:29`：`createScheduleWebSocket: vi.fn()` mock 要移除（ApiClient 类型变了）；同步任何 mock ApiClient 的测试。

**验证**：
- `npm run typecheck --workspace=packages/app`
- `npm run lint --workspace=packages/app`
- `npm test --workspace=packages/app`（现有测试不破；schedule store test 移除已删 mock）
- `npm run build --workspace=packages/app`

**依赖**：Task 5。

---

## Task 7 — docs 同步 + 全量验证

**目标**：更新官方文档与 backlog；跑全量 verify + 关键 E2E。

**依赖**：Task 4、Task 6。

**文件**：
- **修改** `docs/official/architecture.md:42`：四 WS 描述改为「chat 独立 WS + 全局 `/ws/bus`（schedule/fs-watch/debug 多路复用，按 projectId×channel 订阅）」。
- **修改** `docs/official/project-structure.md:112-115`：`ws-*.ts` 清单更新（删 ws-fs-watch/ws-schedule/ws-debug，加 ws-bus/fs-watcher）。
- **修改** `docs/dev/backlog.md:13`：标记 bus 相关 WS 已由 bus store 统一管理（chat WS 仍另议）。
- **修改** design.md `状态` 字段（如需）。

**验证**：
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`（全 workspace）
- `npm run verify`
- E2E（按 AGENTS.md 选择）：
  - `npm run test:e2e --workspace=packages/app -- e2e/file-tree.spec.ts`
  - `npm run test:e2e --workspace=packages/app -- e2e/chat-streaming-resilience.spec.ts`（确认 chat WS 未受影响）
  - 合并前 `npm run verify:e2e`

**依赖**：Task 4、Task 6。

---

## 依赖图与并行计划

```
Phase A (并行):
  Task 1 (contracts)     ──┐
  Task 2 (fs-watcher)    ──┤
                           │
Phase B (Task1完成后并行):  │
  Task 3 (ws-bus)  ◄──1,2 ─┤
  Task 5 (bus-store)◄──1   │
                           │
Phase C (并行):             │
  Task 4 (server wiring)◄──3
  Task 6 (client迁移)   ◄──5
                           │
Phase D:                    │
  Task 7 (docs+verify) ◄──4,6
```

- **可并行**：Task 1 ∥ Task 2；Task 3 ∥ Task 5；Task 4 ∥ Task 6。
- **关键路径**：1 → 3 → 4 → 7（或 1 → 5 → 6 → 7）。

## 自检清单

- [ ] 所有任务有明确文件路径（create/modify/delete）
- [ ] 每个任务有独立验证命令
- [ ] 依赖关系无环、可并行处已标注
- [ ] design 的 3 个澄清点（baseUrl 全局、bus-store init 无参、debug fan-out 用回调）已在「实现备注」写明
- [ ] 测试覆盖 design §9 三层（contract/integration/app unit）
- [ ] 迁移清单与 design §10 一致（删 ws-*.ts ×3、api 工厂 ×3；新增 ws-bus/fs-watcher/bus-store/hook）
- [ ] chat WS 明确不动（Task 范围未触及 streaming-store/ws-chat.ts）
