# Agent 定时运行

## Background

当前 agent 只能由用户手动触发对话。用户希望为 agent 配置定时任务，让 agent 按固定间隔自动执行，产出内容或维护项目。典型场景包括每日自动生成世界观事件、定期审查项目一致性、定时向指定 session 追加分析等。

`AgentProfile` 类型中已有 `schedule?: string` 保留字段，但无实现。本 feature 填充该字段语义并实现完整的定时运行基础设施。

## Goal

- 用户可以为任意 agent 创建多条定时任务
- 定时任务在 app 运行期间自动触发，无需用户干预
- 支持两种运行模式：静默创建新 session / 向指定 session 发消息
- 定时任务的 session 与手动 session 混合展示，通过 `source` 字段区分来源
- 调度配置持久化，app 重启后自动恢复

## Constraints

- 仅在 app 开启状态下运行，不涉及系统级定时任务（cron job、launchd 等）
- 定时触发使用 Node.js timer，不依赖外部调度服务
- 调度逻辑放在 `@spherse/core` 层，保持与 Engine 同生命周期且可独立测试
- UI 预设选项（每30分钟、每小时等）仅为体验优化，底层数据模型统一使用 cron 表达式

## Design

### 1. 数据模型

#### ScheduleEntry

每个定时任务为一个 `ScheduleEntry`，一个 agent 可拥有多条。新增类型于 `packages/core/src/types.ts`：

```ts
export interface ScheduleEntry {
  id: string;
  name?: string;
  enabled: boolean;
  cron: string;
  mode: "new_session" | "existing_session";
  targetSessionId?: string;
  message: string;
  notify: boolean;
  createdAt: number;
  updatedAt: number;
}
```

- `id`：UUID，创建时生成
- `name`：可选显示名称（如"每日回顾"），未设置时 UI 显示 cron 表达式
- `cron`：标准 5 段 cron 表达式（分 时 日 月 星期），如 `0 9 * * *` 表示每天 9:00
- `mode`：`new_session` 每次触发静默创建新 session；`existing_session` 向指定 session 发消息
- `targetSessionId`：`existing_session` 模式下的目标 session ID
- `message`：消息模板，支持变量替换
- `notify`：完成后是否显示应用内 toast 通知

#### 消息模板变量

| 变量 | 替换为 | 示例 |
|------|--------|------|
| `{{date}}` | 当前日期 | `2026-06-11` |
| `{{time}}` | 当前时间 | `09:00` |
| `{{datetime}}` | 当前日期时间 | `2026-06-11 09:00` |
| `{{weekday}}` | 星期几 | `星期三`（跟随 locale） |
| `{{agent_name}}` | Agent 名称 | `World Builder` |

变量替换在 Scheduler 触发时执行，使用正则 `/{{(\w+)}}/g` 匹配。`{{weekday}}` 使用 `Intl.DateTimeFormat` 配合系统 locale 解析，不依赖 `@spherse/i18n`。

#### ScheduleLogEntry

每次触发执行的记录，追加写入 `schedule-logs.jsonl`：

```ts
export interface ScheduleLogEntry {
  scheduleId: string;
  sessionId: string;
  triggeredAt: number;
  completedAt?: number;
  status: "running" | "success" | "failed";
  error?: string;
}
```

#### Session 扩展

`SessionInfo` 新增 `source` 字段：

```ts
export interface SessionInfo {
  id: string;
  agentId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  status: "active" | "archived";
  source?: "manual" | "scheduled";
}
```

`source` 缺省时视为 `"manual"`，保持向后兼容。Scheduler 创建的 session 标记为 `"scheduled"`。

### 2. 存储布局

#### Agent 目录变更

```
.spherse/agents/{slug}-{shortId}/
├── profile.md            # schedule: true（布尔值）
├── theme.css
├── sessions.db           # sessions 表增加 source 列
├── schedules.yml         # ScheduleEntry[]
└── schedule-logs.jsonl   # ScheduleLogEntry[] 追加写入
```

#### Profile frontmatter 变更

`schedule` 字段从 `string` 改为 `boolean`：

```yaml
---
name: World Builder
schedule: true
---
```

`true` 表示该 agent 有定时任务（供快速筛选），具体配置在 `schedules.yml` 中。无定时任务时该字段不存在或为 `false`。`AgentProfile` 类型中 `schedule` 字段类型相应调整。

#### schedules.yml 格式

```yaml
- id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
  name: 每日回顾
  enabled: true
  cron: "0 9 * * *"
  mode: new_session
  message: "回顾昨天的创作进展，{{date}} {{weekday}}"
  notify: true
  createdAt: 1749600000000
  updatedAt: 1749600000000

- id: b2c3d4e5-f6a7-8901-bcde-f12345678901
  name: 持续分析
  enabled: true
  cron: "*/30 * * * *"
  mode: existing_session
  targetSessionId: sess-abc123
  message: "检查一致性，当前时间 {{datetime}}"
  notify: false
  createdAt: 1749600000000
  updatedAt: 1749600000000
```

#### schedule-logs.jsonl 格式

每行一个 JSON 对象，追加写入：

```jsonl
{"scheduleId":"a1b2c3d4-...","sessionId":"sess-xyz","triggeredAt":1749686400000,"status":"running"}
{"scheduleId":"a1b2c3d4-...","sessionId":"sess-xyz","triggeredAt":1749686400000,"completedAt":1749686460000,"status":"success"}
{"scheduleId":"a1b2c3d4-...","sessionId":"sess-qwe","triggeredAt":1749772800000,"status":"running"}
{"scheduleId":"a1b2c3d4-...","sessionId":"sess-qwe","triggeredAt":1749772800000,"completedAt":1749772830000,"status":"failed","error":"Model API timeout"}
```

### 3. Core Scheduler 模块

新增 `packages/core/src/scheduler.ts`，实现 `Scheduler` 类。

#### 类接口

```ts
export class Scheduler {
  constructor(engine: Engine, agentsDir: string, logger?: Logger);

  loadFromProfiles(): Promise<void>;
  register(agentId: string, entry: ScheduleEntry): void;
  unregister(agentId: string, scheduleId: string): void;
  update(agentId: string, scheduleId: string, entry: Partial<ScheduleEntry>): void;
  list(agentId: string): ScheduleEntry[];
  get(agentId: string, scheduleId: string): ScheduleEntry | null;
  getNextTrigger(agentId: string, scheduleId: string): Date | null;
  getRecentLogs(agentId: string, limit?: number): ScheduleLogEntry[];
  stopAll(): void;
}
```

#### 内部状态

```ts
private engine: Engine;
private agentsDir: string;
private timers: Map<string, NodeJS.Timeout>;            // scheduleId → timer
private entries: Map<string, ScheduleEntry>;             // scheduleId → config
private agentSchedules: Map<string, Set<string>>;        // agentId → scheduleId set
private scheduleStore: ScheduleStore;
private logger: Logger;
```

#### ScheduleStore

新增 `packages/core/src/store/schedule.ts`：

```ts
export class ScheduleStore {
  constructor(agentsDir: string, logger?: Logger);

  list(agentId: string): ScheduleEntry[];
  get(agentId: string, scheduleId: string): ScheduleEntry | null;
  save(agentId: string, entry: ScheduleEntry): void;
  delete(agentId: string, scheduleId: string): void;
  appendLog(agentId: string, entry: ScheduleLogEntry): void;
  getRecentLogs(agentId: string, limit?: number): ScheduleLogEntry[];
}
```

- 读写 `.spherse/agents/{slug}-{shortId}/schedules.yml`
- 追加写入 `.spherse/agents/{slug}-{shortId}/schedule-logs.jsonl`
- `agentId` → `slug-shortId` 目录映射复用 `AgentProfileStore` 的已有逻辑

#### 定时触发机制

使用 `setTimeout` 而非 `setInterval`，每次触发后重新计算下次时间：

```ts
private scheduleNext(entry: ScheduleEntry): void {
  const nextDate = getNextCronDate(entry.cron);
  if (!nextDate) return;

  const delay = nextDate.getTime() - Date.now();
  if (delay <= 0) return;

  const timer = setTimeout(() => this.trigger(entry), delay);
  this.timers.set(entry.id, timer);
}
```

选择 `setTimeout` 的原因：
- `setInterval` 在系统休眠后可能累积触发
- 每次触发后根据 cron 表达式计算精确的下次时间，避免漂移
- `disabled` 的 entry 不注册 timer

#### 触发执行流程

```ts
private async trigger(entry: ScheduleEntry): Promise<void> {
  const agentId = this.findAgentId(entry.id);
  const now = Date.now();
  const logEntry: ScheduleLogEntry = {
    scheduleId: entry.id,
    sessionId: "",
    triggeredAt: now,
    status: "running",
  };

  try {
    let sessionId: string;

    if (entry.mode === "new_session") {
      sessionId = await this.engine.createSession(agentId, { source: "scheduled" });
    } else {
      sessionId = entry.targetSessionId!;
      await this.engine.restoreSession(agentId, sessionId);
    }

    logEntry.sessionId = sessionId;
    this.scheduleStore.appendLog(agentId, logEntry);

    const resolvedMessage = this.resolveTemplate(entry.message);

    await this.engine.sendMessage(sessionId, resolvedMessage, (event) => {
      if (event.type === "agent_end") {
        logEntry.completedAt = Date.now();
        logEntry.status = "success";
        this.scheduleStore.appendLog(agentId, logEntry);
        this.emit("schedule_completed", { agentId, scheduleId: entry.id, sessionId, status: "success" });
      }
    });
  } catch (err) {
    logEntry.completedAt = Date.now();
    logEntry.status = "failed";
    logEntry.error = String(err);
    this.scheduleStore.appendLog(agentId, logEntry);
    this.emit("schedule_failed", { agentId, scheduleId: entry.id, error: String(err) });
  } finally {
    if (entry.enabled) {
      this.scheduleNext(entry);
    }
  }
}
```

关键设计决策：
- **并行执行**：同一 agent 的多个定时任务可同时运行，每个任务创建独立的 session
- **异常不中断调度**：单次执行失败记录日志后继续调度下次触发
- **事件通知**：通过 EventEmitter 向上层（server WebSocket）推送状态变化

`findAgentId(scheduleId)` 通过 `agentSchedules` 反向映射查找：遍历 `agentSchedules` 的每个 `agentId → Set<scheduleId>` 条目，找到包含该 `scheduleId` 的 `agentId`。查找结果可缓存在 `Map<scheduleId, agentId>` 中。

#### Cron 解析依赖

使用 `cron-parser` 库（轻量、无运行时副作用，仅用于计算下次触发时间）：

```ts
import { parseExpression } from "cron-parser";

function getNextCronDate(cron: string): Date | null {
  try {
    const interval = parseExpression(cron);
    return interval.next().toDate();
  } catch {
    return null;
  }
}
```

### 4. Engine 集成

#### Engine 变更

Engine 通过 `setScheduler` 注入 Scheduler（两阶段初始化，避免循环依赖）：

```ts
export class Engine {
  private scheduler?: Scheduler;

  setScheduler(scheduler: Scheduler): void {
    this.scheduler = scheduler;
  }

  getScheduler(): Scheduler {
    if (!this.scheduler) throw new Error("Scheduler not initialized");
    return this.scheduler;
  }

  async createSession(agentId: string, options?: { source?: string }): Promise<string> {
    // 新增 source 参数，传入 SessionStore.createSession
  }

  async shutdown(): Promise<void> {
    this.scheduler?.stopAll();
    this.sessionStore.close();
  }
}
```

#### createEngine 变更

```ts
export async function createEngine(projectRoot: string, options?: { ... }) {
  // ... 现有初始化 ...
  const scheduler = new Scheduler(engine, agentsDir, logger);
  engine.setScheduler(scheduler);
  await scheduler.loadFromProfiles();
  return engine;
}
```

Engine shutdown 在 `electron/server.ts` 的 `stopServer` 中调用，替换当前的 DB close 逻辑。

### 5. SessionStore 变更

#### sessions 表增加 source 列

```sql
ALTER TABLE sessions ADD COLUMN source TEXT DEFAULT 'manual';

-- 新建表时直接包含
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT DEFAULT 'active',
  source TEXT DEFAULT 'manual'
);
```

`SessionStore.createSession(agentId, options?: { source?: string })` 接受可选 `source` 参数。

### 6. Server API

#### REST 端点

新增路由文件 `packages/server/src/routes/schedules.ts`：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/agents/:agentId/schedules` | 列出该 agent 的所有定时任务 |
| `GET` | `/api/agents/:agentId/schedules/:scheduleId` | 获取单个定时任务详情 |
| `POST` | `/api/agents/:agentId/schedules` | 创建定时任务 |
| `PUT` | `/api/agents/:agentId/schedules/:scheduleId` | 更新定时任务 |
| `DELETE` | `/api/agents/:agentId/schedules/:scheduleId` | 删除定时任务 |
| `POST` | `/api/agents/:agentId/schedules/:scheduleId/trigger` | 手动触发一次（测试用） |
| `GET` | `/api/agents/:agentId/schedule-logs` | 获取最近的执行日志 |

#### Contracts

新增于 `packages/server/src/contracts/index.ts`：

```ts
scheduleEntry: Type.Object({
  id: Type.String(),
  name: Type.Optional(Type.String()),
  enabled: Type.Boolean(),
  cron: Type.String(),
  mode: Type.Union([Type.Literal("new_session"), Type.Literal("existing_session")]),
  targetSessionId: Type.Optional(Type.String()),
  message: Type.String(),
  notify: Type.Boolean(),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
}),

createScheduleRequest: Type.Object({
  name: Type.Optional(Type.String()),
  cron: Type.String(),
  mode: Type.Union([Type.Literal("new_session"), Type.Literal("existing_session")]),
  targetSessionId: Type.Optional(Type.String()),
  message: Type.String(),
  notify: Type.Boolean(),
}),

updateScheduleRequest: Type.Object({
  name: Type.Optional(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
  cron: Type.Optional(Type.String()),
  mode: Type.Optional(Type.Union([Type.Literal("new_session"), Type.Literal("existing_session")])),
  targetSessionId: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  notify: Type.Optional(Type.Boolean()),
}),

scheduleInfo: Type.Object({
  ...scheduleEntry fields,
  nextTriggerAt: Type.Optional(Type.Number()),
  lastTriggeredAt: Type.Optional(Type.Number()),
  lastStatus: Type.Optional(Type.Union([Type.Literal("success"), Type.Literal("failed")])),
}),

scheduleLogEntry: Type.Object({
  scheduleId: Type.String(),
  sessionId: Type.String(),
  triggeredAt: Type.Number(),
  completedAt: Type.Optional(Type.Number()),
  status: Type.Union([Type.Literal("running"), Type.Literal("success"), Type.Literal("failed")]),
  error: Type.Optional(Type.String()),
}),
```

`sessionInfo` contract 新增 `source` 可选字段。

#### WebSocket 事件通道

新增 WebSocket 端点 `/ws/schedule`，服务端向已连接的客户端推送定时任务事件：

```ts
// 服务端推送事件类型
type ScheduleServerEvent =
  | { type: "schedule_triggered"; agentId: string; scheduleId: string; sessionId: string; triggeredAt: number }
  | { type: "schedule_completed"; agentId: string; scheduleId: string; sessionId: string; status: "success" }
  | { type: "schedule_failed"; agentId: string; scheduleId: string; error: string }
  | { type: "schedule_updated"; agentId: string; schedule: ScheduleEntry };
```

路由文件 `packages/server/src/routes/ws-schedule.ts`：

```ts
fastify.get("/ws/schedule", { websocket: true }, (socket) => {
  // 注册到 Scheduler 的事件监听
  // Scheduler trigger/complete/fail 事件广播到所有连接的客户端
});
```

### 7. 前端 UI

#### 入口

Agent 列表中每个 agent 的上下文菜单（或下拉菜单）新增"定时任务"项。

#### 定时任务 Dialog

点击菜单项后打开 Dialog，展示该 agent 的所有定时任务列表，支持新增/编辑/删除/启停：

**列表区域：**
- 每条任务显示：名称（或 cron）、启用状态开关、下次触发时间、上次执行状态
- 点击展开编辑，点击"新增"按钮打开空白表单

**表单区域（新增/编辑）：**
- 名称（可选文本输入）
- 频率：预设下拉选择器 + 自定义 cron 输入
  - 预设选项：每 30 分钟、每小时、每天、每周
  - 选择预设后自动填入 cron 表达式，用户可手动修改
  - 选择"每天"/"每周"时显示时间选择器
  - 选择"每周"时显示星期选择器
- 运行模式：新建 session / 指定 session（下拉选择该 agent 的已有 session 列表）
- 消息模板：textarea，附带变量插入按钮组（`{{date}}`、`{{time}}` 等快捷插入）
- 完成通知：开关
- 保存 / 取消按钮

**预设 → Cron 映射：**

| 预设 | Cron | 额外 UI |
|------|------|---------|
| 每 30 分钟 | `*/30 * * * *` | 无 |
| 每小时 | `0 * * * *` | 无 |
| 每天 | `0 {HH} * * *` | 时间选择器 |
| 每周 | `0 {HH} * * {dow}` | 时间选择器 + 星期选择器 |
| 自定义 | 用户输入 | cron 输入框 |

#### Store 集成

`project-data-store` 新增：

```ts
// 状态
schedulesByAgent: Record<string, ScheduleEntry[]>;

// Actions
refreshSchedules(projectKey: string, client: ApiClient, agentId: string): Promise<void>;
createSchedule(projectKey: string, client: ApiClient, agentId: string, data: CreateScheduleRequest): Promise<void>;
updateSchedule(projectKey: string, client: ApiClient, agentId: string, scheduleId: string, data: UpdateScheduleRequest): Promise<void>;
deleteSchedule(projectKey: string, client: ApiClient, agentId: string, scheduleId: string): Promise<void>;
```

#### Toast 通知

监听 `/ws/schedule` WebSocket 事件：

- **触发开始**（仅当 `notify === true`）：`"{agentName} 定时任务「{scheduleName}」已开始执行"`
- **执行完成**（仅当 `notify === true`）：`"{agentName} 定时任务「{scheduleName}」执行完成"`，点击跳转对应 session
- **执行失败**（始终显示）：`"{agentName} 定时任务「{scheduleName}」执行失败: {error}"`，destructive 样式

#### API Client 扩展

`packages/app/src/lib/api.ts` 新增：

```ts
listSchedules(agentId: string): Promise<ScheduleInfo[]>;
getSchedule(agentId: string, scheduleId: string): Promise<ScheduleInfo>;
createSchedule(agentId: string, data: CreateScheduleRequest): Promise<ScheduleInfo>;
updateSchedule(agentId: string, scheduleId: string, data: UpdateScheduleRequest): Promise<ScheduleInfo>;
deleteSchedule(agentId: string, scheduleId: string): Promise<void>;
triggerSchedule(agentId: string, scheduleId: string): Promise<void>;
getScheduleLogs(agentId: string): Promise<ScheduleLogEntry[]>;
createScheduleWebSocket(onEvent: (event: ScheduleServerEvent) => void): WebSocket;
```

### 8. 测试覆盖

#### Core 层（`packages/core`）

- `ScheduleStore` 单元测试：CRUD、YAML 读写、日志追加与读取
- `Scheduler` 单元测试：
  - `loadFromProfiles` 正确注册所有定时任务
  - `register`/`unregister`/`update` 生命周期
  - `trigger` 的 new_session 和 existing_session 两种模式
  - 消息模板变量替换
  - 执行失败不中断后续调度
  - `stopAll` 清理所有 timer
  - cron 表达式解析与下次触发时间计算
- `SessionStore` 测试：新增 `source` 字段的创建与查询
- Engine 集成测试：`createSession` 传入 `source: "scheduled"` 后 session 正确标记

#### Server 层（`packages/server`）

- REST 路由测试：schedules CRUD + 手动触发
- `/ws/schedule` WebSocket 测试：事件推送
- Contract 校验测试

#### App 层（`packages/app`）

- Store 测试：`refreshSchedules`、`createSchedule`、`updateSchedule`、`deleteSchedule`
- Dialog 组件渲染测试
- 预设 → cron 映射测试

## Impact Summary

| 层 | 改动范围 |
|----|----------|
| `@spherse/core` types.ts | 新增 `ScheduleEntry`、`ScheduleLogEntry` 类型；`AgentProfile.schedule` 类型从 `string` 改为 `boolean`；`SessionInfo` 新增 `source` 字段 |
| `@spherse/core` scheduler.ts | 新增 `Scheduler` 类 |
| `@spherse/core` store/schedule.ts | 新增 `ScheduleStore` |
| `@spherse/core` store/session.ts | sessions 表增加 `source` 列；`createSession` 新增 `source` 参数 |
| `@spherse/core` engine.ts | 集成 `Scheduler`；`createSession` 新增 `options` 参数；新增 `shutdown` 方法 |
| `@spherse/server` contracts | 新增 schedule 相关 schema；`sessionInfo` 新增 `source` |
| `@spherse/server` routes | 新增 `schedules.ts` 和 `ws-schedule.ts` |
| `@spherse/app` lib/api.ts | 新增 schedule API 方法和 WebSocket |
| `@spherse/app` stores | `project-data-store` 新增 schedule 相关 state 和 actions |
| `@spherse/app` features | 新增 schedule dialog 组件；agent 菜单新增入口；toast 通知 |
| `@spherse/i18n` | 新增定时任务相关 UI 文案 |
| 新增依赖 | `cron-parser`（添加到 `@spherse/core`） |
