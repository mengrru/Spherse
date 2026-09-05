# @spherse/server

Fastify API 层，为 Spherse 桌面应用提供多项目 HTTP + WebSocket 服务。在 Electron main process 中以固定默认端口 `53972` 绑定 `127.0.0.1` 启动（`EADDRINUSE` 时回退 OS 随机端口）。HTTP / WS 边界的 schema 与 parser 定义在独立包 `@spherse/contracts`，server 与 renderer 共同依赖。

## Routes & Contracts 规范

### 文件组织（一一对应）

`@spherse/contracts` 的 `src/` 与本包 `routes/` 按业务域同名文件一一对应；新增域时在新包 `src/index.ts` 追加 import / spread / type re-export。schema 定义规范（命名、`Type.Optional`、`Type.Unknown` 约束等）见 [`packages/contracts/README.md`](../contracts/README.md)。

`src/` 目录按域而非按层组织：内聚的 WS 域收进域目录（`chat/`——hub/channel/projector/ws-chat/classify-run-error，对外只经 `chat/index.ts` 导出 `handleChatWebSocket` + `ChatSessionHub`，channel/projector 是内部实现；`bus/`——ws-bus 端点 + fs-watcher，对外只经 `bus/index.ts` 导出 `handleBusWebSocket`）；唯一按角色分组的例外是 `middlewares/`（auth/cors/host-guard 三件套——Fastify onRequest 请求边界防护，仅由 `index.ts` 装配点引用）。不设 `services/`、`ws/` 等其余通用层目录：跨域共享的有状态编排留顶层（`registry.ts`、`marketplace.ts`），无依赖纯工具进 `lib/`（`debug-sink.ts`），单文件域不开目录、长胖再升级为域目录。

### Route 绑定规范

每个 JSON route **必须**通过 contract schema 绑定边界，按以下优先级选择机制：

1. **Fastify `schema` option（首选）** —— 同时驱动 fast-json-stringify（出站）和 Ajv（入站 body）校验：

   ```ts
   fastify.post<{ Params: {...}; Body: AgentCreateRequest }>(
     "/api/projects/:projectId/agents/create",
     {
       schema: {
         body: schemas.agentCreateRequest,
         response: { 200: schemas.agentCreateResponse },
       },
     },
     async (req) => { ... },
   );
   ```

   - 所有含 body 的 route 绑定 `schema.body` + `schema.response`
   - 所有 JSON GET route 绑定 `schema.response`（包括看似"简单"的列表/对象）
   - Fastify 的 `Body` 泛型仍需手写（Fastify 的 TS 类型不读 `schema.body`），且必须与 contract 的 `Static<>` 类型一致

2. **`parseContract()` in handler（用于 pi-agent 复杂嵌套对象）** —— 当响应含 `Type.Unknown()` 字段且不希望被 fast-json-stringify 序列化时丢字段/报错，改在 handler 内手动 parse：

   ```ts
   fastify.get("/api/projects/:projectId/agents/:agentId/sessions/:id/messages",
     async (req) => {
       const messages = req.projectCtx!.projectManager.getSessionHistory(...);
       return parseContract(schemas.sessionMessagesResponse, messages);
     },
   );
   ```

   当前覆盖（含 pi 复杂嵌套对象或需要 handler 内双重校验的端点）：sessions 全部读端点、skills 创建/install、content 目录与读取、debug turn-context、marketplace install、data 四个 body。其余 route 一律用机制 1。

3. **WebSocket** —— 不走 Fastify schema，收到的 JSON 必须通过 contract parser 校验，非法消息返回统一 error event：

   ```ts
   import { parseChatClientMessage, parseChatServerEvent } from "@spherse/contracts";
   const msg = parseChatClientMessage(rawJson);  // 抛 Error 即边界非法
   ```

### 错误处理规范

route handler **统一通过 throw 表达错误**，不手写 `reply.code(xxx).send({ error })`。全局 `setErrorHandler`（`index.ts`）按 error 类型自动映射 HTTP 状态码，保证响应体始终为 `{ error: string }`。

错误来源：server `errors.ts` 的 `HttpError`（自带状态码）、`@spherse/core` 的语义错误（`NotFoundError`/`ValidationError`/`AccessDeniedError`）、Fastify schema 校验失败、兜底 500。具体映射见 `index.ts` 的 `setErrorHandler`。

```ts
// ✅ 正确：throw 表达错误，全局 handler 映射状态码
async (req) => {
  const session = projectManager.getSession(agentId, id);
  if (!session) throw notFound("Session not found");
  return session;
},

// ❌ 错误：手写 reply.code().send()
async (req, reply) => {
  const session = projectManager.getSession(agentId, id);
  if (!session) return reply.code(404).send({ error: "Session not found" });
  return session;
},
```

**`response` schema 只声明 2xx**：非 2xx 响应由全局 error handler 统一生成（格式固定为 `{ error: string }`），不受 route 的 `schema.response` 约束，因此 route 内无需声明错误状态的 response schema。

```ts
// ✅ response 只声明成功状态码
schema: {
  body: schemas.createSessionRequest,
  response: { 200: schemas.createSessionResponse },
}

// ❌ 不要声明错误状态码
schema: {
  body: schemas.createSessionRequest,
  response: {
    200: schemas.createSessionResponse,
    400: schemas.errorResponse,  // 多余，全局 handler 已处理
    404: schemas.errorResponse,  // 多余
  },
}
```

**新增错误类型**：core 的语义错误（NotFound/Validation/AccessDenied）覆盖了绝大多数场景。若需要新的 HTTP 语义（如 409 Conflict），在 server `errors.ts` 添加 `HttpError` 工厂函数，不要在 core 引入 HTTP 概念。

### 二进制 / 非 JSON route（豁免）

以下 route 不绑 schema，返回类型由 `reply.type(...)` 决定：

- `routes/agents.ts` 的 `GET .../agents/:id/theme` —— 返回 `text/css`
- `routes/preview.ts` 全部 —— 返回 html/image/font 等，给 iframe/img 用

### Renderer 消费规范（`@spherse/app`）

renderer 的 `packages/app/src/lib/api.ts` 对每个响应统一走 `parseApiResponse(schema, json)`，不裸 `res.json()`。返回类型用 contract 的 `Static<>` 派生类型（经 `app/src/lib/types.ts` re-export 加 app 友好别名）。

## 子入口

```
@spherse/server           # → dist/index.js  (createMultiProjectServer、ProjectRegistry)
@spherse/contracts        # 独立包 → schemas、parser、类型（server 与 renderer 共同依赖）
```

## 开发

```bash
npm run dev --workspace=packages/server    # tsc --watch
npm test --workspace=packages/server      # vitest（含 WS 集成测试）
npm run lint --workspace=packages/server  # eslint
```

新增 / 修改 schema 的契约测试要求见 [`packages/contracts/README.md`](../contracts/README.md)。
