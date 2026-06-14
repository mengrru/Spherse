# Core Store 层树状重构

## 背景

单服务多项目重构完成后，core store 层暴露出明显的抽象问题：所有 store 实例都是**横向单实例**的——一个 `AgentProfileStore` 实例管理项目下所有 agent 的 profile，`SessionStore` 和 `ScheduleStore` 同理。这导致三个 store 内部各自实现了一遍「从 agentId 找目录」的逻辑，且互不一致（一个用 gray-matter、一个用正则、一个靠 list 全扫）。

store 应该改为**树状结构**：`ProjectStore` 作为聚合根持有 `Map<agentId, AgentStore>`，per-agent 的 store 在构造时就知道自己的目录。

## 现状问题

### 1. agentId → 目录的解析逻辑重复三遍

| Store | 方法 | 解析方式 |
|-------|------|---------|
| `AgentProfileStore` | `list()` :28 | `readdir` + gray-matter 解析每个 `profile.md` |
| `SessionStore` | `findAgentDir()` :56 | `readdirSync` + gray-matter `.data.id` |
| `ScheduleStore` | `findAgentDir()` :9 | `readdirSync` + 正则 `^id:\s*(\S+)/m` |

每次操作都触发全目录扫描（SessionStore 有 dirCache 但 ProfileStore 和 ScheduleStore 没有）。

### 2. ProjectStore 职责混杂

`ProjectStore`（220 行）混合了两层关注点：

| 关注点 | 方法 |
|--------|------|
| project.yaml 持久化 | `create/open`, `getProjectId/regenerateProjectId`, `getConfig`, `getAiAccessSettings/updateAiAccessSettings`, `getWelcomePageSettings/updateWelcomePageSettings`, `readProjectId` |
| 项目聚合根 | `getRootPath` |
| 项目级文件操作 | `readIndex/updateIndex`（AGENTS.md）, `appendChangelog`（CHANGELOG.md） |

yaml 读写细节（路径拼接、YAML.stringify、回写）散落在 7+ 个方法中，没有收敛到一个专门的 config 读写层。

### 3. per-agent 操作被迫带 agentId 参数

`SessionStore` 和 `ScheduleStore` 的每个方法都以 `agentId: string` 作为第一参数——这在 per-agent store 拆分后会自然消失。

### 4. `getById` / `getByName` 每次 list 全扫

`AgentProfileStore.getById(id)` 和 `.getByName(name)` 都是先 `list()` 全扫再 filter。树状结构中 `ProjectStore.getAgent(id)` 是 O(1) Map 查找。

## 选定方案

### 设计原则：thin aggregator

聚合根（`ProjectStore`、`AgentStore`）只持有子 store 并暴露它们，**不逐个 wrap 子 store 的方法**。调用方通过 getter 访问子 store，再调用子 store 自身的方法。

```
projectStore.config.getAiAccessSettings()       // ✓ 而非 projectStore.getAiAccessSettings()
projectStore.skill.list()                        // ✓ 而非 projectStore.getSkillStore().list()
agentStore.sessions.listSessions()               // ✓ 而非 agentStore.getSessionStore().listSessions()
agentStore.schedules.list()                      // ✓ 而非 agentStore.getScheduleStore().list()
```

### 目标结构

```
ProjectStore (聚合根)
├── config: ProjectConfigStore                  // .spherse/project.yaml 读写
├── skill: SkillStore                           // .spherse/skills/ (不变)
├── agents: ReadonlyMap<agentId, AgentStore>     // eager-loaded
│
└── AgentStore (per-agent 聚合)
    ├── profile: AgentProfileStore              // profile.md (单个 agent)
    ├── sessions: SessionStore                  // sessions.db (单个 agent)
    └── schedules: ScheduleStore                // schedules.yml + logs (单个 agent)
```

### eager 加载

`ProjectStore.open()` / `.create()` 时扫描一次 `.spherse/agents/` 目录，为每个子目录创建 `AgentStore` 实例。以典型项目 3-10 个 agent 的规模，扫描开销可忽略。

好处：
- `getAgent(id)` 是 O(1) Map 查找
- `SessionStore` / `ScheduleStore` 构造时直接拿到 db 文件路径，无需运行时查找
- `Scheduler.loadFromProfiles()` 遍历 `agents` Map 而非全盘扫描
- 新建 / 删除 agent 时由 `ProjectStore` 维护 Map 的增删，保持一致性

### 各 store 的职责边界

#### `ProjectConfigStore`（新建，从 ProjectStore 拆出）

纯管 `.spherse/project.yaml` 的读写，不涉及任何其他文件。

```ts
export class ProjectConfigStore {
  constructor(configPath: string, logger?: Logger);

  async read(): Promise<ProjectConfig>;           // 读 yaml，不修改
  async write(config: ProjectConfig): Promise<void>;
  get(): ProjectConfig;                             // 内存缓存（read/create 后可用）

  getProjectId(): string;
  async regenerateProjectId(newId: string): Promise<void>;

  // ai-access / welcome-page 都是 config 的子字段
  getAiAccessSettings(): { deniedPaths: string[] };
  updateAiAccessSettings(deniedPaths: string[]): Promise<{ deniedPaths: string[] }>;
  getWelcomePageSettings(): { path: string | null };
  updateWelcomePageSettings(path: string | null): Promise<{ path: string | null }>;
}
```

与现状相比，所有 `path.join(this.spherseDir, "project.yaml")` + `YAML.stringify` + `fs.writeFile` 的重复模式收敛到 `read()` / `write()` 两个方法。

#### `ProjectStore`（重构为聚合根）

thin aggregator：暴露子 store + 项目级文件操作 + agent 管理。不 wrap config/skill 的方法。

```ts
export class ProjectStore {
  constructor(projectRoot: string, logger?: Logger);

  // 生命周期
  async open(): Promise<void>;                     // 打开 config + 扫描 agents
  async create(name: string, defaultModel: string): Promise<void>;  // 新建项目 + presets

  // 项目级
  getRootPath(): string;

  // 子 store（未 open 时抛异常）
  get config(): ProjectConfigStore;
  get skill(): SkillStore;
  get agents(): ReadonlyMap<string, AgentStore>;

  // 项目级文件
  readIndex(): Promise<string>;                     // AGENTS.md
  updateIndex(content: string): Promise<void>;
  appendChangelog(entry: ChangelogEntry): Promise<void>;

  // Agent 管理（替代旧 AgentProfileStore 的全局方法）
  listAgents(): AgentProfile[];                     // 遍历 agents Map，返回 profiles
  getAgent(agentId: string): AgentStore | undefined;// O(1) 查找
  async createAgent(slug: string, content: string, themeContent?: string): Promise<AgentStore>;
  async deleteAgent(agentId: string): Promise<void>;

  // 清理
  close(): void;                                    // 关闭所有 agent 的 session db
}
```

> **设计决定**：`listAgents()` 返回 `AgentProfile[]` 而非 `AgentStore[]`。调用方（Engine、API route）绝大多数场景只需要 profile 数据（id、name、model、tools…），不需要拿到 store 句柄。需要深入操作时用 `getAgent(id)` 二次取。

#### `AgentStore`（新建，per-agent 聚合）

thin aggregator：暴露子 store + profile 便捷方法。

```ts
export class AgentStore {
  constructor(agentDir: string, logger?: Logger);

  async open(): Promise<AgentProfile>;              // 读 profile.md，初始化子 store
  getProfile(): AgentProfile;
  getAgentDir(): string;

  // 子 store
  get profile(): AgentProfileStore;
  get sessions(): SessionStore;
  get schedules(): ScheduleStore;

  close(): void;                                    // 关闭 session db
}
```

一个 `AgentStore` 实例对应磁盘上的 `.spherse/agents/<slug-shortid>/` 目录，持有 profile + session + schedule 三个子 store。

#### `AgentProfileStore`（重构为 per-agent）

```ts
export class AgentProfileStore {
  constructor(profilePath: string, slug: string);   // 精确到文件路径

  async read(): Promise<AgentProfile | null>;       // 读单个 profile.md
  async save(content: string): Promise<AgentProfile>;
  async getRawContent(): Promise<string>;
  getTheme(): Promise<string>;
  saveTheme(content: string): Promise<void>;
}
```

删除的方法（上移到 `ProjectStore`）：`list()`、`getById()`、`getByName()`、`delete()`。

`save()` 只负责更新已存在的 `profile.md`。slug 碰撞检测不再在此层处理（见下方 createAgent）。

#### `SessionStore`（重构为 per-agent）

```ts
export class SessionStore {
  constructor(dbPath: string, logger?: Logger);     // 精确到 db 文件路径

  createSession(title?: string, source?: string): string;  // 去掉 agentId 参数
  getSession(id: string): SessionInfo | null;
  listSessions(): SessionInfo[];
  archiveSession(sessionId: string): void;
  appendMessage(sessionId: string, message: any): void;
  getSessionMessages(sessionId: string): any[];
  updateSessionTitle(sessionId: string, title: string): void;
  close(): void;
}
```

删除的方法：`findAgentDir()`、`getDb(agentId)` 的 agentId 分发、`closeAgent(agentId)`。

`connections: Map<agentId, Database>` 退化为单个 `db: Database.Database`。

#### `ScheduleStore`（重构为 per-agent）

```ts
export class ScheduleStore {
  constructor(agentDir: string, logger?: Logger);   // 精确到 agent 目录

  list(): ScheduleEntry[];                          // 去掉 agentId 参数
  get(scheduleId: string): ScheduleEntry | null;
  saveAll(entries: ScheduleEntry[]): void;
  create(entry: ScheduleEntry): void;
  update(scheduleId: string, partial: Partial<ScheduleEntry>): ScheduleEntry | null;
  delete(scheduleId: string): void;
  deleteAll(): void;
  appendLog(entry: ScheduleLogEntry): void;
  getRecentLogs(limit?: number): ScheduleLogEntry[];
}
```

删除的方法：`findAgentDir()`（模块级函数）、`resolveAgentDir()`。

文件路径在构造时确定：`schedules.yml` = `agentDir/schedules.yml`，`schedule-logs.jsonl` = `agentDir/schedule-logs.jsonl`。

#### `SkillStore`（不变）

保持现状。skill 是项目级的（`.spherse/skills/`），不属于任何 agent。

### 消除的重复代码

| 消除项 | 现状 | 重构后 |
|--------|------|--------|
| agentId→目录解析 | 3 处不同实现 | 0 处（构造时确定） |
| `getSession(agentId, id)` 模式 | 每个 SessionStore 方法带 agentId | 方法无 agentId |
| profile.list() 全扫做 getById | O(n) 每次 | O(1) Map 查找 |
| schedule.findAgentDir | 正则解析 profile.md | 构造时已知 |

### createAgent

`ProjectStore.createAgent(slug, content)` 创建新 agent 目录、写入 `profile.md`、构造 `AgentStore` 并加入 `agents` Map。

```ts
async createAgent(slug: string, content: string, themeContent?: string): Promise<AgentStore> {
  // 1. 解析 frontmatter，生成 id
  // 2. 确定目录名：slug-shortid
  // TODO: 该处可能需要 slug 碰撞检测（查 agents Map + 文件系统），
  //       当前先假设 slug-shortid 不碰撞，后续按需补全
  // 3. mkdir + 写 profile.md
  // 4. 创建 AgentStore 并加入 agents Map
  // 5. 若有 themeContent，写 theme.css
}
```

> 现有 `AgentProfileStore.save()` :55-101 的碰撞检测逻辑（id 重生成 + 10 次重试循环）暂不迁移。先简化为目录名 = `slug-shortid`，后续真正遇到碰撞问题再做。

## Scheduler 适配

Scheduler 构造函数从 `(engine, agentsDir)` 改为 `(engine, projectStore)`，采用方案 A：

- **去掉内部的 `scheduleStore` 字段**，所有持久化操作改为 `projectStore.getAgent(agentId).schedules.xxx()`
- `loadFromProfiles()` 遍历 `projectStore.agents` 而非 `engine.listProfiles()` + `scheduleStore.list(agentId)`
- `register()` / `unregister()` 等运行时方法每次通过 `projectStore.getAgent(agentId)` 取 ScheduleStore

Scheduler 的 cron 轮询、内存 Map（`entries` / `scheduleAgentMap` / `nextTriggerMap`）、事件分发逻辑均不变。运行时新建/修改/删除 schedule 的数据流不变（register/unregister 双写内存 + store），不影响新建任务的触发。

## 文件清单

| 文件 | 动作 |
|------|------|
| `packages/core/src/store/project-config.ts` | **新建** — ProjectConfigStore |
| `packages/core/src/store/project.ts` | **重写** — ProjectStore 变为聚合根 |
| `packages/core/src/store/agent-store.ts` | **新建** — AgentStore 聚合 |
| `packages/core/src/store/agent-profile.ts` | **精简** — 去掉 list/getById/getByName/delete，save 去掉碰撞逻辑 |
| `packages/core/src/store/session.ts` | **精简** — 去掉 agentId 参数和 findAgentDir |
| `packages/core/src/store/schedule.ts` | **精简** — 去掉 agentId 参数和 findAgentDir |
| `packages/core/src/store/skill.ts` | 不变 |
| `packages/core/src/store/index.ts` | 更新导出 |
| `packages/core/src/factory.ts` | 适配（简化——不再手动拼路径创建各 store） |
| `packages/core/src/presets.ts` | `initPresets` 参数从 `AgentProfileStore` 改为 `ProjectStore` |
| `packages/core/src/scheduler.ts` | 适配——构造函数改为 `(engine, projectStore)`，持久化通过 `projectStore.getAgent(agentId).schedules` |
| `packages/core/src/index.ts` | 更新导出 |

### 测试

| 文件 | 动作 |
|------|------|
| `__tests__/store/project-config.test.ts` | **新建** |
| `__tests__/store/project.test.ts` | 重写——测 agent 管理（list/create/delete/getAgent） |
| `__tests__/store/agent-store.test.ts` | **新建** |
| `__tests__/store/agent-profile.test.ts` | 精简——去掉 list/getById 测试，测单文件读写 |
| `__tests__/store/session.test.ts` | 精简——去掉 agentId 参数和多 agent 测试 |
| `__tests__/store/schedule.test.ts` | 精简——同上 |
| `__tests__/store/skill.test.ts` | 不变 |
| `__tests__/engine.test.ts` | 适配新 store 签名 |
| `__tests__/scheduler.test.ts` | 适配——构造函数签名变化 |

## 不在本次范围

- **Engine 层重构**：Engine 当前是 305 行的 fat object，直接持有 4 个 store + activeSessions + fileWriteMutex + scheduler。store 树状化后 Engine 需要适配（至少改构造函数和方法签名），但 Engine 自身的拆分（是否变为 per-session、是否拆出 AgentRunner 等）是独立的后续工作，另行设计。
- **API 层（server routes）适配**：Engine 适配完后 server 层自然通过，不直接依赖 store 类。
- **contracts schema**：不变。
