# 单服务器多项目重构

## 背景与现状

### 当前架构：每个打开的项目启动一个独立的 Fastify 实例

`electron/server.ts` 维护 `Map<projectPath, { server, port, engine }>`，每打开一个项目就调用 `@spherse/server` 的 `createServer(projectRoot)` 创建一个全新的 Fastify 实例，监听在一个随机临时端口上。每个实例都各自：

- 注册 `@fastify/cors`、`@fastify/websocket` 插件
- `createEngine(projectRoot)` 创建一套独立的 `Engine` + `ProjectStore` / `SessionStore` / `AgentProfileStore` / `SkillStore` / `Scheduler` / `FileWriteMutex`
- 创建独立的 pino root logger（含 2 个 `pino-pretty` worker thread transport + 1 个 debug Writable stream）
- 注册全部 HTTP 路由和 4 个 WebSocket 端点（`/ws/chat`、`/ws/fs-watch`、`/ws/debug`、`/ws/schedule`）

路由中**不包含任何项目标识**——项目归属完全由「连到哪个端口」隐式决定。renderer 为每个项目持有 `port`，`createApiClient(port)` 把所有 URL 拼成 `http://localhost:${port}`。

设置同步（默认模型）通过 `updateDefaultModel()` 遍历所有 server 的 engine 实现。

### 现状带来的问题

| # | 问题 | 说明 |
|---|------|------|
| 1 | **资源开销随项目数线性增长** | N 个项目 = N 个 Fastify 实例、N 套 cors/websocket 插件、N 个 pino-pretty（每个起 worker thread）、N 个 fs.watch、N 个 Scheduler。即便 N=3~5，worker thread 与监听 socket 数量也明显偏多 |
| 2 | **端口管理负担** | 每个项目占用一个临时端口，renderer 必须为每个项目追踪 port，IPC 也要回传 port；端口越多越难排查占用 |
| 3 | **设置同步需手动遍历** | `updateDefaultModel()` 要 loop 所有 server；provider key 靠 `process.env` 隐式共享，但 defaultModel 这种 engine 内部状态要逐个同步，未来再加跨项目设置会更繁琐 |
| 4 | **Debug 日志割裂** | 每个项目有独立的 `/ws/debug` 和 debug stream，前端 Debug Streaming Log 面板只能看到当前连接项目的日志，无法聚合 |
| 5 | **架构心智负担** | 「一个项目一个服务」是单项目 MVP 时期遗留的模型，多项目 feature 用 Map 硬扩展，并非刻意设计。multi-project design 文档已把「Single-server multi-engine refactor」显式列为 backlog |
| 6 | **启动串行** | `restore-projects` 串行地为每个持久化项目 `startServer`，N 个项目启动时间是 N 倍单项目 |

## 方案讨论

### 选项 A：保持多 server（现状）

维持每个项目一个 Fastify 实例。

- 优点：零改动、零回归风险；天然的项目级故障隔离（一个项目的异常不会拖垮其它项目的 server）
- 缺点：上述 6 个问题全部保留；随项目数增长问题放大

### 选项 B：单一 server + URL 路径前缀做项目隔离 ✅ 选定

启动**一个** Fastify 实例承载所有项目。引入 `ProjectRegistry`（`Map<projectId, ProjectContext>`），所有路由与 WebSocket 统一加 `/api/projects/:projectId/...` 前缀，通过 Fastify `preHandler` 钩子把 `projectId` 解析为对应 `ProjectContext` 注入请求。

- 优点：1 套插件、1 个 logger、1 个 debug 流（可按 projectId 过滤/聚合）、设置集中同步、1 个监听端口、心智模型清晰、为未来跨项目特性（共享 skill/agent 模板）打基础
- 缺点：改动面大（contracts、全部路由、全部 WS handler、前端 api client、IPC、preload、stores）；需要稳定的 projectId 方案；丧失「端口级」故障隔离（但均在同一 Electron 进程内，隔离本就很弱）

### 选项 C：单一 server + Header 做项目隔离

用 `X-Spherse-Project` header 标识项目，路由路径不变。

- 优点：HTTP 路由几乎不变
- 缺点：WebSocket 设置 header 不便；项目维度不可见（日志/调试不直观）；不利于缓存与可观测；不符合 REST 资源建模

### 结论

采用 **选项 B**。理由：B 在可观测性、资源效率、设置同步、心智模型上都明显优于 A，且与 multi-project design 预留的 backlog 方向一致；C 在 WebSocket 场景下体验差且不符合资源建模。B 的改动面虽大但边界清晰、可分阶段推进（见「实施分阶段」）。

故障隔离的顾虑在本地 Electron 桌面应用场景下可接受：所有 server 本就跑在同一进程，单实例后仍可通过 `try/catch` + Engine 自身的错误处理保证一个项目异常不中断请求循环；真正需要强隔离（如多租户）不在本产品范围。

## 选定方案详细设计

### 1. 项目标识：稳定的 projectId

需要一个**跨重启稳定、跨路径变化稳定、URL 安全**的 project ID，作为 registry key 和 URL 路径段。

#### 1.1 id 存储位置：`.spherse/project.yaml`

id 属于项目自身的属性，而非「app 对项目的视图」的属性，因此**存入项目目录的 `.spherse/project.yaml`**，由 `@spherse/core` 在 `ProjectStore` 中生成与持久化。这样项目被移动目录、或在另一台机器上重新打开，身份都保持不变。

具体改造（core 层）：

- `ProjectConfig`（`packages/core/src/types.ts`）新增 `id: string` 字段
- `ProjectStore.create()`（`store/project.ts:61`）：生成 8 位随机 token（如 `nanoid(8)` 或 base36），写入 `project.yaml` 的 `id`
- `ProjectStore.open()`（`store/project.ts:87`）：读取 `project.yaml` 中的 `id`
  - 若已有 `id`：直接使用
  - 若无 `id`（兼容旧项目）：生成新 id 并回写 `.spherse/project.yaml`
- `createEngine()`（`factory.ts:12`）已调用 `open/create`，把 `id` 一并返回给上层：`Promise<{ engine, projectStore, projectId }>`

Electron 层首次打开项目成功后，从 `createEngine` 返回值拿到 `projectId`，用于 registry 注册、`OpenProjectEntry` 记录、renderer 路由 key。

#### 1.2 冲突处理：复制目录导致 id 相同

用户复制整个项目目录后两个目录 `project.yaml` 有相同 id，同时打开会撞 registry key。处理策略：**静默改写副本的 id**。

- `registry.register(projectId, projectRoot)` 检测到 `projectId` 已存在时，生成新 id，通过 `ProjectStore` 回写**当前被打开目录**的 `project.yaml`（不触碰已注册的原项目），用新 id 注册
- 这是安全的：核对了所有「按 projectId keying 的数据」均不会因 id 改写被破坏——
  - `electron-store` 的 `openProjects` / `lastActiveProject` 按 `path` 索引，不按 id
  - `localStorage` 的 `spherse:floating-chat:<projectId>` 副本拿新 id 命中空态、从零启动（符合预期）
  - `spherse:draft:<sessionId>` 按 sessionId 索引，与项目身份无关；若连 `.spherse/` 一起复制导致 sessionId 碰撞，是现状多 server 架构就存在的预存问题，不在本次范围
  - provider key / defaultModel 全局共享或存于项目自身 yaml，均不与项目身份耦合
- 静默改写只作用于被打开的那个目录，原项目与已注册 entry 不受影响

#### 1.3 与 projectKey 的关系：统一为 projectId

现有的 `projectKey`（`src/lib/project-key.ts`）基于目录名生成，靠 `createProjectKey` 做「同名加 `-2`/`-3` 后缀」去重。一旦 id 由 core 生成且保证唯一，这套碰撞逻辑即为多余复杂度。

**统一为单一身份**：renderer 路由 `/project/:projectId` 直接使用 project.yaml 中的 id 作为 URL 段，删除 `project-key.ts` 及 app-store 中的 collision 处理。

- 全链路（core → server → IPC → renderer 路由 → localStorage key）只有一个身份概念：`projectId`
- URL 不再可读（`#/project/a8f3k2x9/...`），但这是本地 hash router、URL 不分享，可读性收益≈0
- 前提：registry 注册时强制 id 唯一（接 §1.2 冲突改写）

### 2. Server 生命周期与 ProjectRegistry

#### 2.1 单实例启动时机

`app.whenReady()` 后、创建窗口前，启动**唯一** Fastify 实例（监听固定端口或 `port: 0` 后通过 IPC 把端口告知 renderer）。项目打开/关闭只操作 registry，不再 create/close Fastify。

#### 2.2 ProjectRegistry（新增，位于 `@spherse/server`）

```ts
interface ProjectContext {
  engine: Engine;
  projectStore: ProjectStore;
  fileWriteMutex: FileWriteMutex;   // 仍按项目隔离
}

class ProjectRegistry {
  register(projectId: string, projectRoot: string, opts): Promise<ProjectContext>;
  get(projectId: string): ProjectContext | undefined;
  remove(projectId: string): Promise<void>;   // engine.shutdown() + sessionStore.close()
  has(projectId: string): boolean;
  list(): string[];                            // 已注册 projectId 列表
}
```

- `register` 内部调用 `createEngine(projectRoot, { logger: rootLogger.child({ projectId }), defaultModel })`，并初始化该项目的 Scheduler（保持 per-project Scheduler，避免跨项目任务耦合）
- `remove` 调用 `engine.shutdown()`，关闭该项目的 session DB 与 watcher

#### 2.3 `createServer` 改造

`packages/server/src/index.ts` 的 `createServer(projectRoot)` 改为 `createMultiProjectServer(options)`：

- 创建单一 pino root logger（pretty transport + 单一 debug stream）
- 创建单一 Fastify 实例，注册 cors / websocket 一次
- 持有 `ProjectRegistry` 实例
- 路由注册改为接收 `registry` 而非单个 `ctx`

### 3. 路由改造：路径前缀 + preHandler 注入

#### 3.1 统一前缀

所有业务路由统一加 `/api/projects/:projectId` 前缀：

| 现在 | 改造后 |
|------|--------|
| `GET /api/agents` | `GET /api/projects/:projectId/agents` |
| `POST /api/agents/:agentId/sessions` | `POST /api/projects/:projectId/agents/:agentId/sessions` |
| `GET /api/content/*` | `GET /api/projects/:projectId/content/*` |
| `GET /api/file-tree` | `GET /api/projects/:projectId/file-tree` |
| `GET /api/settings/ai-access` | `GET /api/projects/:projectId/settings/ai-access` |
| `GET /api/debug/sessions/:id/turn-context` | `GET /api/projects/:projectId/debug/sessions/:id/turn-context` |
| `GET /api/preview/*` | `GET /api/projects/:projectId/preview/*` |
| ……（agents/agent-write/sessions/content/settings/preview/skills/file-tree/debug/schedules 全部） | |

应用级（非项目级）端点，如 `GET /api/settings/providers`（provider catalog 是全局的），保持**不带** projectId。

#### 3.2 preHandler 解析

在 `registerAllRoutes` 注册一个作用于 `/api/projects/:projectId/*` 的 `preHandler`：

```ts
fastify.addHook("preHandler", async (req, reply) => {
  const { projectId } = req.params as { projectId?: string };
  if (projectId) {
    const ctx = registry.get(projectId);
    if (!ctx) return reply.code(404).send({ error: "Unknown project" });
    (req as any).projectCtx = ctx;   // 注入到请求
  }
});
```

每个路由处理器从 `req.projectCtx` 取 `engine` / `projectStore` / `fileWriteMutex`，替换当前闭包里的 `ctx.engine` 等。这样各路由文件签名从 `(fastify, ctx)` 变为 `(fastify, registry)`，内部读 `req.projectCtx`。

> `AppContext` 类型保留为「单项目上下文」概念（engine + projectStore + fileWriteMutex），但不再在 `createServer` 顶层创建，而是由 registry 在 `register` 时产出。

### 4. WebSocket 改造

WebSocket 同样用路径前缀区分项目：

| 现在 | 改造后 |
|------|--------|
| `/ws/chat/:agentId/:sessionId` | `/ws/projects/:projectId/chat/:agentId/:sessionId` |
| `/ws/fs-watch` | `/ws/projects/:projectId/fs-watch` |
| `/ws/schedule` | `/ws/projects/:projectId/schedule` |
| `/ws/debug` | `/ws/debug`（**全局，不按项目**） |

- chat / fs-watch / schedule handler 在连接时从 URL params 解析 `projectId`，从 registry 取 ctx；未知 projectId 直接关闭连接
- **debug 端点保持全局单一**：所有项目的日志写入同一个 debug stream，每条日志带 `projectId` 字段，前端 Debug 面板可按项目过滤/聚合（这是相比现状的明显增强）

### 5. Logger / Debug 流

- 单一 pino root logger，注册一次 pretty transport + 一个全局 debug stream
- 每个项目在 `registry.register` 时创建 child logger：`rootLogger.child({ projectId })`，传入 `createEngine`
- Engine 内部现有的 `logger.child({ sessionId })` / `logAgentEvent` 链路不变，自然带上 projectId
- 全局 debug stream 每条日志包含 `projectId`，`/ws/debug` 推送给所有连接的调试客户端

### 6. Scheduler

保持 **per-project Scheduler**（在 `registry.register` 时随 engine 一起创建并 `loadFromProfiles()`）。理由：

- 调度任务与项目 agent 目录强绑定（`.spherse/agents/*/schedules.yml`）
- per-project 保持故障与生命周期隔离（关闭项目即停其调度）
- `ws-schedule` 按 projectId 连接，只订阅该项目的 scheduler 事件

### 7. Engine 生命周期与后台工作连续性

单 server 重构**不改变 engine 的生命周期语义**——engine 数量与活跃度与现状多 server 架构完全一致。关键澄清：单 server 收敛的是「Fastify / logger / websocket 插件」的重复开销，engine 的常驻、切换、销毁模型保持不变。

| 操作 | 含义 | 是否拆 engine |
|------|------|--------------|
| **打开项目**（`registry.register`） | 加入 registry，engine + scheduler 常驻 | 否——engine 活着 |
| **切换活跃项目**（`setActiveProject`） | 仅 renderer 改 `activeProjectId`，纯 UI 动作 | **否**——engine 完全不受影响 |
| **关闭项目**（`close` → `registry.remove`） | `engine.shutdown()`，停 scheduler、关 session DB | 是 |

这与当前 `Map<projectPath, server>` 的语义一致：现在「打开即常驻、切换不动、关闭才 stopServer」，重构后只是把 Map 换成 registry。

具体到两类后台工作的连续性：

- **进行中的对话（agent loop）**：agent loop 跑在 `engine.activeSessions`。按 architecture 约定，`streaming-store`「切换页面/关闭 chat 不中断后台流式输出」，WebSocket 保持连接，engine 继续推事件，切回时消息已在。新设计 WS 走 `/ws/projects/:projectId/chat/...` 到同一 server，行为一致——切换活跃项目不会断开 WS，agent loop 在后台继续完成。
- **定时任务**：per-project Scheduler 用 `setTimeout` 链在 engine 进程内跑，只要项目在 registry 里（没 close）就一直转，与哪个项目是 active 无关。

> 若将来想让「切走的空闲项目」卸载 engine 省资源，那是额外的 lazy-unload feature，不在本次范围（现状也没有）。

### 8. 前端改造

#### 8.1 ApiClient

`createApiClient(port)` → `createApiClient(baseUrl, projectId)`（或 `createApiClient(projectId)`，baseUrl 在应用启动时通过 IPC 取一次固定端口）：

- `baseUrl` 固定（单端口）
- 每个方法把 projectId 拼进路径前缀，例如 `${baseUrl}/api/projects/${projectId}/agents`
- WebSocket URL 同理：`${wsUrl}/ws/projects/${projectId}/chat/${agentId}/${sessionId}`

#### 8.2 AppContext

```ts
interface AppContext {
  client: ApiClient;
  projectId: string;     // 替代 port
  projectRoot: string;
}
```

`initAppContext(projectId, projectRoot)`。

#### 8.3 app-store

- `ProjectState` 用 `projectId` 替代 `port`（或并存过渡）
- `restoreProjects` / `openProject` 返回 `projectId`，调用 `initAppContext(projectId, path)`
- 应用启动时先通过新 IPC `get-server-port` 取一次单实例端口（或 preload 直接注入固定值）
- 删除 `src/lib/project-key.ts`（`projectKeyBase` / `createProjectKey`），`Map<key, ProjectState>` 改为 `Map<projectId, ProjectState>`；`activeProjectKey` 更名为 `activeProjectId`

### 9. 设置同步

- provider API key：仍通过 `process.env` 全局共享（不变）
- defaultModel：`updateDefaultModel()` 改为遍历 `registry` 中所有 `ProjectContext.engine.setDefaultModel()`；语义不变但数据源从 server Map 换成 registry
- 未来跨项目设置（如有）统一在 registry 层广播

### 10. Electron IPC / preload 改造

| 现有 IPC | 改造 |
|----------|------|
| `start-server(projectRoot)` → port | `open-project(projectRoot)` → `projectId`（只操作 registry，不创建 Fastify） |
| `restore-projects` → `[{path,name,port,lastRoute}]` | → `[{id,path,name,lastRoute}]`（不再回 port，或统一回单实例 port） |
| `close-project(path)` | 内部改为 `registry.remove(projectId)` |
| 新增 `get-server-port` | 返回单实例 Fastify 端口（启动一次） |

`electron/server.ts` 从「多 server Map」收敛为「单 Fastify + ProjectRegistry」：

```ts
let fastify: FastifyInstance | null = null;
let registry: ProjectRegistry | null = null;

export async function ensureServer(): Promise<number> { /* 启动一次 */ }
export async function registerProject(projectId, projectRoot): Promise<void>;
export async function unregisterProject(projectId): Promise<void>;
export function updateDefaultModel(m): void { for (const ctx of registry!.all()) ctx.engine.setDefaultModel(m); }
```

`main.ts`：`app.whenReady()` 时 `ensureServer()`，`before-quit` 时 `registry.removeAll()` + `fastify.close()`。

## 影响范围（文件清单）

### `@spherse/core`
- `src/types.ts` — `ProjectConfig` 新增 `id: string` 字段
- `src/store/project.ts` — `create()` 生成 id 写入 `project.yaml`；`open()` 读 id、无 id 时补生成回写
- `src/factory.ts` — `createEngine()` 返回值新增 `projectId`

### `@spherse/server`
- `src/index.ts` — `createServer(projectRoot)` → `createMultiProjectServer()`，新增 `ProjectRegistry`
- `src/routes/*.ts`（全部 11 个）— 路径加 `/projects/:projectId` 前缀，处理器改读 `req.projectCtx`
- `src/routes/index.ts` — `registerAllRoutes(fastify, registry)`，注册 preHandler
- `src/ws-chat.ts` / `ws-fs-watch.ts` / `ws-schedule.ts` — 路径加项目前缀，从 registry 取 ctx
- `src/ws-debug.ts` — 保持全局，日志带 projectId
- `src/contracts/index.ts` — 新增 projectId param schema（若需复用）

### `@spherse/app`（Electron）
- `electron/server.ts` — 多 server Map → 单 Fastify + registry
- `electron/main.ts` — `ensureServer()` 启动时机
- `electron/ipc/project.ts` — `start-server` → `open-project`，调整 restore 返回结构
- `electron/preload.ts` — `startServer` → `openProject`，新增 `getServerPort`
- `electron/settings.ts` — `OpenProjectEntry` 记录 `id`（来源 core 返回，非自生成），仍按 `path` 索引

### `@spherse/app`（renderer）
- `src/lib/api.ts` — `createApiClient(port)` → `createApiClient(baseUrl, projectId)`，全部路径加前缀
- `src/lib/context.ts` — `AppContext` 用 projectId
- `src/stores/app-store.ts` — `ProjectState`、`restoreProjects`/`openProject` 改用 projectId；`activeProjectKey` → `activeProjectId`
- `src/lib/project-key.ts` — **删除**（id 由 core 生成保证唯一，碰撞逻辑多余）
- `src/features/chat/streaming-store.ts` 等 WS 消费方 — WS URL 拼接项目前缀
- `src/ui-sdk/use-spherse-message-listener.ts` — `serverOrigin` 计算调整

### 测试
- `packages/server/src/__tests__/` — contract/API 测试路径更新、多项目注册场景
- `packages/app/src/stores/*.test.ts` — mock 适配 projectId

### 文档
- `docs/official/architecture.md` — 更新「Server 层」「Electron 层」相关条目（单实例 + registry + projectId）
- `docs/dev/backlog.md` — 勾选对应条目

## 实施分阶段（建议）

为降低单次 PR 风险，分 3 阶段推进：

1. **阶段 1 — 引入 ProjectRegistry 与单 Fastify，但路由仍透传**：先把多 server Map 收敛为单 Fastify + registry，路由/WS 暂时保持「无 projectId」并通过其它方式（如临时仍用端口语义或单项目默认）跑通。验证单实例基线。
2. **阶段 2 — 路由/WS 加 projectId 前缀 + preHandler**：改造全部路由与 WS、contracts、前端 api client、stores。这是改动最大的一步。
3. **阶段 3 — 收尾**：debug 流带 projectId + 前端过滤、设置同步收敛、文档/architecture 更新、E2E 验证。

## 不在本次范围

- 跨项目共享 agent / skill 模板（仍是 per-project，但单 server 为后续打下基础）
- 多窗口 / 多 Electron 进程隔离
- 远程 server 模式（当前仅本地 127.0.0.1）
- 日志文件持久化、运行时日志级别调整

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| 大面积路由/前端改动引入回归 | 分阶段推进；每阶段跑 `npm run verify`；重点回归 E2E（项目恢复、路由、store、chat/session、content browser、file-tree、server API） |
| projectId 迁移导致旧项目不可用 | `ProjectStore.open()` 检测到 `project.yaml` 无 `id` 时自动生成并回写，向前兼容旧项目 |
| 复制目录导致 id 撞 registry | `registry.register` 检测冲突时静默改写副本目录的 `project.yaml` id，原项目与已注册 entry 不受影响 |
| 单实例故障隔离变弱 | Engine/路由层 try/catch 保护；Scheduler 保持 per-project；registry.remove 不影响其它项目 |
| WebSocket 连接在新 URL 下断连 | 前后端同 PR 改造 WS URL；streaming-store 已有重连/容错逻辑 |
