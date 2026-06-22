# Bus WebSocket Refactor — Design

- **日期**：2026-06-21
- **类型**：[refactor] infra
- **状态**：design-review
- **关联**：`docs/official/architecture.md`、`docs/dev/backlog.md`、`docs/dev/infra/2026-06-13-single-server-refactor/design.md`

## 1. 背景与动机

Spherse 目前有 4 条独立 WebSocket 端点，各自独立接线，无共享抽象：

| WS 端点 | 文件 | 作用域 | 方向 | 契约 |
|---------|------|--------|------|------|
| `/ws/projects/:projectId/schedule` | `packages/server/src/ws-schedule.ts:42-78` | per-project | server→client | `contracts/websocket.ts:39-66` |
| `/ws/projects/:projectId/fs-watch` | `packages/server/src/ws-fs-watch.ts:6-45` | per-project | server→client | **无**（shape 硬编码） |
| `/ws/projects/:projectId/chat/:agentId/:sessionId` | `packages/server/src/ws-chat.ts:5-64` | per-project×session | 双向 | `contracts/websocket.ts:4-37` |
| `/ws/debug` | `packages/server/src/ws-debug.ts:7-43` | global | server→client | **无**（裸字符串） |

注册点 `packages/server/src/index.ts:62-65` 四行各自独立。

**已知问题**：

1. **OS watcher 冗余**（server 侧资源浪费）：`ws-fs-watch.ts:23` 对**每个**连接客户端各开一个 `fs.watch(root, {recursive:true})`。文件树 + 一个编辑中的 content file = 同一项目 2 个 OS watcher 完全重复。
2. **契约不一致**：schedule/chat 用 `@sinclair/typebox` 定义在 `@spherse/server/contracts`；fs-watch/debug 无运行时 schema，违反 AGENTS.md「WebSocket message/event 的运行时 schema 统一定义在 `@spherse/server/contracts`」。
3. **连接数膨胀**：1 个打开项目稳态 ≥2 条 WS（schedule + fs-watch）；编辑文件时 ≥4 条。每多一个项目至少 +2 条。
4. **重复样板**：每个 `ws-*.ts` 独立处理 close/error/释放、各写一遍 `safeSend`。

backlog `docs/dev/backlog.md:13`（恢复 React StrictMode + 修 WebSocket effect cleanup）也与多 WS 各自管理生命周期直接相关。

## 2. 目标 / 非目标

**目标**

- 将 `schedule`、`fs-watch`、`debug` 三个 **server→client 推送**通道合并到单一全局 `/ws/bus` WebSocket，按 `(projectId, channel)` 订阅。
- 修掉 fs-watch 的 OS watcher 冗余：每个项目只 1 个共享 `fs.watch`，多订阅者共享。
- 为 fs-watch / debug 补齐 `@spherse/server/contracts` 运行时 schema。
- 一次解决多 WS 的生命周期/重连/StrictMode 问题。

**非目标（YAGNI）**

- **不动 chat WS**：chat 是双向 + session-scoped（URL 带 `agentId/sessionId`），不契合订阅模型，保持独立。
- **不建通用 EventBus 抽象**：当前只有 3 个推送通道且短期无新增计划。方案 A（连接 multiplexer）是通用 EventBus（方案 C）的真子集，未来如需演进只需把 `ws-bus.ts` 内硬编码路由换成 registry 调度，不破坏 envelope/客户端协议。详见 §8 备选方案对比。
- **不做渐进迁移/双写**：3 个通道均为内部 plumbing，无外部消费者，单 PR 干净切换。
- **不加订阅回执**：订阅成功靠「收到该 channel 的事件」隐式确认。
- **不加鉴权**：bus 不做 projectId 权限校验（沿用现状）。

## 3. 总体架构

```
┌─────────────────────────── Renderer (单条 WS) ────────────────────────────┐
│                                                                            │
│  App.tsx ──init──▶ bus-store (zustand, 常开 WS + 重连/重放/心跳)            │
│                          │                                                 │
│                          │ onmessage → parseBusServerMessage → 分发         │
│                          │                                                 │
│   useBusSubscription(projectId,"schedule",h)  ──┐                           │
│   useBusSubscription(projectId,"fs-watch",h)   ├──┼──▶ handlers Map         │
│   useBusSubscription(projectId,"fs-watch",h)   ──┘    key: `${projectId}    │
│   useBusSubscription("__global__","debug",h)            ::${channel}`       │
│                                                                            │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     │ 1 条 WS：/ws/bus
                                     │ subscribe/unsubscribe/ping
                                     ▼
┌──────────────────────── Server (fastify) ──────────────────────────────────┐
│                                                                             │
│  handleBusWebSocket(fastify, registry)                                      │
│       │                                                                     │
│       ▼                                                                     │
│  BusConnectionHandler (per-connection)                                      │
│   - subscriptions: Set<`${projectId}::${channel}`>                          │
│   - on subscribe/unsubscribe → acquire/release 各通道资源                   │
│                                                                             │
│       ┌──────────────┬─────────────────────┬────────────────┐               │
│       ▼ schedule      ▼ fs-watch            ▼ debug           │               │
│   scheduler.on(...)   ProjectFsWatcher     debug 广播 set     │               │
│   (4 个监听器)         (per-project 引用计数) (pino stream tap)│               │
│                       1 个 OS fs.watch / project             │               │
│                       ↑ 多订阅者共享                          │               │
│                                                             │               │
└─────────────────────────────────────────────────────────────────────────────┘
```

**关键属性**

- **全局单连接**：整個 renderer 只开 1 条 `/ws/bus`，常驻整个 app 生命周期，App 启动时建立。
- **按 `(projectId, channel)` 订阅**：客户端发 `subscribe`/`unsubscribe` 消息动态加入/退出子通道；服务端按连接维护订阅表。
- **fs-watch 去重**：服务端 `ProjectFsWatcher` 单例表 + 引用计数，无论多少订阅者每个项目只 1 个 OS `fs.watch`。
- **envelope 统一**：所有 bus 事件走同一包裹结构，契约集中在 `contracts/bus.ts`。

## 4. 协议契约

### 4.1 Envelope（server → client）

```ts
type BusServerMessage = {
  channel: "schedule" | "fs-watch" | "debug" | "__system__";
  projectId?: string;   // debug 通道可空（全局广播）
  type: string;         // 通道内事件类型，见下
  payload: unknown;     // type 对应的强类型 payload
};
```

各通道 `type` 与 `payload`：

| channel | type | payload | 来源 |
|---------|------|---------|------|
| `schedule` | `schedule_triggered` | `{agentId, scheduleId, sessionId?, triggeredAt}` | 复用现有 `scheduleServerEvent` payload |
| `schedule` | `schedule_completed` | `{agentId, scheduleId, sessionId, status:"success"}` | 同上 |
| `schedule` | `schedule_failed` | `{agentId, scheduleId, error}` | 同上 |
| `schedule` | `schedule_updated` | `{agentId, scheduleId, schedule?}` | 同上 |
| `fs-watch` | `change` | `{eventType:"rename"\|"change", path:string}` | **新增正式契约**（替代硬编码 shape） |
| `debug` | `log` | `{line:string}` | 替代当前裸字符串 |
| `__system__` | `pong` | `{}` | 心跳响应 |
| `__system__` | `fs_watch_error` | `{projectId, error}` | fs.watch 创建失败 |

全部用 `@sinclair/typebox` 定义在 `packages/server/src/contracts/bus.ts`，通过 `@spherse/server/contracts` 导出。server 发送前用 encoder 构造/校验，client 用 `parseBusServerMessage` 解析。`scheduleServerEvent` / `parseScheduleServerEvent` 从 `contracts/websocket.ts` 迁移到 `contracts/bus.ts`。

### 4.2 客户端控制消息（client → server）

```ts
type BusClientMessage =
  | { kind: "subscribe";   projectId: string; channel: "schedule" | "fs-watch" | "debug" }
  | { kind: "unsubscribe"; projectId: string; channel: "schedule" | "fs-watch" | "debug" }
  | { kind: "ping" };
```

- 同样 typebox 定义 + `parseBusClientMessage`。
- **无回执**：server 收到后静默更新订阅表；非法 `projectId`/`channel` 静默忽略 + debug 日志。
- 同一 key 重复 subscribe：服务端 Set 去重（幂等），资源引用计数不重复增加。
- **debug 通道约定**：客户端订阅 debug 时固定传 `projectId: "__global__"`；server 对 `channel:"debug"` 的订阅不校验 `projectId` 是否为已注册项目，仅按 `__global__::debug` 记入订阅表。

## 5. 服务端设计

### 5.1 `BusConnectionHandler`（per-connection）

文件：`packages/server/src/ws-bus.ts`

- 每条 `/ws/bus` 连接创建一个 handler，持有 `subscriptions: Set<string>`，key 形如 `${projectId}::${channel}`（O(1) 查重/增删）。
- `socket.on("message")` → `parseBusClientMessage` →
  - `subscribe`：插入 set；按 channel 分派：
    - `fs-watch`：`acquireFsWatch(projectId, this.fsWatchListener)`，其中 `this.fsWatchListener` 是该连接固定的 `(projId, evt) => safeSend(envelope{channel:"fs-watch", projectId: projId, type:"change", payload: evt})` 回调。
    - `schedule` → 在 `ProjectContext.scheduler` 上挂 4 个监听器（triggered/completed/failed/updated），每个 → `send(envelope{channel:"schedule",...})`
    - `debug`（projectId 约定为 `"__global__"`） → 把该 socket 加入全局 debug 广播 set
  - `unsubscribe`：从 set 移除；对应释放（`releaseFsWatch` / `scheduler.off` 全部 / 移出 debug set）
  - `ping` → 回 `{channel:"__system__", type:"pong", payload:{}}`
- `socket.on("close")` / `socket.on("error")`：遍历 set，对每条订阅执行与 unsubscribe 相同的释放，保证不泄漏 OS watcher / EventEmitter 监听器。
- 发送时 `safeSend`：try/catch 吞 closed socket 错误（沿用 `ws-schedule.ts:57-63`）。

### 5.2 `ProjectFsWatcher`（per-project，引用计数）

文件：`packages/server/src/fs-watcher.ts`

- 单例表 `Map<projectId, ProjectFsWatcher>` 由所有 `BusConnectionHandler` 共享。
- 每个 `ProjectFsWatcher` 持有 `{ watcher: FSWatcher | null, listeners: Set<(projectId, evt) => void>, error: Error | null }`。
  - `listeners` 是订阅者回调集合；**refCount = `listeners.size`**。
- `acquireFsWatch(projectId, listener)`：
  - map 无该 projectId 时创建 `ProjectFsWatcher`：`fs.watch(root, {recursive:true})` 创建 OS watcher，ignore `.spherse/`（沿用 `ws-fs-watch.ts:30` 的 `PROJECT_META_DIR` 过滤）；watcher 的 `on("change")` 遍历 `listeners` 调每个 `listener(projectId, {eventType, path})`。
  - 已存在且 `watcher === null`（创建失败）：直接返回，**不加入 listeners**，由调用方决定是否回报 `fs_watch_error`。
  - 否则把 `listener` 加入 `listeners`。
- `releaseFsWatch(projectId, listener)`：`listeners.delete(listener)`；`listeners` 空时 `watcher.close()` 并从 map 移除。
- watcher error：`fs.watch` 同步抛 → `acquireFsWatch` 捕获 → 给该连接回 `{channel:"__system__", type:"fs_watch_error", payload:{projectId, error}}`，不增加 listener，该连接收不到 fs-watch 事件（其它通道不受影响）。watcher 运行期 `on("error")` 异步错误 → 标记 `error`、close watcher、向当前所有 listeners 广播 `fs_watch_error`、清空 listeners 并从 map 移除。

### 5.3 schedule 通道桥接

- 订阅时在 `ProjectContext.scheduler`（`packages/core/src/scheduler.ts:36` 的 EventEmitter）挂 4 个监听器；每个监听器 → `send(envelope{channel:"schedule", projectId, type, payload})`。
- payload 复用 `ScheduleEventPayload`（`scheduler.ts:9-17`）→ wire 格式经 `toServerEvent` 转换（沿用 `ws-schedule.ts` 现有逻辑）。
- 退订/断开时全部 `off`。

### 5.4 debug 通道

- 一个模块级 `Set<WebSocket>`（沿用 `ws-debug.ts:5` 模式），`createDebugStream()` 的 `write` 改为向订阅了任意 `*::debug` 的连接广播 envelope `{channel:"debug", projectId:undefined, type:"log", payload:{line}}`。
- debug 通道 **envelope 里 `projectId` 留空**（全局广播）。

### 5.5 Server 注册变更

`packages/server/src/index.ts:62-65` 四行：

```ts
registerAllRoutes(fastify, registry);
handleChatWebSocket(fastify, registry);      // 保留
handleFsWatchWebSocket(fastify, registry);   // 删除
handleDebugWebSocket(fastify);               // 删除
handleScheduleWebSocket(fastify, registry);  // 删除
```

改为：

```ts
registerAllRoutes(fastify, registry);
handleChatWebSocket(fastify, registry);      // 保留
handleBusWebSocket(fastify, registry);       // 新增
```

`ws-fs-watch.ts` / `ws-schedule.ts` / `ws-debug.ts` 删除；新增 `fs-watcher.ts`（共享 watcher）+ `ws-bus.ts`（连接 handler）。

### 5.6 线程模型与并发

- `@fastify/websocket` 回调在各自 socket 的事件循环上跑；Node 单线程事件循环。
- 订阅表/引用计数只在该连接的回调线程内读写，无需锁。
- 共享的 `ProjectFsWatcher` 单例表的 acquire/release 可能被不同连接交错调用 → **约束：acquire/release 全程同步（不得出现 await）**，否则 refCount 可能错乱。`fs.watch` 回调天然 async 但不影响计数逻辑。

## 6. 客户端设计

### 6.1 `bus-store`（全局 zustand store）

文件：`packages/app/src/stores/bus-store.ts`

- App 启动时（`App.tsx` 编排层）`init(baseUrl)` 建立**唯一一条** `new WebSocket(\`${wsUrl}/ws/bus\`)`，常驻整个 app 生命周期。
- 状态：
  - `ws: WebSocket | null`
  - `status: "connecting" | "open" | "closed"`
  - 内部 `handlers: Map<string, Set<handler>>`，key `${projectId}::${channel}`，value 一组 `(type, payload) => void`。
- `onmessage` → `parseBusServerMessage` →
  - `channel === "__system__"`（pong / fs_watch_error）：内部消化（更新 status / debug 日志），不分发。
  - 否则按 `${projectId}::${channel}` 查 `handlers` map，遍历调用。
  - **debug 通道 projectId 约定为 `"__global__"`**：调用点传 `useBusSubscription("__global__", "debug", onLog)`，订阅 key 为 `__global__::debug`。分发时对 debug 通道走单独路径：收到 envelope 后固定按 `__global__::debug` key 查 handlers（无视 envelope 里可能空的 projectId）。
- `addHandler(key, handler)` / `removeHandler(key, handler)`：维护 Set，**首个加入触发 subscribe、最后一个移除触发 unsubscribe**——保证服务端订阅表与「是否有人在听」严格一致。
- **自动重连**：`onclose` 后 `status="connecting"`，指数退避重连（1s→2s→5s→10s 封顶，最大 30s）；重连成功后 `status="open"` 并**重放订阅**（遍历当前 `handlers` map 的 key 集合，重发 `subscribe` 消息）。
- **心跳**：每 30s 发 `{kind:"ping"}`；连续 2 次（60s）未收到 pong → 主动 `ws.close()` 触发重连。
- `teardown()`：关 ws、清 handlers（仅在 app 整体卸载/测试时调用）。

### 6.2 `useBusSubscription(projectId, channel, handler)`（hook）

文件：`packages/app/src/stores/useBusSubscription.ts`

- `handler` 用 `useRef` 持有最新引用（避免每次渲染重订阅），`useEffect` 依赖 `[projectId, channel]`（不放 handler——遵守 AGENTS.md effect 依赖规范）。
- mount 时：`busStore.addHandler(key, handlerRef)`，若该 key 是首个 handler 则发 `{kind:"subscribe", projectId, channel}`。
- unmount / key 变化时：`busStore.removeHandler(key, handlerRef)`，若该 key 变空则发 `{kind:"unsubscribe", projectId, channel}`。

### 6.3 调用点迁移

| 现状 | 迁移后 |
|------|--------|
| `ProjectScope.tsx:61-82` `client.createScheduleWebSocket(onEvent)` | `useBusSubscription(projectId, "schedule", onEvent)` |
| `useFsWatchRefresh.ts:4-22` | `useBusSubscription(projectId, "fs-watch", debouncedRefresh)` |
| `useContentEditor.ts:109-115` | `useBusSubscription(projectId, "fs-watch", () => setConflict(true))` |
| `LogPanel.tsx:54-79` | `useBusSubscription("__global__", "debug", onLog)` |

- file-tree 与 content-editor 两处 fs-watch 订阅**共享同一 `(projectId, "fs-watch")` key**，服务端按连接去重，不再各开 OS watcher。
- debug 用哨兵 projectId `"__global__"`；服务端 debug 通道忽略 projectId。
- `api.ts` 删除 `createScheduleWebSocket` / `createFsWatchWebSocket` / `createLogWebSocket` 三个工厂方法（`api.ts:333-359`）。
- `streaming-store.ts`（chat WS）**不动**。

### 6.4 关闭项目时的清理

- 各调用点 unmount 时 hook 自动 unsubscribe；无需 `clearProject`。
- bus store 不按 project 缓存业务数据，只持有订阅表，符合 AGENTS.md「store 不持有项目内业务数据」原则。

## 7. 错误处理矩阵

| 场景 | 行为 |
|------|------|
| bus ws 连接失败/断开 | bus-store 指数退避重连（1→2→5→10s 封顶 30s），重连成功重放订阅 |
| 服务端发非法 envelope | `parseBusServerMessage` 抛 → bus-store 吞掉 + debug 日志，不断连 |
| 客户端发非法/未知消息 | server 静默忽略 + debug 日志，不关连接 |
| `subscribe` 非法 projectId | server 静默忽略（不加入订阅表），debug 日志 |
| `subscribe` 非法 channel | 同上 |
| fs.watch 创建失败 | 回 `__system__`/`fs_watch_error`，不增加 refCount，该连接收不到 fs-watch 事件（其它通道不受影响） |
| 发送时 socket 已关闭 | `safeSend` 吞错 |
| 同一 key 重复 subscribe | 服务端 Set 去重（幂等），refCount 不重复增加 |
| 心跳 60s 无 pong | 主动 close 触发重连 |

## 8. 备选方案对比（为何不选通用 EventBus）

| 维度 | 方案 A（本设计） | 通用 EventBus（方案 C） |
|------|---------------|------------------------|
| 抽象对象 | WS 连接（多路复用器） | 事件本身 |
| 通道模型 | 封闭枚举，硬编码 3 个 | 开放注册，运行时可加 topic |
| 事件源归属 | 各 feature 自己持有（scheduler EventEmitter / ProjectFsWatcher / pino stream），bus 只桥接 | EventBus 统一持有所有事件源，feature 向它注册 |
| 进程内通信 | 不支持——bus 只管 WS 推送 | 支持——server 内部模块间也能 pub/sub 解耦 |
| 加新通道成本 | 改 envelope union + handler + 订阅逻辑 + client hook 调用点 | `bus.register(topic, schema)` 一处，自动获得 WS 能力 |
| 订阅过滤 | 按 `(projectId, channel)` 二元组 | 通常支持 topic / predicate / last-value 缓存等 |
| 测试面 | 测 3 个固定通道的行为 | 测通用注册/订阅/过滤/反压机制 |
| 投机性 | 只解眼前 3 通道的实际问题 | 为未来可能的大量通道铺路 |

**LOC delta 估算**（基于现有 handler 规模：`ws-schedule.ts` ~78 行、`ws-fs-watch.ts` ~45 行、`ws-debug.ts` ~43 行）：

C 比 A 多 **约 +600~900 行（产线 +300~500 + 测试 +300~450）**。要加 ~10 个新通道才回本。

**演进路径**：A 是 C 的真子集。未来如通道数到 6-8 个、或需进程内 pub/sub，把 `ws-bus.ts` 里的硬编码路由换成 registry 调度即可，不破坏 envelope/客户端协议。

## 9. 测试策略

| 层 | 测试内容 | 命令 |
|----|---------|------|
| server contract | bus client/server envelope parse + 各 channel type payload schema | `npm test --workspace=packages/server` |
| server integration | 订阅表增删、引用计数（acquire/release）、fs-watch 多订阅者共享单 watcher、schedule 事件桥接、debug 广播、close 清理无泄漏 | `npm test --workspace=packages/server` |
| app unit | bus-store 重连/重放/心跳、useBusSubscription 引用计数（首个 add 触发 subscribe、最后一个 remove 触发 unsubscribe） | `npm test --workspace=packages/app` |

**E2E**（按 AGENTS.md「E2E 验证选择」，涉及 server API + store + WebSocket）：

- 文件树相关：`e2e/file-tree.spec.ts`（fs-watch 订阅迁移）
- chat/session：`e2e/chat-session*.spec.ts`（确认 chat WS 未受影响）
- schedule 相关若存在则跑；project 恢复 / 路由相关各跑一条
- 合并前跑 `npm run verify:e2e`

## 10. 迁移清单

### 删除

- 服务端：`ws-fs-watch.ts`、`ws-schedule.ts`、`ws-debug.ts`、`contracts/websocket.ts` 中 `scheduleServerEvent`/`parseScheduleServerEvent`（迁到 `contracts/bus.ts`）
- 客户端：`api.ts` 的 `createScheduleWebSocket` / `createFsWatchWebSocket` / `createLogWebSocket`

### 新增

- 服务端：`ws-bus.ts`（连接 handler）、`fs-watcher.ts`（共享 watcher）、`contracts/bus.ts`
- 客户端：`stores/bus-store.ts`、`stores/useBusSubscription.ts`

### 修改

- `packages/server/src/index.ts:62-65`：四行 handler 注册改为 `handleChatWebSocket` + `handleBusWebSocket`
- `packages/app/src/App.tsx`：启动时 `busStore.init(baseUrl)`
- 4 个调用点（见 §6.3）
- `packages/app/src/lib/api.ts`：删 3 个工厂方法
- `packages/server/src/contracts/index.ts`：导出 bus contract 符号

### 回滚

单 PR 合并，revert 即完整回滚（无数据迁移、无持久化变更）。

## 11. docs 同步（按 AGENTS.md「docs/official 维护」）

- `docs/official/architecture.md:42`：三句「chat/fs-watch/schedule 各占一个 WS」描述改为 bus 架构
- `docs/official/project-structure.md:112-115`：`ws-*.ts` 文件清单更新
- `docs/dev/backlog.md:13`：StrictMode + WS effect cleanup 条目——bus store 单常开连接 + hook 自动订阅后可关闭（bus 不再受 StrictMode 双挂载影响；chat WS 仍是 streaming-store 内部资源，属另一议题，不在本次范围）
- 完成本 feature 后更新 backlog 对应条目

## 12. 影响面与风险评估

| 风险 | 评估 | 缓解 |
|------|------|------|
| 重连期间丢失 schedule/fs-watch 事件 | 中。客户端短暂断连时事件无法补发 | schedule 事件本身是「瞬时通知」（客户端 reconnect 后通过 HTTP refresh schedules/sessions 自愈）；fs-watch 事件丢失影响不大（debounce 300ms + 用户操作会触发新事件）。**不引入事件补发/last-value 缓存**（YAGNI） |
| 全局单连接故障影响多个通道 | 中。一条 ws 断了，3 个通道同时不可用 | 重连机制 + 重放订阅；故障窗口内各 feature 通过 HTTP 轮询/refresh 自愈（现有机制已如此） |
| StrictMode 双挂载导致 subscribe/unsubscribe 抖动 | 低。hook 自动管理 | bus-store 的 subscribe/unsubscribe 幂等（服务端 Set 去重），双挂载只会多一次无害 round-trip |
| 引用计数错乱导致 watcher 泄漏 | 低。acquire/release 全同步 | 单元测试覆盖「多次 acquire + 等量 release → refCount 归 0 → watcher close」 |
| debug 通道 envelope 变更破坏现有日志消费 | 低。debug 通道无外部消费者 | 仅 `LogPanel.tsx` 消费，同 PR 迁移 |
