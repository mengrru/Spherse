# UI SDK：createSession 返回 sessionId + open 参数与 sendMessage 静默发送

> 日期：2026-08-14
> 范围：`@spherse/sdk`（`createSession`/`sendMessage` API 表面）、`packages/app` ui-sdk handlers 与 ApiClient、`packages/server`（hub 共享 + HTTP 发送路由）、contracts、skill 文档。

## 背景与动机

当前 UI SDK 两个核心 action 的能力缺口：

1. **`createSession` 是 fire-and-forget 且必定跳转**。HTML 无法拿到新会话的 sessionId（无法后续 `sendMessage`/`openSession` 指向它），也无法「只创建不打开」。想做「后台会话」compose 模式（create → 静默 send）没有基础。
2. **`sendMessage` 必定跳转，且「发送」名不副实**。发送通道只有目标会话自己的 chat WS，而 WS 只在该会话被打开（主面板/浮窗 attach）时才存在；未打开时走 `setInitialMessage` 排队，等用户打开才真正发出（`send-message.ts`）。对后台自动化场景（HTML 面板静默驱动 agent）完全不可用。

## 用户 API

### `spherse.createSession(params)` → `Promise<{ sessionId: string }>`

从 fire-and-forget 改为 request-response：

```js
const { sessionId } = await spherse.createSession({
  agentId: "writer",   // 或 agentSlug（二选一，agentId 优先，现状不变）
  message: "...",      // 可选开场消息（排队语义，见下）
  open: false,         // 新增：省略 = 维持现状（跳转主面板 / float 浮窗）
  float: true,         // open: false 同时给时，open: false 优先
});
```

- 成功 resolve `{ sessionId: string }`；失败 reject（`agent_not_found` / `create_failed`）。
- `message` + `open: false`：保持现有排队语义——消息存 `initialMessageBySessionId`，等用户打开该会话时发出；不会后台自动执行。需要「创建即后台执行」时用 compose 模式：`await createSession({ open: false })` 后接 `await sendMessage({ open: false })`。
- 向后兼容：旧的不 await 用法依然工作（fire 侧无 requestId 时 `respond` 为 no-op）。

### `spherse.sendMessage(params)` → `Promise<void>`

```js
await spherse.sendMessage({ sessionId, message: "继续", open: false });
```

- 新增 `open: false`（省略 = 维持现状跳转）。
- **真正的静默发送**：移除 SDK 路径的 `setInitialMessage` 排队 fallback。目标会话已 attach（主面板/浮窗打开）→ 走 WS 快路径（乐观 UI 回显，现状不变）；未 attach → 走新增 server HTTP 发送路由，消息立即持久化并启动 agent run。
- resolve 永远意味着「已发出」。reject：`session_not_found` / `session_busy`（目标会话正在 run 中，含后台 run）/ `send_failed`（网络或 server 错误）。

### 参数规约（两者一致）

| 参数 | 类型 | 语义 |
|---|---|---|
| `open` | `boolean?` | 省略/`true` = 打开（跳转或浮窗）；`false` = 不做任何导航。与 `float` 同给时 `open: false` 优先 |

## Server 改动

### hub 实例提升

`ChatSessionHub` 实例从 `ws-chat.ts` 内部 `new` 提升到 `server/index.ts` 创建，作为参数传入 `handleChatWebSocket` 与 `registerSessionRoutes`。两条通道共享同一 channel（按 `projectId:sessionId` 去重），保证：

- HTTP 静默发送与会话已打开的 WS 使用同一 run 序列化（`channel.running`），不会双 run 冲突。
- 会话打开期间，后台发送的事件照常 fan-out 到 WS subscriber（浮窗/主面板实时看到流式）。

`ChatSessionHub` 类仅新增一个方法（其余零改动）：

```ts
async startDetachedRun(
  projectId: string,
  runtime: SessionManager,
  agentId: string,
  sessionId: string,
  content: string,
): Promise<void>
```

- `getOrCreateChannel` → `await channel.ready`（restore 失败 rethrow `NotFoundError`）；`channel.running` 时同步抛 `ConflictError`（检查与 `startRun` 内 `running = true` 在同一 tick，无竞态）。
- 随后 **不 await** 地调用 `this.startRun(...)`（detached）：run 启动即返回，调用方（HTTP route）立刻回 200。
- detached run 的 rejection 不再有人接：`.catch` 中 log 并向 channel subscribers `publish({ type: "error", message })`（best-effort，让恰好打开该会话的 UI 能看到失败，而非静默停止；无人订阅则仅日志）。

### 新路由

`POST /api/projects/:projectId/agents/:agentId/sessions/:id/messages`（与现有 GET messages 同路径，REST 配对）：

- body：`{ content: string }`（`sendMessageRequest` schema）。
- 调用 hub `startDetachedRun`；返回 `{ ok: true }`（fire-and-ack，与 WS 路径语义一致——run 内错误不回报给 HTTP 调用方，经 subscriber/日志呈现）。
- `NotFoundError` → 404；`ConflictError` → 409（沿用现有错误映射）。
- 无人订阅时事件照常产生并持久化，仅无 WS fan-out；run 结束后 `cleanupIfIdle` 照常销毁 channel。

### contracts

新增 `sendMessageRequest`（`{ content: string(minLength 1) }`）与 `sendMessageOkResponse`（`{ ok: boolean }`）schema，route 与 ApiClient 复用（遵守 API contract 规范，不新增裸 `JSON.parse`）。

## App 改动

### `ui-sdk/handlers/create-session.ts`

- 成功后 `respond(ctx, true, { sessionId: session.id })`。
- agent 解析失败 → `respond(ctx, false, { error: "agent_not_found" })`；store `createSession` 返回 null → `respond(ctx, false, { error: "create_failed" })`。
- `open === false` 时跳过 `openChat`。

### `ui-sdk/handlers/send-message.ts`

- session 存在性校验、`session_busy` 检查维持现状。
- WS 快路径（`wsSend` 返回 true）优先，维持现状。
- `wsSend` 返回 false 时改调 `client.sendMessage(agentId, sessionId, message)`（替代 `setInitialMessage`）；`agentId` 从 store sessions 列表查找（与存在性校验同源）。client 抛错 → `respond(ctx, false, { error })`：status 409 → `session_busy`，其它 → `send_failed`。
- `open === false` 时跳过 `openChat`。

### `lib/api.ts`

新增 `sendMessage(agentId: string, id: string, content: string): Promise<{ ok: boolean }>`——POST 上述路由。现有 `assertOk` 丢弃 status code，此方法需区分 409：非 2xx 时抛携带 `status` 的 Error（本地小错误类或挂 `status` 属性），供 handler 映射 `session_busy` / `send_failed`。

## SDK 改动（`packages/sdk`）

- `src/runtime/actions.ts`：
  - `createSession` 从 `fire` 改为 `call`，返回 `Promise<{ sessionId: string }>`。
  - `sendMessage` 保持 `call`。
  - 两者 params 增加 TS 类型定义（`CreateSessionParams` / `SendMessageParams`），导出供 HTML 作者参考。
- 重建 bundle（`packages/sdk/scripts/build.mjs` → `dist/browser.js` + `dist/source.js`）。

## Skill 文档

- `packages/presets/skills/use-ui-sdk/SKILL.md`：
  - `createSession` 小节：标注返回 `Promise<{ sessionId }>`、`open` 参数、reject 错误码；补「后台会话」compose 模式示例（`await createSession({ open: false })` → `await sendMessage({ open: false })`）。
  - `sendMessage` 小节：补 `open` 参数与静默语义（未打开会话经 server 直接执行，不再排队）。
  - API 总表更新两行（createSession 移入请求型）。
- `packages/presets/skills/write-html/SKILL.md`：快查表补「后台创建/驱动会话」场景。

## 测试

- **server**：route 单测——200（消息持久化 + run 启动、响应不等 run 完成）、409（channel running）、404（未知 session）；`startDetachedRun` 单测——detached run 失败时 log + subscriber 收到 error 事件、running 检查抛 ConflictError；hub 共享断言（WS attach 后 HTTP 发送复用同一 channel，事件到达 WS subscriber）。
- **app handlers**：`create-session.test.ts`（respond 带 sessionId、open: false 不导航、失败 reject）；`send-message.test.ts`（WS 快路径、HTTP fallback、open: false 不导航、busy 映射）。
- **sdk**：`actions.test.ts`（createSession 走 `call`）。
- `npm run verify`；SDK bundle 重建后确认 `packages/sdk/dist` 重新生成。

## 涉及文件清单

| 层 | 文件 |
|---|---|
| sdk | `packages/sdk/src/runtime/actions.ts`、bundle 重建 |
| app | `packages/app/src/ui-sdk/handlers/create-session.ts`、`send-message.ts`、`packages/app/src/lib/api.ts` |
| server | `packages/server/src/index.ts`、`ws-chat.ts`、`routes/sessions.ts`、`chat-session-hub.ts`（仅新增 `startDetachedRun`）、contracts |
| 文档 | `packages/presets/skills/use-ui-sdk/SKILL.md`、`packages/presets/skills/write-html/SKILL.md` |

## 不改动

`ChatSessionHub` 既有方法与 `startRun` 内部逻辑、`streaming-store` 的 WS 发送逻辑、`project-data-store` 的 `createSession`/`setInitialMessage`（后者仍服务 composer/其它调用方）、core 层。
