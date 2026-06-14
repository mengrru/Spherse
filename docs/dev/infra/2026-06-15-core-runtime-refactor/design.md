# Core 运行时层重构 — 拆解 Engine 为三模块

## 背景

Engine 当前是 316 行的 god object，同时承担数据委托、session 运行时管理、scheduler 持有、模型配置、工具管理五重职责。虽然 store 层已完成树状重构，但 Engine 仍把所有关注点耦在一个类里。

重新定义：放弃 Engine 这个"唯一门面"概念，拆为三个职责清晰的模块 + 一个轻量协调层 `ProjectRuntime`。

## 目标架构

```
createProject(root, opts) → ProjectRuntime
│
└── ProjectRuntime {
      projectManager: ProjectManager    // 项目数据操作门面
      sessionRuntime: SessionRuntime    // 活跃 Agent 实例管理
      scheduler: Scheduler              // cron 轮询
      projectId: string
      deleteSession(agentId, sessionId) // compound — 跨 sessionRuntime + projectManager
      deleteAgent(agentId)              // compound — 跨三个模块
      shutdown()                        // compound — 幂等，按依赖逆序关停
    }
```

### 协调层设计

ProjectRuntime 不实现任何领域逻辑，只在操作跨越模块边界时接线：

- **单域操作**：server 直接访问对应模块（`projectManager.listAgents()`、`sessionRuntime.sendMessage()`、`scheduler.list()`）
- **compound 操作**：走 ProjectRuntime（`deleteSession`、`deleteAgent`、`shutdown`）

### 依赖关系（DAG，无循环）

```
Scheduler ──→ SessionRuntime ──→ ProjectStore
     └────────────────────→ ProjectStore
```

- SessionRuntime 和 Scheduler 各自持有 ProjectStore 实例（core 内部直接依赖）
- Scheduler 持有 SessionRuntime 引用（trigger 时调 createSession / sendMessage）
- ProjectRuntime 持有三个模块引用，负责 compound 操作和生命周期

### 各模块职责

#### `ProjectManager`（新建，包装 ProjectStore）

对外暴露安全的数据操作接口。Server 通过它访问项目数据，拿不到底层 store 实例。

构造函数只接收已 open 的 ProjectStore：

```ts
export class ProjectManager {
  constructor(projectStore: ProjectStore, logger?: Logger);
  close(): void;

  // 项目信息
  getRootPath(): string;
  getProjectId(): string;
  async regenerateProjectId(newId: string): Promise<void>;

  // Agent profile 管理
  listAgents(): AgentProfile[];
  getAgentProfile(agentId: string): AgentProfile | null;
  async createAgent(slug: string, content: string, themeContent?: string): Promise<AgentProfile>;
  async updateAgent(agentId: string, content: string, themeContent?: string): Promise<AgentProfile>;
  async deleteAgent(agentId: string): Promise<void>;
  async getRawContent(agentId: string): Promise<string | null>;
  async getAgentTheme(agentId: string): Promise<string>;
  async saveAgentTheme(agentId: string, content: string): Promise<void>;

  // Session 数据 CRUD（纯数据，不涉及活跃 Agent 实例）
  getSession(agentId: string, sessionId: string): SessionInfo | null;
  listSessions(agentId: string): SessionInfo[];
  renameSession(agentId: string, sessionId: string, title: string): SessionInfo;
  getSessionHistory(agentId: string, sessionId: string): unknown[];
  deleteSession(agentId: string, sessionId: string): void;

  // Skill
  listSkills(): SkillDefinition[];
  getSkill(name: string): SkillDefinition | null;

  // Settings
  getAiAccessSettings(): { deniedPaths: string[] };
  updateAiAccessSettings(paths: string[]): Promise<{ deniedPaths: string[] }>;
  getWelcomePageSettings(): { path: string | null };
  updateWelcomePageSettings(path: string | null): Promise<{ path: string | null }>;

  // 项目文件
  readIndex(): Promise<string>;
  updateIndex(content: string): Promise<void>;
  appendChangelog(entry: ChangelogEntry): Promise<void>;

  // 工具
  getFileWriteMutex(): FileWriteMutex;
}
```

`updateAgent` 封装了"先查已有 profile 再更新 profile.md"的逻辑（当前 `agent-write.ts` route 里 getProfile + saveProfile 两步调用收进 ProjectManager）。

#### `SessionRuntime`（新建，从 Engine 提取）

管理活跃的 pi-agent-core Agent 实例。负责构建 Agent（system prompt + tools + model）和执行对话。

```ts
export class SessionRuntime {
  constructor(projectStore: ProjectStore, options?: { defaultModel?: string; logger?: Logger });

  setDefaultModel(model: string | undefined): void;

  async createSession(agentId: string, source?: string): Promise<string>;
  async restoreSession(agentId: string, sessionId: string): Promise<string>;
  async sendMessage(sessionId: string, message: string, onEvent: AgentEventHandler): Promise<void>;
  abortSession(sessionId: string): void;
  destroySession(sessionId: string): void;
  hasActiveSession(sessionId: string): boolean;
  getTurnContext(sessionId: string): TurnContextSnapshot;
  evictAgent(agentId: string): void;
  closeAll(): void;

  private async buildAgent(profile: AgentProfile, sessionId: string): Promise<Agent>;
}
```

`createSession` 内部编排：
1. `projectStore.getAgent(agentId)` → agentStore
2. `agentStore.sessions.createSession()` → sessionId（数据记录）
3. `buildAgent(profile, sessionId)` → 活跃 Agent 实例
4. `activeSessions.set(sessionId, { agent, agentId })`

#### `Scheduler`（已有，适配）

构造函数从 `(engine, projectStore)` 改为 `(sessionRuntime, projectStore)`。

- trigger 时的 `this.engine.createSession` → `this.sessionRuntime.createSession`
- `loadFromProfiles` → `loadFromAgents`——已有，仅改构造函数参数类型

### `ProjectRuntime` 协调层

```ts
export class ProjectRuntime {
  readonly projectManager: ProjectManager;
  readonly sessionRuntime: SessionRuntime;
  readonly scheduler: Scheduler;
  readonly projectId: string;

  constructor(deps: { projectManager, sessionRuntime, scheduler, projectId });

  deleteSession(agentId: string, sessionId: string): void {
    this.sessionRuntime.destroySession(sessionId);
    this.projectManager.deleteSession(agentId, sessionId);
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.sessionRuntime.evictAgent(agentId);
    this.scheduler.unregisterAgent(agentId);
    await this.projectManager.deleteAgent(agentId);
  }

  async shutdown(): Promise<void> { /* 幂等 */ }
}
```

### `createProject` factory（替代 `createEngine`）

```ts
export async function createProject(
  projectRoot: string,
  options?: { projectName?: string; defaultModel?: string; logger?: Logger },
): Promise<ProjectRuntime> {
  // 1. 打开/创建 ProjectStore
  const projectStore = new ProjectStore(projectRoot, options?.logger);
  let isNewProject = false;
  try { await projectStore.open(); }
  catch {
    isNewProject = true;
    await projectStore.create(dirName, defaultModel);
  }

  // 2. presets（新项目）
  if (isNewProject) {
    await initPresets(projectStore, spherseDir, logger);
  }

  // 3. 创建三个模块
  const projectManager = new ProjectManager(projectStore, logger);
  const sessionRuntime = new SessionRuntime(projectStore, options);
  const scheduler = new Scheduler(sessionRuntime, projectStore, logger);
  await scheduler.loadFromAgents();

  // 4. 组装 ProjectRuntime（shutdown 逻辑封装在内部）
  return new ProjectRuntime({ projectManager, sessionRuntime, scheduler, projectId });
}
```

### 导出收紧

#### `store/index.ts`

```ts
export { ProjectStore } from "./project.js";
export type { ChangelogEntry } from "./project.js";
```

#### `core/index.ts`

```ts
// 运行时
export { ProjectRuntime } from "./project-runtime.js";
export { ProjectManager } from "./project-manager.js";
export { SessionRuntime } from "./session-runtime.js";
export type { AgentEventHandler, TurnContextSnapshot } from "./session-runtime.js";
export { Scheduler } from "./scheduler.js";
export type { ScheduleEventPayload } from "./scheduler.js";
export { createProject } from "./factory.js";

// 数据模型类型
export type { AgentProfile, SessionInfo, SkillDefinition, ScheduleEntry,
  ScheduleLogEntry, ProjectConfig, AppSettings, ProviderCatalogItem,
  ProviderModelItem, ProviderCatalog } from "./types.js";
export { PROJECT_META_DIR } from "./types.js";

// 工具
export { resolveProjectPath, isPathInside, assertInsideProject } from "./utils/path-safety.js";
export { getSupportedProviders, resolveModelById, ENABLED_PROVIDERS } from "./model-providers.js";
export { FileWriteMutex } from "./utils/file-write-mutex.js";
export type { Logger } from "./logger.js";
```

**移除的导出**：`Engine`、`createEngine`、`ProjectStore`、`ProjectConfigStore`、`AgentStore`、`AgentProfileStore`、`SessionStore`、`ScheduleStore`、`SkillStore`。

### Server 层改造

#### `ProjectContext` 收窄

```ts
// registry.ts
export interface ProjectContext {
  runtime: ProjectRuntime;
  projectManager: ProjectManager;
  sessionRuntime: SessionRuntime;
  scheduler: Scheduler;
  projectId: string;
}
```

registry 的 `doRegister` 适配 `createProject`，`remove` 调 `runtime.shutdown()`。

#### Route handler 改造

每个 route 的 `req.projectCtx!.engine.xxx()` 改为对应的模块：
- agent/session CRUD → `req.projectCtx!.projectManager.xxx()`
- session 运行时 → `req.projectCtx!.sessionRuntime.xxx()`
- schedule → `req.projectCtx!.scheduler.xxx()`
- settings/rootPath/fileWriteMutex → `req.projectCtx!.projectManager.xxx()`
- compound（deleteSession、deleteAgent）→ `req.projectCtx!.runtime.xxx()`

WS handler 同理：
- ws-chat → `ctx.sessionRuntime.restoreSession / sendMessage / abortSession`
- ws-schedule → `ctx.scheduler.on(...)`

## 文件清单

| 文件 | 动作 |
|------|------|
| `core/src/project-manager.ts` | **新建** |
| `core/src/session-runtime.ts` | **新建** |
| `core/src/project-runtime.ts` | **新建** |
| `core/src/engine.ts` | **删除** |
| `core/src/factory.ts` | **重写** — `createEngine` → `createProject` |
| `core/src/scheduler.ts` | 适配 — 构造函数参数 |
| `core/src/presets.ts` | 不变（仍接收 ProjectStore，core 内部） |
| `core/src/index.ts` | 更新导出 |
| `core/src/store/index.ts` | 收紧导出 |
| `server/src/registry.ts` | `ProjectContext` 适配 |
| `server/src/routes/*.ts` | 全部适配 |
| `server/src/ws-chat.ts` | 适配 |
| `server/src/ws-schedule.ts` | 适配 |

### 测试

| 文件 | 动作 |
|------|------|
| `__tests__/engine.test.ts` | **删除** |
| `__tests__/project-manager.test.ts` | **新建** |
| `__tests__/session-runtime.test.ts` | **新建** |
| `__tests__/scheduler.test.ts` | 适配 |
| `__tests__/presets.test.ts` | 不变 |
