# Server 层架构

> 覆盖：Fastify 组合根与生命周期、鉴权模型、路由域与错误映射、WebSocket（chat 挂载 + 全局 bus）、preview、data 路由与日志。
> core 侧机制见 [core.md](core.md)；chat WS 协议与会话链路见 [chat.md](chat.md)；contract 文件组织与绑定规范见 `packages/server/README.md`。
> desktop 侧的启动与 token 重建链见 [desktop.md](desktop.md)。

## 组合根与生命周期

- `createMultiProjectServer({ defaultModel?, sampling?, thinkingLevel?, auth?, port?, modelCatalog?, appVersion? })` 创建单实例，返回 `{ fastify, registry, logger }`
- 初始化顺序：logger → appVersion → Fastify（debug 级 + query redact）→ CORS → websocket → multipart（5MB）→ 错误处理器
  - 之后：ProjectRegistry → ChatSessionHub → auth hook → 全部路由 → chat / bus WS handler
- **端口**：默认固定 53972、只绑 `127.0.0.1`；`EADDRINUSE` 才回退 OS 随机端口
- desktop 启动链：`app.whenReady` → `ensureServer()` → 重放已注册项目
  - `ensureServer` 以 settings 的 model/sampling/thinkingLevel、mobile token、`getAppModelCatalog()` 单例与 app 版本建服务
  - token 变更时 removeAll → close → 以新 token 重建
- shutdown：tunnel stop → `registry.removeAll()`（allSettled）→ `fastify.close()`

## ProjectRegistry

- 维护 `Map<projectId, ProjectContext>`；ctx 为 `Object.freeze` + getter——`runtime`、`projectId`，转发 `projectManager` / `sessionRuntime` / `triggerManager`
- `register` 按 resolved root 去重复用已有 ctx，pending Promise 去重防并发注册
- projectId 冲突（复制目录）时改写副本的 `project.yaml`（log warn，不中断；重新生成 8 位 nanoid）
- `setDefaultModel` / `setSampling` 向所有已注册项目 fan-out
- modelCatalog 注入链：desktop main 单例 → `CreateServerOptions` → registry → 每项目 `createProject`；未注入时 registry 兜底自建（desktop 链路不会走到兜底）

## 鉴权模型

- 安全模型 = **loopback 绑定 + （tunnel 暴露公网时的）access token**；从未配置 mobile access 时无 token，auth hook 不注册，所有端点仅靠 loopback 保护
  - 注意：`disable` 只置 `enabled: false` 不清 token——启用过再禁用的项目 token 鉴权仍然生效
- 配置 token 后保护 `/api/*` 与 `/ws/*`；公开路径仅 `/health` 与 `/api/connection/info`
- token 呈现：
  - HTTP：`Authorization: Bearer` → query `token` → preview 路径 token（`/preview/__auth/<token>/...`，为 iframe/img 等无法带 header 的场景设计）
  - WS：只接受 query `token`
  - 比较用 `timingSafeEqual`
- token 来源：desktop electron-store 的 mobileAccess 配置，`crypto.randomBytes(32)` 生成；quick 模式经 Cloudflare tunnel 把 loopback 端口穿隧道
- CORS 反射任意 Origin，未开 credentials

## 路由

16 个域文件由 `routes/index.ts` 聚合注册；项目级路由统一 `/api/projects/:projectId/...`，全局 preHandler 从 registry 解析并注入 `req.projectCtx`（miss 抛 404）：

| 域 | 端点概要 |
|---|---|
| connection | 全局：连接信息、项目列表；项目级：项目 info |
| agents / agent-write | agent 列表/详情/raw/theme；创建、更新、删除 |
| agent-mcp | agent 的 MCP 连接器配置读写 |
| sessions | 项目级批量会话目录、agent 级列表、创建、详情、messages GET/POST、status、rename、删除 |
| content | stat、文件/目录的读写删建 |
| data | `/data/read` `/mutate` `/raw-set` `/raw-delete` |
| settings | 全局：文本与图片 provider 目录；项目级：ai-access / welcome-page / theme |
| preview | 预览文件服务（见下节） |
| skills / marketplace | skill 列表/详情/创建/zip 安装；市场 manifest 代理与远程安装 |
| file-tree | UI 用文件树（过滤 dotfile / node_modules / .git / .spherse） |
| trigger | CRUD、手动触发、reset-binding、运行日志 |
| debug | turn-context 导出 |
| images / attachments | 生成图片导出；附件上传（png/jpeg/webp，5MB）与删除 |

**错误映射**（全局 errorHandler）：

- core 错误：`NotFoundError`→404、`ValidationError`→400、`AccessDeniedError`→403、`ConflictError`→409
- Fastify schema 校验失败→400；兜底 500；未知路由 404
- data 域本地映射：VersionConflict→409（带 currentVersion）、DataFileCorrupted→422 等
- marketplace 网络失败统一 502

## contracts 机制

契约进代码的由来见 [ADR-0007](../../dev/decisions/0007-contracts-in-code.md)。

- `@spherse/contracts` 独立包导出：聚合 `schemas`、`parseContract` / `parseApiResponse`、全部 `Static<>` 类型、chat WS 与 bus 的 parser（server 与 renderer 共同依赖，定位与规则见 [contracts README](../../../packages/contracts/README.md)）
- 两种绑定机制（选用规则见 server README）：Fastify `schema` option（驱动 fast-json-stringify + Ajv，约 51 处）与 handler 内 `parseContract`（含 pi 复杂嵌套对象的端点，约 16 处）
- renderer 的 `parseApiResponse` 是同一 `parseContract` 在客户端的别名——server route、WS 边界、API client 复用同一套 schema

## WebSocket

- **bus（`/ws/bus`）**：全局多路复用，通道 `trigger` / `agent` / `fs-watch` / `debug` + 系统 `__system__`（pong、watch 错误）
  - client→server：`subscribe` / `unsubscribe`（按 `(projectId, channel)`）、`ping`、`emit-trigger-event`
  - 非法消息 debug 日志丢弃；连接关闭释放全部订阅
- **debug 日志流**：`createServerLogger` 用 pino multistream——pretty transport 之外，debug bus stream 把每行日志包成 debug 通道事件广播
  - Debug Tools 的 Streaming Log 无独立 WS，即消费 bus 的 debug 通道
- **fs-watcher**：按项目引用计数的共享 `fs.watch`（recursive），多订阅者共享 1 个 OS watcher，listeners 归零才 close
  - 过滤决策基于 core `categorizePath` 的 watched-category 集合：userFiles / rootIndex / changelog / projectConfig / projectTheme / agentTheme / skills
  - `node_modules` / `.git` 任意路径段降噪
- **chat（`/ws/projects/:projectId/chat/:agentId/:sessionId`）**：server 侧只做挂载、registry miss 关闭、hub attach 与出入站 contract 校验——协议与生命周期见 [chat.md](chat.md)

## preview 路由

- 服务 31 种扩展名（html/css/js/json、图片、字体、音视频），白名单外 403
- 非响应体的白名单文件（含 css/js/json 等非 HTML 文件）都走 Range 分支：206 + `Accept-Ranges: bytes`、ETag + `If-None-Match` 304
- **SDK 短路**：任意目录层级下文件名为 `__spherse-sdk.js` 的请求先于访问策略直接返回 `SDK_SOURCE`——保证注入的 `<script src>` 永远可达（见 [ui-sdk.md](ui-sdk.md)）
- HTML 响应注入 SDK `<script>` 标签（幂等标记）
- 访问策略走 `serverAccessPolicy.assertRead`；`__auth/:token/` 前缀与鉴权模型配合

## data 路由

- 4 个 POST 端点全部 `schema.body` + handler 内 `parseContract` 双重绑定，委派 `runtime.dataStore`
- 与 agent 的 `read_data` / `mutate_data` 工具共享同一 DataStore 实例与 FileWriteMutex——SDK 写入与 LLM 写入在同一把锁上串行
- mutate 带 `origin: "sdk"` 与可选 `idempotencyKey`；乐观并发用 `ifVersion`

## 访问策略白名单（server 端）

- **read**：userFiles / rootIndex / changelog / projectTheme / generatedImages / attachments / skills / agentTheme / agentSkills / agentAssets
- **write**：userFiles / rootIndex / changelog / projectTheme / attachments / skills / agentSkills
- 全部经 core `serverAccessPolicy`（见 [security.md](security.md)）；capability 私有路径（pathRules）对 server 不可写，开放需经 PM 门面

## 日志

- `createServerLogger`：pino debug 级，multistream 输出 pretty transport 与 debug bus stream
- Fastify req serializer 把 query 重写为 `?<redacted>`（token 不落日志）；preview 响应有专项 onResponse info 日志
