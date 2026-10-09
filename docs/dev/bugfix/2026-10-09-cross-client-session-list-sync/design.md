# 修复跨端 session 列表不同步（移动端新建/删除/重命名后桌面端不刷新）

- 日期：2026-10-09
- 状态：已实施（lint、typecheck、core/server/app/contracts 测试通过）
- 类型：bugfix（事件广播缺失）
- 影响范围：`packages/contracts`（bus 协议）、`packages/core`（SessionStore/AgentStore/ProjectStore/ProjectManager）、`packages/server`（ws-bus）、`packages/app`（bus-store、bus refresh hook）

## 1. 问题

在移动端（web 版）新建或删除 session 后，桌面端的 session 列表不更新；重命名同样不同步。反向（桌面改、移动端看）亦然。

## 2. 根因分析

- 移动端与桌面端连的是**同一个 server 实例**（桌面主进程启动 server，移动端经 Cloudflare tunnel 指向同端口），读写同一 `sessions.db`，数据本身一致——问题只在客户端缓存失效。
- session 列表加载是纯 REST（`GET /api/projects/:projectId/sessions`）+ react-query 缓存，`staleTime: Infinity` 且无轮询、无 focus refetch（`packages/app/src/queries/client.ts`）。
- `/ws/bus` 只有 `trigger` / `agent` / `fs-watch` / `debug` 四个 channel。session 的写路径（`SessionManager.createSession`、`ProjectManager.renameSession`、`ProjectManager.deleteSession`）**均无事件广播**，其他客户端无从得知缓存已过期。
- 既有补偿路径只覆盖三种情形：agent 增删（`agent_updated`）、trigger 完成（`trigger_completed`，trigger 运行会在 server 侧建 session）、bus WS 断线重连（`useReconnectedSync`）。用户手动跨端操作不在其列。
- 重命名额外确认两点：`renameSession` 无 emit；即便收到 `agent_updated`，`useAgentBusRefresh` 也只对 `created`/`deleted` action 刷新 session 列表，`updated` 不刷新。

## 3. 方案

完全镜像既有 `agent_updated` / `agent` channel 模式，新增 session 变更事件通道：

| 层 | 改动 |
|---|---|
| contracts `bus.ts` | `busClientChannel` 加 `"session"`；`busServerMessage` 加 `session_updated` envelope（payload：`{agentId, sessionId, action: created|updated|deleted}`，重命名归 `updated`）；导出 `SessionUpdatedEvent` |
| core `store/session.ts` | 定义 `SessionChangePayload`/`SessionChangeAction`；`SessionStore` 构造注入 `onSessionChange` 回调，`createSession` / `updateSessionTitle` / `archiveSession` 在实际写库后触发（UPDATE 以 `changes > 0` 判断，未命中不触发） |
| core `store/agent-store.ts` | 构造参数透传回调给惰性创建的 `SessionStore` |
| core `store/project.ts` | `loadAgents` / `createAgent` 创建 AgentStore 时把回调接到 `this.emit("session_updated", payload)`（与 `agent_updated` 同一 emitter，事件在数据变更发生地发出，未来任何走 store 的写路径自动覆盖） |
| core `project-manager.ts` | 新增 `onSessionChange` / `offSessionChange` 订阅门面（镜像 `onAgentChange`）；`index.ts` 导出新类型 |
| server `ws-bus.ts` | `BusChannel` 加 `"session"`；subscribe/unsubscribe/close 生命周期处理，转发为 `session_updated` envelope |
| app `bus-store.ts` | `BusChannel` 加 `"session"` |
| app `useAgentBusRefresh.ts` | 新增 `useSessionBusRefresh`（订阅 `session` channel → `refreshProjectSessions`），挂载于 `ProjectScope`；web/desktop 共享同一代码，两端同时生效 |

设计取舍：

- 发起方也会收到自己操作的广播，invalidate 后重拉数据一致，幂等无害，不做去重。
- 聊天消息追加会 bump `updatedAt`（影响列表排序），但不纳入本次广播——每条消息都广播过于chatty，且超出本 bug 范围；跨端观看中的列表排序陈旧留作已知限制。
- 事件从 store 层而非 manager 层发出：三个写入口（REST 路由、trigger executor、UI SDK）最终都收敛到 `SessionStore`，在收敛点 emit 可避免未来新写路径漏广播。

## 4. 测试

- contracts：`bus-contracts.test.ts` 加 session envelope 接受/拒绝（未知 action、缺 sessionId）+ subscribe/unsubscribe channel 枚举。
- core：新增 `project-manager-session-events.test.ts`（真实 ProjectStore + ProjectManager）：created/updated/deleted 事件、store 层未命中不触发、offSessionChange 停止投递、订阅后新建 agent 的事件也投递。
- server：`ws-bus.test.ts` 加 session channel（转发 envelope、退订停止、未知 projectId 静默）；新增 `session-change-events.test.ts` 真实 runtime 契约测试（真实路由 POST/PATCH/DELETE → `onSessionChange` 收到对应 action，不 mock 被测门面）。
- 全量：core 107 files / 1313 tests、server 39 files / 350 tests、app 164 files / 1343 tests、contracts 76 tests 通过；lint、typecheck 通过。
- E2E：跨端同步需双浏览器上下文，现有 e2e 无此场景基建，未新增；手动验证建议——桌面端开 session 列表，移动端新建/重命名/删除，桌面端列表应在秒级内刷新。

## 5. 不受影响的部分

- 单 client 内的乐观更新（`createProjectSession` 等 mutation 本地 `setQueryData`）行为不变。
- `agent_updated` / `trigger_completed` / 断线重连三条既有刷新路径不变。
- per-session 聊天流 WS（`/ws/projects/:projectId/chat/...`）不涉及列表，不变。
