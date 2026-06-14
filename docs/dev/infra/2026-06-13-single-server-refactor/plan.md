# 单服务器多项目重构 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将每个项目一个 Fastify 实例的多 server 架构收敛为单一 Fastify 实例 + `ProjectRegistry`，通过 URL 路径前缀 `/api/projects/:projectId/...` 做项目隔离，统一 logger/debug 流，消除资源开销与端口管理负担。

**Architecture:** `@spherse/core` 的 `ProjectStore` 在 `project.yaml` 中生成并持久化稳定 `projectId`；`@spherse/server` 引入 `ProjectRegistry`（`Map<projectId, ProjectContext>`），`createMultiProjectServer()` 启动单一 Fastify；所有路由与 WebSocket 加项目前缀，preHandler 注入 `ProjectContext`；Electron 层管理单实例生命周期；renderer 的 `ApiClient` 用固定 baseUrl + projectId 拼路径，`projectKey` 与 `projectId` 统一。

**Tech Stack:** Fastify, pino, electron-store, nanoid, React/Zustand, TypeScript

**Design doc:** `docs/dev/infra/2026-06-13-single-server-refactor/design.md`

---

### Task 1: Core — projectId 生成与持久化

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/store/project.ts`
- Modify: `packages/core/src/factory.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 安装 nanoid**

```bash
npm install nanoid --workspace=packages/core
```

- [ ] **Step 2: ProjectConfig 新增 `id` 字段**

在 `packages/core/src/types.ts` 的 `ProjectConfig` interface 中新增 `id: string`：

```ts
export interface ProjectConfig {
  id: string;
  name: string;
  created: number;
  defaultModel: string;
  paths: {
    agents: string;
    index: string;
    changelog: string;
  };
  aiAccess?: { deniedPaths: string[] };
  welcomePage?: { path: string };
}
```

- [ ] **Step 3: ProjectStore.create() 生成 id 并写入 project.yaml**

在 `packages/core/src/store/project.ts` 中：

顶部新增 import：
```ts
import { nanoid } from "nanoid";
```

在 `create()` 方法中，构建 `this.config` 时加入 `id`：

```ts
this.config = {
  id: nanoid(8),
  name,
  created: Date.now(),
  defaultModel,
  paths: { ...DEFAULT_PATHS },
};
```

- [ ] **Step 4: ProjectStore.open() 读取 id，缺失时补生成回写**

在 `open()` 方法中，解析 config 后加入 id 兼容逻辑：

```ts
async open(): Promise<ProjectConfig> {
  const configPath = path.join(this.spherseDir, "project.yaml");
  if (!fsSync.existsSync(configPath)) {
    throw new Error(`project.yaml not found at ${configPath}`);
  }

  const raw = await fs.readFile(configPath, "utf-8");
  this.config = YAML.parse(raw) as ProjectConfig;

  if (!this.config.id) {
    this.config.id = nanoid(8);
    await fs.writeFile(configPath, YAML.stringify(this.config), "utf-8");
    this.logger.info({ rootPath: this.rootPath, id: this.config.id }, "project id generated for legacy project");
  }

  this.logger.info({ rootPath: this.rootPath }, "project opened");
  return this.config;
}
```

- [ ] **Step 5: ProjectStore 新增 getProjectId() 方法**

```ts
getProjectId(): string {
  if (!this.config) throw new Error("Project is not open");
  return this.config.id;
}
```

- [ ] **Step 6: createEngine() 返回 projectId**

在 `packages/core/src/factory.ts` 中，修改返回类型和返回值：

```ts
export async function createEngine(
  projectRoot: string,
  options?: { projectName?: string; defaultModel?: string; logger?: Logger },
): Promise<{ engine: Engine; projectStore: ProjectStore; projectId: string }> {
```

在函数末尾：
```ts
return { engine, projectStore, projectId: projectStore.getProjectId() };
```

- [ ] **Step 7: 导出 nanoid re-export（可选，供 server 冲突改写使用）**

在 `packages/core/src/index.ts` 中确认导出 `ProjectStore`（已有），无需额外导出 nanoid——server 层自行 import nanoid。

- [ ] **Step 8: 编译并运行 core 测试**

```bash
npm run build --workspace=packages/core && npm test --workspace=packages/core
```

Expected: 编译成功。旧测试中如果直接构造 `ProjectConfig` 对象缺少 `id`，需要补上 `id: "test-id"`（检查 `__tests__/` 下是否有此情况）。

- [ ] **Step 9: Commit**

```bash
git add packages/core/package.json packages/core/src/types.ts packages/core/src/store/project.ts packages/core/src/factory.ts
git commit -m "feat(core): generate and persist projectId in project.yaml"
```

---

### Task 2: Server — ProjectRegistry

**Files:**
- Create: `packages/server/src/registry.ts`
- Modify: `packages/server/package.json`

- [ ] **Step 1: 安装 nanoid 到 server（冲突改写用）**

```bash
npm install nanoid --workspace=packages/server
```

- [ ] **Step 2: 创建 ProjectRegistry 类**

创建 `packages/server/src/registry.ts`：

```ts
import { nanoid } from "nanoid";
import type { Engine, ProjectStore, FileWriteMutex, Logger } from "@spherse/core";
import { createEngine } from "@spherse/core";

export interface ProjectContext {
  engine: Engine;
  projectStore: ProjectStore;
  fileWriteMutex: FileWriteMutex;
  projectId: string;
}

export class ProjectRegistry {
  private projects = new Map<string, ProjectContext>();
  private logger: Logger;
  private defaultModel?: string;

  constructor(logger: Logger, defaultModel?: string) {
    this.logger = logger;
    this.defaultModel = defaultModel;
  }

  async register(projectRoot: string): Promise<ProjectContext> {
    const { engine, projectStore, projectId } = await createEngine(projectRoot, {
      defaultModel: this.defaultModel,
      logger: this.logger.child({ projectId: "(resolving)" }),
    });

    let resolvedId = projectId;
    if (this.projects.has(projectId)) {
      resolvedId = nanoid(8);
      await projectStore.regenerateProjectId(resolvedId);
      this.logger.warn(
        { originalId: projectId, newId: resolvedId, projectRoot },
        "project id conflict, regenerated for duplicate directory",
      );
    }

    const ctx: ProjectContext = {
      engine,
      projectStore,
      fileWriteMutex: engine.getFileWriteMutex(),
      projectId: resolvedId,
    };
    this.projects.set(resolvedId, ctx);
    return ctx;
  }

  get(projectId: string): ProjectContext | undefined {
    return this.projects.get(projectId);
  }

  has(projectId: string): boolean {
    return this.projects.has(projectId);
  }

  list(): string[] {
    return [...this.projects.keys()];
  }

  async remove(projectId: string): Promise<void> {
    const ctx = this.projects.get(projectId);
    if (!ctx) return;
    await ctx.engine.shutdown();
    this.projects.delete(projectId);
  }

  async removeAll(): Promise<void> {
    const ids = this.list();
    await Promise.all(ids.map((id) => this.remove(id)));
  }

  setDefaultModel(model: string | undefined): void {
    this.defaultModel = model;
    for (const ctx of this.projects.values()) {
      ctx.engine.setDefaultModel(model);
    }
  }
}
```

> 注意：`ProjectStore.regenerateProjectId(id)` 是一个新方法，需要在 Task 1 的 Step 5 中一并加入（见下方补充）。如果尚未加入，在此 step 补上。

- [ ] **Step 3: 在 ProjectStore 中补充 regenerateProjectId 方法**

在 `packages/core/src/store/project.ts` 中新增：

```ts
async regenerateProjectId(newId: string): Promise<void> {
  if (!this.config) throw new Error("Project is not open");
  this.config.id = newId;
  const configPath = path.join(this.spherseDir, "project.yaml");
  await fs.writeFile(configPath, YAML.stringify(this.config), "utf-8");
  this.logger.info({ newId }, "project id regenerated");
}
```

- [ ] **Step 4: 编译验证**

```bash
npm run build --workspace=packages/server
```

Expected: 编译成功（registry 此时未被引用，但不影响编译）

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/registry.ts packages/server/package.json packages/core/src/store/project.ts
git commit -m "feat(server): add ProjectRegistry for multi-project management"
```

---

### Task 3: Server — createMultiProjectServer + 单一 logger

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: 改造 createServer 为 createMultiProjectServer**

在 `packages/server/src/index.ts` 中，将整个文件重写：

```ts
import Fastify from "fastify";
import pino from "pino";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { Logger } from "@spherse/core";
import { ProjectRegistry } from "./registry.js";
import { registerAllRoutes } from "./routes/index.js";
import { handleChatWebSocket } from "./ws-chat.js";
import { handleFsWatchWebSocket } from "./ws-fs-watch.js";
import { handleDebugWebSocket, createDebugStream } from "./ws-debug.js";
import { handleScheduleWebSocket } from "./ws-schedule.js";

export interface MultiProjectServer {
  fastify: FastifyInstance;
  registry: ProjectRegistry;
  logger: Logger;
}

export async function createMultiProjectServer(
  options?: { defaultModel?: string },
): Promise<MultiProjectServer> {
  const pretty = pino.transport({
    target: "pino-pretty",
    options: { colorize: true },
  });
  pretty.on("error", () => {});

  const debugStream = createDebugStream();
  const logger = pino({ level: "debug" }, pino.multistream([pretty, debugStream]));

  const fastifyTransport = pino.transport({
    target: "pino-pretty",
    options: { colorize: true },
  });
  fastifyTransport.on("error", () => {});

  const fastify = Fastify({
    logger: { level: "debug", stream: fastifyTransport },
  });

  await fastify.register(cors, { origin: true });
  await fastify.register(websocket);

  const registry = new ProjectRegistry(logger, options?.defaultModel);

  registerAllRoutes(fastify, registry);
  handleChatWebSocket(fastify, registry);
  handleFsWatchWebSocket(fastify, registry);
  handleDebugWebSocket(fastify);
  handleScheduleWebSocket(fastify, registry);

  await fastify.listen({ port: 0, host: "127.0.0.1" });

  const address = fastify.server.address();
  logger.info({ port: (address as any).port }, "server listening");

  return { fastify, registry, logger };
}
```

- [ ] **Step 2: 保留旧 AppContext 类型导出（兼容期）**

`AppContext` 类型不再在 `createServer` 中创建。routes 和 ws 文件将在 Task 4 / Task 5 中改为从 `registry.ts` 导入 `ProjectContext`。暂不删除 `AppContext` 类型定义——在路由改造完成后再清理。

在文件中暂时保留（routes 还未改，编译会暂时失败——这是预期的，下一个 Task 修复）。

- [ ] **Step 3: Commit（此时 server 无法编译，与 Task 4 一起验证）**

跳过单独 commit，与 Task 4 合并验证。

---

### Task 4: Server — 路由加 projectId 前缀 + preHandler 注入

**Files:**
- Modify: `packages/server/src/routes/index.ts`
- Modify: `packages/server/src/routes/agents.ts`
- Modify: `packages/server/src/routes/agent-write.ts`
- Modify: `packages/server/src/routes/sessions.ts`
- Modify: `packages/server/src/routes/content.ts`
- Modify: `packages/server/src/routes/settings.ts`
- Modify: `packages/server/src/routes/preview.ts`
- Modify: `packages/server/src/routes/skills.ts`
- Modify: `packages/server/src/routes/file-tree.ts`
- Modify: `packages/server/src/routes/debug.ts`
- Modify: `packages/server/src/routes/schedules.ts`

> **核心改造模式**：每个路由函数的签名从 `(fastify, ctx: AppContext)` 变为 `(fastify, registry: ProjectRegistry)`，路由路径加 `/projects/:projectId` 前缀，处理器内部从 `ctx.xxx` 改为 `(req as any).projectCtx.xxx`。

- [ ] **Step 1: 改造 routes/index.ts — 注册 preHandler + 传入 registry**

将 `packages/server/src/routes/index.ts` 重写：

```ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ProjectRegistry, ProjectContext } from "../registry.js";
import { registerAgentRoutes } from "./agents.js";
import { registerAgentWriteRoutes } from "./agent-write.js";
import { registerSessionRoutes } from "./sessions.js";
import { registerContentRoutes } from "./content.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerPreviewRoutes } from "./preview.js";
import { registerSkillRoutes } from "./skills.js";
import { registerFileTreeRoutes } from "./file-tree.js";
import { registerDebugRoutes } from "./debug.js";
import { registerScheduleRoutes } from "./schedules.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: ProjectContext;
  }
}

export function registerAllRoutes(fastify: FastifyInstance, registry: ProjectRegistry): void {
  // 使用 preHandler（而非 onRequest）：params 在此阶段已解析
  fastify.addHook("preHandler", async (req: FastifyRequest, reply) => {
    const projectId = (req.params as Record<string, string> | undefined)?.projectId;
    if (projectId === undefined) return;
    const ctx = registry.get(projectId);
    if (!ctx) {
      return reply.code(404).send({ error: "Unknown project" });
    }
    req.projectCtx = ctx;
  });

  registerAgentRoutes(fastify, registry);
  registerAgentWriteRoutes(fastify, registry);
  registerSessionRoutes(fastify, registry);
  registerContentRoutes(fastify, registry);
  registerSettingsRoutes(fastify, registry);
  registerPreviewRoutes(fastify, registry);
  registerSkillRoutes(fastify, registry);
  registerFileTreeRoutes(fastify, registry);
  registerDebugRoutes(fastify, registry);
  registerScheduleRoutes(fastify, registry);
}
```

- [ ] **Step 2: 改造每个路由文件**

对每个路由文件应用以下统一模式。以 `agents.ts` 为例：

**改造前：**
```ts
export function registerAgentRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.get("/api/agents", async () => {
    return ctx.engine.listProfiles();
  });
```

**改造后：**
```ts
import type { ProjectRegistry } from "../registry.js";

export function registerAgentRoutes(fastify: FastifyInstance, registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/agents",
    async (req) => {
      return req.projectCtx!.engine.listProfiles();
    },
  );
```

对全部 11 个路由文件逐一应用，路径映射如下：

| 文件 | 路由前缀变更 |
|------|-------------|
| `agents.ts` | `/api/agents` → `/api/projects/:projectId/agents`，`/api/agents/:id` → `/api/projects/:projectId/agents/:id`，`/api/agents/:id/raw` → `/api/projects/:projectId/agents/:id/raw`，`/api/agents/:id/theme` → `/api/projects/:projectId/agents/:id/theme` |
| `agent-write.ts` | `/api/agents/create` → `/api/projects/:projectId/agents/create`，`/api/agents/:id` (PUT/DELETE) → `/api/projects/:projectId/agents/:id` |
| `sessions.ts` | `/api/agents/:agentId/sessions` → `/api/projects/:projectId/agents/:agentId/sessions`，其余同理加前缀 |
| `content.ts` | `/api/content/*` → `/api/projects/:projectId/content/*` |
| `settings.ts` | `/api/settings/ai-access` → `/api/projects/:projectId/settings/ai-access`，`/api/settings/welcome-page` → `/api/projects/:projectId/settings/welcome-page`。**`/api/settings/providers` 保持全局，不加前缀** |
| `preview.ts` | `/api/preview/*` → `/api/projects/:projectId/preview/*` |
| `skills.ts` | `/api/skills` → `/api/projects/:projectId/skills`，`/api/skills/:name` → `/api/projects/:projectId/skills/:name` |
| `file-tree.ts` | `/api/file-tree` → `/api/projects/:projectId/file-tree` |
| `debug.ts` | `/api/debug/sessions/:id/turn-context` → `/api/projects/:projectId/debug/sessions/:id/turn-context` |
| `schedules.ts` | `/api/agents/:agentId/schedules` → `/api/projects/:projectId/agents/:agentId/schedules`，其余同理 |

每个处理器内部：把所有 `ctx.engine` → `req.projectCtx!.engine`，`ctx.projectStore` → `req.projectCtx!.projectStore`，`ctx.fileWriteMutex` → `req.projectCtx!.fileWriteMutex`。

- [ ] **Step 3: 编译 server**

```bash
npm run build --workspace=packages/server
```

Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/ packages/server/src/index.ts
git commit -m "feat(server): add projectId path prefix and preHandler injection to all routes"
```

---

### Task 5: Server — WebSocket 加 projectId 前缀

**Files:**
- Modify: `packages/server/src/ws-chat.ts`
- Modify: `packages/server/src/ws-fs-watch.ts`
- Modify: `packages/server/src/ws-schedule.ts`

- [ ] **Step 1: ws-chat.ts — 路径加项目前缀，从 registry 取 ctx**

改造签名从 `(fastify, ctx: AppContext)` 改为 `(fastify, registry: ProjectRegistry)`，路由路径 `/ws/chat/:agentId/:sessionId` → `/ws/projects/:projectId/chat/:agentId/:sessionId`。

在 handler 开头从 registry 取 ctx：

```ts
import type { ProjectRegistry } from "./registry.js";

export function handleChatWebSocket(fastify: FastifyInstance, registry: ProjectRegistry) {
  fastify.get<{ Params: { projectId: string; agentId: string; sessionId: string } }>(
    "/ws/projects/:projectId/chat/:agentId/:sessionId",
    { websocket: true },
    (socket, req) => {
      const ctx = registry.get(req.params.projectId);
      if (!ctx) {
        socket.close();
        return;
      }
      const { agentId, sessionId } = req.params;
      // ... 原有逻辑，ctx.engine 不变
```

- [ ] **Step 2: ws-fs-watch.ts — 路径加项目前缀**

`/ws/fs-watch` → `/ws/projects/:projectId/fs-watch`，从 registry 取 `projectStore`：

```ts
import type { ProjectRegistry } from "./registry.js";

export function handleFsWatchWebSocket(fastify: FastifyInstance, registry: ProjectRegistry) {
  fastify.get<{ Params: { projectId: string } }>(
    "/ws/projects/:projectId/fs-watch",
    { websocket: true },
    (socket, req) => {
      const ctx = registry.get(req.params.projectId);
      if (!ctx) { socket.close(); return; }
      const projectRoot = ctx.projectStore.getRootPath();
      // ... 原有逻辑
```

- [ ] **Step 3: ws-schedule.ts — 路径加项目前缀**

`/ws/schedule` → `/ws/projects/:projectId/schedule`，从 registry 取 `engine.getScheduler()`：

```ts
import type { ProjectRegistry } from "./registry.js";

export function handleScheduleWebSocket(fastify: FastifyInstance, registry: ProjectRegistry) {
  fastify.get<{ Params: { projectId: string } }>(
    "/ws/projects/:projectId/schedule",
    { websocket: true },
    (socket, req) => {
      const ctx = registry.get(req.params.projectId);
      if (!ctx) { socket.close(); return; }
      const scheduler = ctx.engine.getScheduler();
      // ... 原有逻辑
```

- [ ] **Step 4: 编译 server**

```bash
npm run build --workspace=packages/server
```

Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ws-chat.ts packages/server/src/ws-fs-watch.ts packages/server/src/ws-schedule.ts
git commit -m "feat(server): add projectId path prefix to WebSocket endpoints"
```

---

### Task 6: Server tests — 更新 contract 测试

**Files:**
- Modify: `packages/server/src/__tests__/contracts/api-contracts.test.ts`

- [ ] **Step 1: 运行现有 server 测试确认状态**

```bash
npm test --workspace=packages/server
```

Expected: 现有 contract 测试不依赖路由路径（只测 schema 解析），应该全部通过。如果有路由级集成测试则会失败，需要更新。

- [ ] **Step 2: 新增 ProjectRegistry 单元测试（可选但推荐）**

如果现有测试全绿，跳过此步。如需新增 registry 测试，创建 `packages/server/src/__tests__/registry.test.ts` 验证 register/get/remove 基本流程（使用临时目录创建项目）。

- [ ] **Step 3: Commit（仅在有测试改动时）**

```bash
git add packages/server/src/__tests__/
git commit -m "test(server): update contracts for projectId-prefixed routes"
```

---

### Task 7: Electron — 单 Fastify 实例 + registry 生命周期

**Files:**
- Modify: `packages/app/electron/server.ts`
- Modify: `packages/app/electron/main.ts`
- Modify: `packages/app/electron/settings.ts`
- Modify: `packages/app/electron/ipc/project.ts`
- Modify: `packages/app/electron/preload.ts`

- [ ] **Step 1: 重写 electron/server.ts — 单实例 + registry**

将 `packages/app/electron/server.ts` 重写：

```ts
import type { FastifyInstance } from "fastify";
import { createMultiProjectServer } from "@spherse/server";
import type { ProjectRegistry } from "@spherse/server";
import { getSettings } from "./settings.js";

let serverHandle: { fastify: FastifyInstance; registry: ProjectRegistry } | null = null;

export async function ensureServer(): Promise<void> {
  if (serverHandle) return;
  const settings = getSettings();
  serverHandle = await createMultiProjectServer({
    defaultModel: settings?.defaultModel,
  });
}

export function getServerPort(): number {
  if (!serverHandle) throw new Error("Server not started");
  const address = serverHandle.fastify.server.address();
  return typeof address === "object" && address ? address.port : 0;
}

export async function registerProject(projectRoot: string): Promise<{ projectId: string }> {
  if (!serverHandle) throw new Error("Server not started");
  const ctx = await serverHandle.registry.register(projectRoot);
  return { projectId: ctx.projectId };
}

export async function unregisterProject(projectId: string): Promise<void> {
  if (!serverHandle) return;
  await serverHandle.registry.remove(projectId);
}

export function updateDefaultModel(defaultModel: string | undefined): void {
  if (!serverHandle) return;
  serverHandle.registry.setDefaultModel(defaultModel);
}

export async function stopServer(): Promise<void> {
  if (!serverHandle) return;
  await serverHandle.registry.removeAll();
  await serverHandle.fastify.close();
  serverHandle = null;
}
```

> 注意：需要从 `@spherse/server` 导出 `ProjectRegistry` 类型。在 `packages/server/src/index.ts` 中添加：`export { ProjectRegistry, type ProjectContext } from "./registry.js";`

- [ ] **Step 2: 在 server/index.ts 中导出 ProjectRegistry**

在 `packages/server/src/index.ts` 末尾添加：

```ts
export { ProjectRegistry, type ProjectContext } from "./registry.js";
```

- [ ] **Step 3: 修改 electron/main.ts — ensureServer 启动时机**

```ts
import { app } from "electron";
import { createWindow, getMainWindow } from "./window.js";
import { restoreEnvFromSettings } from "./settings.js";
import { ensureServer, stopServer } from "./server.js";
import { registerAllIpc } from "./ipc/index.js";

app.whenReady().then(async () => {
  restoreEnvFromSettings();
  await ensureServer();
  createWindow();
  registerAllIpc(getMainWindow);
});

app.on("window-all-closed", () => {
  stopServer();
  app.quit();
});

app.on("before-quit", () => {
  stopServer();
});
```

- [ ] **Step 4: 修改 electron/settings.ts — OpenProjectEntry 加 id 字段**

```ts
export interface OpenProjectEntry {
  id: string;
  path: string;
  name: string;
  lastOpened: string;
  lastRoute?: string;
}
```

修改 `addOpenProject` 接受 `id` 参数：

```ts
export function addOpenProject(projectId: string, projectPath: string): void {
  const projects = getOpenProjects();
  const idx = projects.findIndex((p) => p.path === projectPath);
  const existing = idx >= 0 ? projects[idx] : undefined;
  const entry: OpenProjectEntry = {
    id: projectId,
    path: projectPath,
    name: path.basename(projectPath),
    lastOpened: new Date().toISOString(),
    lastRoute: existing?.lastRoute,
  };
  if (idx >= 0) {
    projects[idx] = entry;
  } else {
    projects.push(entry);
  }
  settingsStore.set("openProjects", projects);
}
```

同步修改 `removeOpenProject`：保持按 path 过滤（id 改写后 path 仍唯一）。

- [ ] **Step 5: 修改 electron/ipc/project.ts — start-server → open-project**

重写关键 handler：

```ts
ipcMain.handle("open-project", async (_event, projectRoot: string) => {
  const { projectId } = await registerProject(projectRoot);
  return { projectId };
});

ipcMain.handle("restore-projects", async () => {
  const entries = getOpenProjects();
  const results: Array<{ id: string; path: string; name: string; lastRoute?: string }> = [];
  for (const entry of entries) {
    try {
      const { projectId } = await registerProject(entry.path);
      results.push({ id: projectId, path: entry.path, name: entry.name, lastRoute: entry.lastRoute });
    } catch {
      // directory deleted or corrupt, skip silently
    }
  }
  return results;
});

ipcMain.handle("close-project", async (_event, projectId: string) => {
  await unregisterProject(projectId);
  removeOpenProjectById(projectId);
});
```

注意：`close-project` 的参数从 path 改为 projectId。需要在 `settings.ts` 中新增 `removeOpenProjectById`：

```ts
export function removeOpenProjectById(projectId: string): void {
  const projects = getOpenProjects().filter((p) => p.id !== projectId);
  settingsStore.set("openProjects", projects);
  const lastActive = getLastActiveProject();
  if (lastActive === projectId) {
    setLastActiveProject(null);
  }
}
```

`lastActiveProject` 也改为存 projectId（而非 path）。修改 `setLastActiveProject` / `getLastActiveProject` 的语义。

新增 `get-server-port` handler：

```ts
ipcMain.handle("get-server-port", () => {
  return getServerPort();
});
```

保留 `select-directory`、`reveal-in-finder`（参数仍为 path，不变）、`show-save-dialog` 不变。

- [ ] **Step 6: 修改 electron/preload.ts**

```ts
contextBridge.exposeInMainWorld("electronAPI", {
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  openProject: (projectRoot: string) => ipcRenderer.invoke("open-project", projectRoot),
  getServerPort: () => ipcRenderer.invoke("get-server-port"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings: unknown) => ipcRenderer.invoke("save-settings", settings),
  getSupportedProviders: () => ipcRenderer.invoke("get-supported-providers"),
  restoreProjects: () => ipcRenderer.invoke("restore-projects"),
  addOpenProject: (projectId: string, projectRoot: string) => ipcRenderer.invoke("add-open-project", projectId, projectRoot),
  closeProject: (projectId: string) => ipcRenderer.invoke("close-project", projectId),
  revealInFinder: (projectRoot: string) => ipcRenderer.invoke("reveal-in-finder", projectRoot),
  setLastActiveProject: (projectId: string) => ipcRenderer.invoke("set-last-active-project", projectId),
  getLastActiveProject: () => ipcRenderer.invoke("get-last-active-project"),
  setProjectLastRoute: (projectId: string, route: string) => ipcRenderer.invoke("set-project-last-route", projectId, route),
  // ... debug 相关不变
});
```

注意 `add-open-project` handler 也需要更新签名：

```ts
ipcMain.handle("add-open-project", async (_event, projectId: string, projectPath: string) => {
  addOpenProject(projectId, projectPath);
});
```

`set-last-active-project` / `set-project-last-route` 的参数从 path 改为 projectId。

- [ ] **Step 7: 编译验证（此时 app 会编译失败——renderer 尚未改，下一步修复）**

```bash
npm run build --workspace=packages/server
```

Expected: server 编译成功

- [ ] **Step 8: Commit（与 Task 8 合并验证）**

---

### Task 8: Renderer — ApiClient + AppContext + app-store 改造

**Files:**
- Delete: `packages/app/src/lib/project-key.ts`
- Modify: `packages/app/src/lib/api.ts`
- Modify: `packages/app/src/lib/context.ts`
- Modify: `packages/app/src/stores/app-store.ts`
- Modify: `packages/app/src/stores/app-store.test.ts`

- [ ] **Step 1: 改造 api.ts — createApiClient(baseUrl, projectId)**

将 `createApiClient(port: number)` 改为 `createApiClient(baseUrl: string, projectId: string)`：

```ts
export function createApiClient(baseUrl: string, projectId: string) {
  const apiBase = `${baseUrl}/api/projects/${projectId}`;
  const wsBase = baseUrl.replace(/^http/, "ws");
  const wsProjectBase = `${wsBase}/ws/projects/${projectId}`;

  return {
    baseUrl,
    // 所有 HTTP 方法路径改为 ${apiBase}/...
    async listAgents(): Promise<AgentProfile[]> {
      const res = await fetch(`${apiBase}/agents`);
      return res.json();
    },
    // ... 其余方法同理，把 ${baseUrl}/api/xxx 改为 ${apiBase}/xxx

    // 全局端点（providers）仍用 ${baseUrl}/api/settings/providers
    async getSupportedProviders() {
      const res = await fetch(`${baseUrl}/api/settings/providers`);
      return res.json();
    },

    // WebSocket 工厂方法（createChatWebSocket 当前未被实际调用——chat WS 由 streaming-store 直拼；
    // createFsWatchWebSocket / createScheduleWebSocket / createLogWebSocket 被 ProjectLayout 等调用）
    createFsWatchWebSocket(onChange: () => void): WebSocket {
      const url = `${wsProjectBase}/fs-watch`;
      // ...
    },
    createScheduleWebSocket(onEvent: (event: ScheduleServerEvent) => void): WebSocket {
      const url = `${wsProjectBase}/schedule`;
      // ...
    },
    // debug 端点保持全局，不带 projectId
    createLogWebSocket(onLog: (line: string) => void): WebSocket {
      const url = `${wsBase}/ws/debug`;
      // ...
    },
    // createChatWebSocket 如果保留，URL 改为 ${wsProjectBase}/chat/...（但实际调用方在 streaming-store）
  };
}
```

> `getPreviewUrl`：`${apiBase}/preview/${filePath}`
> `getSupportedProviders`（全局）：保持 `${baseUrl}/api/settings/providers`
> 所有其余 HTTP 方法的 `${baseUrl}/api/xxx` → `${apiBase}/xxx`

- [ ] **Step 2: 改造 context.ts — AppContext 用 projectId**

```ts
import { createApiClient } from "./api";
import type { ApiClient } from "./api";

export interface AppContext {
  client: ApiClient;
  baseUrl: string;
  projectId: string;
  projectRoot: string;
}

export function initAppContext(baseUrl: string, projectId: string, projectRoot: string): AppContext {
  return {
    client: createApiClient(baseUrl, projectId),
    baseUrl,
    projectId,
    projectRoot,
  };
}
```

- [ ] **Step 3: 删除 project-key.ts**

```bash
rm packages/app/src/lib/project-key.ts
```

- [ ] **Step 4: 改造 app-store.ts — projectId 统一**

修改 `ProjectState`：

```ts
export interface ProjectState {
  id: string;          // projectId（替代 key）
  path: string;
  name: string;
  ctx: AppContext;
  lastRoute?: string;
}
```

修改 store 内部：

- `projects: Map<string, ProjectState>` 的 key 改为 projectId
- `activeProjectKey` → `activeProjectId`
- `restoreProjects`：不再调 `createProjectKey`，直接用返回的 `id` 作为 Map key
- `openProject`：调 `electronAPI.openProject(dir)` 拿 `{ projectId }`，调 `electronAPI.getServerPort()` 拿 port 拼 baseUrl

完整重写 `restoreProjects`：

```ts
async restoreProjects() {
  set({ initializing: true });
  const port = await window.electronAPI.getServerPort();
  const baseUrl = `http://localhost:${port}`;
  const restored = await window.electronAPI.restoreProjects();
  const projects = new Map<string, ProjectState>();

  for (const { id, path, name, lastRoute } of restored) {
    projects.set(id, {
      id,
      path,
      name,
      ctx: initAppContext(baseUrl, id, path),
      lastRoute,
    });
  }

  const lastActiveId = await window.electronAPI.getLastActiveProject();
  const fallbackId = projects.keys().next().value ?? null;
  const nextActiveId = lastActiveId && projects.has(lastActiveId) ? lastActiveId : fallbackId;
  set({ projects, activeProjectId: nextActiveId, initializing: false });
  return nextActiveId;
},
```

完整重写 `openProject`：

```ts
async openProject() {
  const dir = await window.electronAPI.selectDirectory();
  if (!dir) return null;

  // 检查是否已打开（按 path 查找）
  const existing = [...get().projects.values()].find((p) => p.path === dir);
  if (existing) {
    await get().setActiveProject(existing.id);
    return existing.id;
  }

  const { projectId } = await window.electronAPI.openProject(dir);
  const port = await window.electronAPI.getServerPort();
  const baseUrl = `http://localhost:${port}`;
  const name = dir.split(/[\\/]/).filter(Boolean).pop() || dir;
  const projects = new Map(get().projects);
  projects.set(projectId, {
    id: projectId,
    path: dir,
    name,
    ctx: initAppContext(baseUrl, projectId, dir),
  });
  set({ projects, activeProjectId: projectId });
  await window.electronAPI.addOpenProject(projectId, dir);
  await window.electronAPI.setLastActiveProject(projectId);
  return projectId;
},
```

完整重写 `closeProject`（参数从 projectKey 改为 projectId）：

```ts
async closeProject(projectId) {
  const project = get().projects.get(projectId);
  if (!project) return get().activeProjectId;

  await window.electronAPI.closeProject(projectId);

  let nextActiveId: string | null = get().activeProjectId;
  set((state) => {
    const projects = new Map(state.projects);
    projects.delete(projectId);
    if (state.activeProjectId === projectId) {
      const remaining = [...projects.keys()];
      nextActiveId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
    return { projects, activeProjectId: nextActiveId };
  });

  if (nextActiveId) {
    const nextProject = get().projects.get(nextActiveId);
    if (nextProject) {
      await window.electronAPI.setLastActiveProject(nextActiveId);
    }
  }
  return nextActiveId;
},
```

`setActiveProject`、`setProjectLastRoute` 同理改为用 projectId。

`findProjectKeyByPath` helper 改为遍历 `projects.values()` 按 path 匹配返回 id。

- [ ] **Step 5: 更新 app-store.test.ts**

适配新的 mock（`openProject` 返回 `{ projectId }`、`getServerPort` mock、`restoreProjects` 返回含 `id` 的结构）。

- [ ] **Step 6: 编译验证（此时 app 仍有其它文件引用 projectKey/port，下一步修复）**

---

### Task 9: Renderer — 全量适配 projectId + baseUrl（stores、hooks、组件）

> 本 Task 是 renderer 改动最大的部分。`projectKey` 在 `project-data-store.ts`、`project-ui-store.ts` 及其全部消费方中作为参数名出现 300+ 次，需要系统性地重命名为 `projectId`。`port` 在多个组件 prop 中传递，需替换为 `baseUrl`/`projectId` 组合。

**Files:**
- Modify: `packages/app/src/main.tsx` — `restoreProjects` 返回类型
- Modify: `packages/app/src/router.tsx` — 路由参数 `:projectKey` → `:projectId`
- Modify: `packages/app/src/pages/ProjectPage.tsx`
- Modify: `packages/app/src/layouts/ProjectLayout.tsx`
- Modify: `packages/app/src/hooks/useCustomTheme.ts`
- Modify: `packages/app/src/stores/project-data-store.ts` — 全部 `projectKey` 参数 → `projectId`
- Modify: `packages/app/src/stores/project-ui-store.ts` — 同上 + localStorage key 前缀
- Modify: `packages/app/src/features/chat/streaming-store.ts`
- Modify: `packages/app/src/features/chat/hooks/useChatSession.ts`
- Modify: `packages/app/src/features/chat/index.tsx` — Chat props
- Modify: `packages/app/src/features/floating-chat/FloatingChatManager.tsx`
- Modify: `packages/app/src/features/floating-chat/FloatingChatContainer.tsx`
- Modify: `packages/app/src/features/debug-tools/DebugMenu.tsx` — 移除 `createApiClient(port)` 直调
- Modify: `packages/app/src/features/debug-tools/LogPanel.tsx`
- Modify: `packages/app/src/ui-sdk/types.ts` — `ActionContext.projectKey` → `projectId`
- Modify: `packages/app/src/ui-sdk/use-spherse-message-listener.ts`
- Modify: `packages/app/src/ui-sdk/handlers/*.ts` — 全部引用 `ctx.projectKey`（create-session、send-message、open-file、float-session、unfloat-session、data）
- Modify: `packages/app/src/layouts/ProjectLayout.tsx` — `projectKey` prop → `projectId`，全部内部引用
- Modify: `packages/app/src/features/agent-session-list/index.tsx` — `projectKey` prop → `projectId`
- Modify: `packages/app/src/features/agent-schedule/index.tsx` — `projectKey` prop → `projectId`
- Modify: `packages/app/src/features/content-browser/index.tsx` — `projectKey` prop → `projectId`
- Modify: `packages/app/src/features/project-panel/index.tsx` — `projectKey` prop → `projectId`
- Modify: `packages/app/src/features/text-selection-session/index.tsx` — `projectKey` prop → `projectId`
- Modify: `packages/app/src/features/text-selection-session/StartSessionPopover.tsx` — 同上
- Modify: `packages/app/src/features/chat/HtmlCard.tsx` — `activeProjectKey` → `activeProjectId`
- Modify: `packages/app/src/stores/project-data-store.test.ts`

- [ ] **Step 1: project-data-store.ts — 参数名 projectKey → projectId**

`project-data-store.ts` 中所有方法签名的 `projectKey: string` 参数重命名为 `projectId: string`，函数体内局部变量同步。这不改变行为（参数名只是命名），但必须与 app-store 和调用方统一。

```bash
rg "projectKey" packages/app/src/stores/project-data-store.ts
```

逐个替换。注意 `updateProjectData(state, projectKey, ...)` helper 中的参数名也要改。

- [ ] **Step 2: project-ui-store.ts — 参数名 + localStorage key**

同样将 `projectKey` → `projectId`。`FLOATING_CHAT_STORAGE_PREFIX` 保持 `"spherse:floating-chat:"`，但拼接的 key 从 projectKey 变为 projectId——由于 Task 8 已将 projectKey 统一为 projectId，localStorage key 自然变为 `spherse:floating-chat:<projectId>`，无需特殊迁移（用户浮窗状态会重新初始化，符合预期）。

```bash
rg "projectKey" packages/app/src/stores/project-ui-store.ts
```

- [ ] **Step 3: streaming-store.ts — attach 参数从 port 改为 baseUrl + projectId**

```ts
interface StreamingStoreActions {
  attach: (client: ApiClient, sessionId: string, baseUrl: string, projectId: string, agentId: string, initialMessage?: string) => void;
  // ...
};
```

在 `connect()` 方法中，WS URL 改为：

```ts
const ws = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws/projects/${projectId}/chat/${agentId}/${sessionId}`);
```

- [ ] **Step 4: useChatSession.ts — 传 baseUrl + projectId 替代 port**

```ts
export function useChatSession({
  client,
  sessionId,
  baseUrl,
  projectId,
  agentId,
  initialMessage,
}: {
  client: ApiClient;
  sessionId: string;
  baseUrl: string;
  projectId: string;
  agentId: string;
  initialMessage?: string;
}) {
  useEffect(() => {
    useStreamingStore.getState().attach(client, sessionId, baseUrl, projectId, agentId, initialMessage);
    return () => useStreamingStore.getState().detach(sessionId);
  }, [client, sessionId, baseUrl, projectId, agentId, initialMessage]);
  // ...
}
```

- [ ] **Step 5: Chat 组件 props — port → baseUrl + projectId**

在 `features/chat/index.tsx` 中，`ChatProps` 的 `port: number` 改为 `baseUrl: string` + `projectId: string`。调用 `useChatSession` 时传新参数。

同理 `FloatingChatContainer.tsx`、`FloatingChatManager.tsx`、`ProjectLayout.tsx` 中传递这些 props 的地方跟随修改：`port={project.ctx.port}` → `baseUrl={project.ctx.baseUrl} projectId={project.ctx.projectId}`。

- [ ] **Step 6: useCustomTheme.ts — port → baseUrl**

`useCustomTheme(projectRoot, port)` 当前用 port 拼接 preview URL 加载 theme.css。改为接受 `baseUrl`：

```ts
export function useCustomTheme(projectRoot: string | undefined, baseUrl: string | undefined) {
  // 内部 URL 拼接从 ws://localhost:${port} 改为 ${baseUrl}
```

调用方 `ProjectLayout.tsx:63`：`useCustomTheme(project.ctx.projectRoot, project.ctx.baseUrl)`。

- [ ] **Step 7: DebugMenu.tsx / LogPanel.tsx — port → 从 activeProject.ctx 取 baseUrl**

`DebugMenu.tsx:53` 当前 `const port = activeProject?.port`，改为从 `activeProject?.ctx.baseUrl` 取值。`createApiClient(port)` 直调改为 `createApiClient(baseUrl, projectId)` 或直接复用 `activeProject.ctx.client`。

`LogPanel.tsx:33` 的 `port: number` prop 同理改为 `baseUrl: string`。

- [ ] **Step 8: ui-sdk 全部文件 — projectKey → projectId**

以下文件全部将 `projectKey` 替换为 `projectId`：

- `ui-sdk/types.ts` — `ActionContext.projectKey` → `projectId`
- `ui-sdk/use-spherse-message-listener.ts` — 参数名
- `ui-sdk/handlers/create-session.ts` — `ctx.projectKey` → `ctx.projectId`
- `ui-sdk/handlers/send-message.ts` — 同上
- `ui-sdk/handlers/open-file.ts` — 同上 + 导航路径 `/project/${ctx.projectId}/...`
- `ui-sdk/handlers/float-session.ts` — 同上
- `ui-sdk/handlers/unfloat-session.ts` — 同上
- `ui-sdk/handlers/data.ts` — 如有引用

- [ ] **Step 9: router.tsx + ProjectPage.tsx — 路由参数 :projectKey → :projectId**

```tsx
// router.tsx
{ path: "/project/:projectId", element: <ProjectPage /> },
// ProjectPage.tsx
const { projectId } = useParams();
```

搜索 router.tsx 中所有 `/project/:projectKey` 引用并替换。

- [ ] **Step 10: main.tsx — restoreProjects 类型声明**

`main.tsx:11` 中的 `restoreProjects` 返回类型：

```ts
restoreProjects: () => Promise<Array<{ id: string; path: string; name: string; lastRoute?: string }>>;
```

移除 `port`，添加 `id`。

- [ ] **Step 11: project-data-store.test.ts — 适配 projectId**

将测试中的 `projectKey` 参数改为 `projectId`，mock client 适配新签名。

- [ ] **Step 12: 搜索遗漏的 projectKey / port 引用**

```bash
rg "projectKey|activeProjectKey" packages/app/src --type ts -l
rg "\.port\b|ctx\.port|project\.port" packages/app/src --type ts -l
```

逐一修复所有残留引用。

- [ ] **Step 13: 编译并修复所有 TypeScript 错误**

```bash
npm run build --workspace=packages/app
```

Expected: 编译成功

- [ ] **Step 14: Commit**

```bash
git add packages/app/
git commit -m "refactor(app): unify projectId, single-server API client, WS URLs"
```

---

### Task 10: Lint + 全量编译 + 单元测试

- [ ] **Step 1: 全量编译**

```bash
npm run build
```

Expected: 所有 package 编译成功

- [ ] **Step 2: 全仓库 lint**

```bash
npm run lint:fix
npm run lint
```

Expected: lint 通过

- [ ] **Step 3: core 测试**

```bash
npm test --workspace=packages/core
```

Expected: 全部 PASS

- [ ] **Step 4: server 测试**

```bash
npm test --workspace=packages/server
```

Expected: 全部 PASS

- [ ] **Step 5: app 测试**

```bash
npm test --workspace=packages/app
```

Expected: 全部 PASS。如有 mock 不匹配（如 app-store.test.ts 中的 `startServer` mock），更新 mock。

- [ ] **Step 6: i18n 检查**

```bash
npm run check:i18n
```

Expected: 通过

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: fix all tests for single-server refactor"
```

---

### Task 11: E2E 回归验证

> E2E 测试受影响最大：多个 spec 和 helper 用 `projectKeyBase(path)` 从目录名推导 projectKey 来拼导航 URL，以及直接调 `window.electronAPI.startServer(dir)` 拿端口、用 `fetch(http://localhost:${port}/api/...)` 调 API。重构后 projectId 是 project.yaml 中的随机 token，无法从路径推导。

**Files:**
- Modify: `packages/app/e2e/helpers/electron.ts`
- Modify: `packages/app/e2e/helpers/file-tree.ts`
- Modify: `packages/app/e2e/ui-sdk.spec.ts`
- Modify: `packages/app/e2e/ui-sdk-data-crud.spec.ts`
- Modify: `packages/app/e2e/floating-chat.spec.ts`
- Modify: `packages/app/e2e/chat-streaming-resilience.spec.ts`
- Modify: `packages/app/e2e/app-launch.spec.ts`
- Modify: `packages/app/e2e/text-selection-session.spec.ts`
- Modify: `packages/app/e2e/agent-list.spec.ts`
- Modify: `packages/app/e2e/agent-dialog.spec.ts`
- Modify: `packages/app/e2e/file-tree.spec.ts`

- [ ] **Step 1: 改造 E2E helpers — 用 openProject + getServerPort 替代 startServer/projectKeyBase**

在 `e2e/helpers/electron.ts` 和 `e2e/helpers/file-tree.ts` 中：

- 删除本地 `projectKeyBase()` 函数
- `TestProject` interface 新增 `projectId: string` 字段
- 启动后通过 `page.evaluate` 调 `window.electronAPI.openProject(dir)` 拿 `{ projectId }`，存入 TestProject
- 导航 URL 改为 `/project/${project.projectId}`
- API 调用改为先 `page.evaluate(() => window.electronAPI.getServerPort())` 拿端口，再 `fetch(http://localhost:${port}/api/projects/${projectId}/agents/...)`

- [ ] **Step 2: 改造所有 E2E spec — 移除 projectKeyBase / startServer / 旧 API 路径**

对每个 spec 文件：
- 移除本地 `projectKeyBase` 定义
- 导航 URL 从 `/project/${projectKeyBase(path)}` 改为 `/project/${project.projectId}`
- `window.electronAPI.startServer(dir)` 改为 `window.electronAPI.openProject(dir)` 拿 `{ projectId }`
- `fetch(http://localhost:${port}/api/agents/...)` 改为 `fetch(http://localhost:${port}/api/projects/${projectId}/agents/...)`

特别注意 `floating-chat.spec.ts` 和 `chat-streaming-resilience.spec.ts`：它们直接用 `startServer` + `fetch` 创建 session，需要改为新路径格式。

- [ ] **Step 3: 运行关键 E2E spec**

```bash
npm run test:e2e --workspace=packages/app -- e2e/app-launch.spec.ts
npm run test:e2e --workspace=packages/app -- e2e/file-tree.spec.ts
npm run test:e2e --workspace=packages/app -- e2e/agent-list.spec.ts
```

Expected: 全部通过

- [ ] **Step 4: 运行其余 E2E spec**

```bash
npm run test:e2e --workspace=packages/app
```

Expected: 全部通过。逐一修复失败用例。

- [ ] **Step 5: 全量 verify**

```bash
npm run verify
```

Expected: lint + build + unit tests + i18n check 全部通过

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: adapt E2E tests for single-server projectId architecture"
```

---

### Task 12: 文档更新

**Files:**
- Modify: `docs/official/architecture.md`
- Modify: `docs/dev/backlog.md`

- [ ] **Step 1: 更新 architecture.md**

更新「Server 层」与「Electron 层」相关条目：

- Server 层：说明单一 Fastify 实例 + ProjectRegistry + `/api/projects/:projectId/...` 路径前缀 + preHandler 注入 ProjectContext
- Electron 层：说明 `ensureServer()` 单实例启动、`registerProject/unregisterProject` 生命周期、projectId 由 core 在 project.yaml 生成
- 前端路由：`:projectKey` → `:projectId`，说明 projectId 来自 project.yaml

- [ ] **Step 2: 更新 backlog.md**

勾选 single-server refactor 相关条目。

- [ ] **Step 3: Commit**

```bash
git add docs/official/architecture.md docs/dev/backlog.md
git commit -m "docs: update architecture for single-server multi-project refactor"
```

---

## 验收标准

- [ ] `npm run verify` 全部通过
- [ ] 手动验证：打开多个项目、切换项目、后台对话继续工作、定时任务正常触发
- [ ] 手动验证：关闭一个项目不影响其它项目的 server 与对话
- [ ] 手动验证：复制项目目录后同时打开，静默改写副本 id 不报错
- [ ] 手动验证：旧项目（无 project.yaml id）打开后自动补生成 id
- [ ] 只有一个监听端口（不再是每项目一个端口）
