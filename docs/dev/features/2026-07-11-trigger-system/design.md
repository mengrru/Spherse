# Trigger System（触发器系统）

## Background

当前 agent 只能通过 cron 定时任务（scheduler）自动执行。用户希望将 scheduler 升级为更通用的「触发器」系统，支持两种触发模式：

- **时间触发**：即现有 scheduler，用户配置 cron 表达式
- **事件触发**：用户配置自定义事件名，当事件被触发时执行

核心思路是：TriggerManager 提供两个入口方法 `onTimeTick()`（由 TimerService 每 10 分钟回调）和 `onUserEvent(eventName, payload)`（由前端通过 ws-bus 触发）。每次入口被调用时，TriggerManager 直接读盘遍历所有 agent 的 trigger 配置，匹配后执行。不需要在内存中维护 trigger 注册表。

### 事件来源

| 来源 | 说明 | 本次实现 |
|------|------|---------|
| TimerService | 后台每 10 分钟回调 `triggerManager.onTimeTick()` | ✅ |
| 前端（UI SDK / bus-store） | 通过 `/ws/bus` 发送 `{kind:"emit-trigger-event", eventName, payload}` | ✅ |
| LLM tool | agent 通过 tool emit 事件名 + payload | ❌（未来） |

### Payload

payload 是 **string**，即触发任务时追加到 message 的内容。trigger 配置中可通过占位变量 `{{payload}}` 将 payload 原样注入 message。时间触发器触发时 payload 为空字符串（时间信息通过 `{{date}}` / `{{time}}` 等已有变量获取）。

## Goal

- 将 scheduler 全面重命名为 trigger（代码、类型、路由、store、i18n、磁盘目录）
- 时间触发和事件触发共享同一套执行配置（mode/message/notify/notificationMessage）
- `{{payload}}` 注入 message 和 notificationMessage（payload 为纯字符串替换）
- 前端可通过 `/ws/bus` 发送 `emit-trigger-event` 消息触发事件（含 UI SDK `emitAgentTriggerEvent` action）
- 保留 `sp:` 前缀作为内部保留事件名空间

## Constraints

- 仅在 app 运行期间工作，不涉及系统级定时任务
- 时间触发仍为 10 分钟轮询（继承当前实现）
- 磁盘目录从 `schedules/` → `triggers/`（项目未上线，不做迁移）
- 全量重命名，代码中不再保留 "schedule" 字样

## Design

### 1. 架构总览

```
┌─────────────────────────────────────────────────────────┐
│  Core (per-project)                                     │
│                                                         │
│  ┌──────────────┐    callback (every 10 min)            │
│  │ TimerService │──────────────┐                         │
│  └──────────────┘              │                         │
│                                ▼                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │              TriggerManager                       │   │
│  │                                                   │   │
│  │  onTimeTick():           onUserEvent(name,payload):│  │
│  │   read all from disk     read all from disk        │  │
│  │   match time triggers    match event triggers      │  │
│  │   check cron due          fire directly            │  │
│  │                                                   │   │
│  │  fire(entry, payload) → createSession/sendMessage  │  │
│  │  emit trigger_triggered/completed/failed/updated   │  │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         ▲                                    │
         │ onUserEvent(eventName, payload)     │ EventEmitter
         │                                    ▼
┌────────┴─────────────┐           ┌───────────────────────┐
│  Server ws-bus        │           │  Server ws-bus         │
│  {kind:"emit-trigger  │           │  trigger channel       │
│   -event"}            │           │  → renderer bus-store  │
│  → triggerManager     │           │                        │
│    .onUserEvent()     │           │                        │
└───────────────────────┘           └───────────────────────┘
         ▲                                    │
         │                                    ▼
┌────────┴──────────────────────────────────────────────────────┐
│  Renderer                                                     │
│  bus-store.emitAgentTriggerEvent()  ←──  UI SDK                │
│     dispatchAction("emitAgentTriggerEvent")                   │
│  TriggerEventBridge    ←──  useBusSubscription("trigger")     │
└───────────────────────────────────────────────────────────────┘
```

### 2. Core 层

#### 2.1 类型定义（`packages/core/src/types.ts`）

```ts
export type TriggerType = "time" | "event";

export interface TriggerEntry {
  id: string;
  name?: string;
  enabled: boolean;
  type: TriggerType;
  cron?: string;            // type === "time" 时必填
  eventName?: string;       // type === "event" 时必填，用户自定义非空字符串
  mode: "new_session" | "existing_session";
  targetSessionId?: string;
  message: string;
  notify: boolean;
  notificationMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TriggerLogEntry {
  triggerId: string;
  triggerName?: string;
  agentName?: string;
  eventName?: string;       // 触发此执行的事件名
  sessionId: string;
  triggeredAt: number;
  completedAt?: number;
  status: "running" | "success" | "failed";
  error?: string;
}
```

`ScheduleEntry` / `ScheduleLogEntry` 删除。`AgentProfile.schedule` 字段删除（已废弃，实际无写入路径）。`SessionInfo.source` 值 `"scheduled"` 改为 `"triggered"`。

#### 2.2 TimerService（`packages/core/src/trigger/timer-service.ts`）

从 Scheduler 中提取的 10 分钟轮询逻辑，职责单一：每 10 分钟调用回调函数。不依赖 EventBus，通过构造函数注入回调。

```ts
export class TimerService {
  private static POLL_INTERVAL = 10 * 60 * 1000;
  private timer: NodeJS.Timeout | null = null;

  constructor(private onTick: () => void, private logger: Logger) {}

  start(): void {
    // 对齐到下一个 10 分钟边界，与原 Scheduler 逻辑一致
    const now = Date.now();
    const msToNext = TimerService.POLL_INTERVAL - (now % TimerService.POLL_INTERVAL);
    this.scheduleNext(msToNext);
  }

  private scheduleNext(delay: number): void {
    this.timer = setTimeout(() => {
      this.onTick();
      this.scheduleNext(TimerService.POLL_INTERVAL);
    }, delay);
    this.timer.unref();
  }

  stop(): void { ... }
}
```

#### 2.3 模板变量解析（`packages/core/src/trigger/template.ts`）

从 `scheduler.ts` 提取 `resolveTemplateVars`，payload 改为 string 类型：

```ts
export interface TemplateContext {
  agentName: string;
  payload: string;    // 纯字符串
}

export function resolveTemplateVars(message: string, ctx: TemplateContext): string {
  return message.replace(/{{(\w+)}}/g, (_match, key: string) => {
    if (key === "agent_name") return ctx.agentName;
    if (key === "payload") return ctx.payload;
    if (["date", "time", "datetime", "weekday"].includes(key)) return timeVar(key);
    return `{{${key}}}`;
  });
}
```

- `{{payload}}`：直接替换为 payload 字符串
- `{{date}}` / `{{time}}` / `{{datetime}}` / `{{weekday}}`：保持原行为（时间触发和事件触发均可用，取当前时间）
- `{{agent_name}}`：保持原行为
- 不再支持 `{{payload.path}}` dot-path 取值（payload 是 string，不是 object）

`weekday` locale 修复：原代码硬编码 `zh-CN`，改为接受 locale 参数（从 server 传入，server 从 settings 获取）。具体见 §2.5 接线。

#### 2.4 TriggerStore（`packages/core/src/store/trigger.ts`）

从 `ScheduleStore` 重命名，目录 `schedules/` → `triggers/`：

```
<agentDir>/triggers/
├── index.yml     # YAML array of TriggerEntry
└── logs.jsonl    # append-only TriggerLogEntry
```

接口与 `ScheduleStore` 完全一致（`list` / `get` / `saveAll` / `create` / `update` / `delete` / `deleteAll` / `appendLog` / `getRecentLogs`），仅类型从 `ScheduleEntry` → `TriggerEntry`。

项目未上线，不做 `schedules/` → `triggers/` 迁移，直接使用新目录。

#### 2.5 TriggerManager（`packages/core/src/trigger/trigger-manager.ts`）

替代 `Scheduler`，继承 `EventEmitter`（用于 trigger 生命周期事件，与 ws-bus 对接）。

**设计原则：磁盘为唯一真相源，不在内存维护 trigger 注册表。** 每次事件到达时直接读盘遍历所有 agent 的 trigger 配置。CRUD 操作只写盘（通过 TriggerStore），不需要通知 TriggerManager。

**内存状态**（最小化）：
- `inProgress: Set<string>` — 正在执行的 triggerId（防重入）
- `triggerState: Map<string, { cron: string; nextFire: number }>` — time 类型的下次触发时间（lazy-built，每次 onTimeTick 从磁盘重建）

**入口方法**：

```ts
constructor(deps: {
  sessionRuntime: SessionManager;
  projectStore: ProjectStore;
  logger?: Logger;
}) {
  super();
}

/** TimerService 每 10 分钟回调 */
onTimeTick(): void {
  const now = Date.now();
  const allTriggers = this.readAllTriggers();  // 从磁盘读取所有 agent 的 triggers

  for (const { agentId, agentName, entry } of allTriggers) {
    if (entry.type !== "time" || !entry.enabled) continue;
    if (this.inProgress.has(entry.id)) continue;

    // lazy-build nextFire: 新 trigger 或 cron 变更时重新计算
    let state = this.triggerState.get(entry.id);
    if (!state || state.cron !== entry.cron) {
      const nextDate = getNextCronDate(entry.cron!);
      state = { cron: entry.cron!, nextFire: nextDate ? nextDate.getTime() : 0 };
      this.triggerState.set(entry.id, state);
    }

    if (state.nextFire > 0 && state.nextFire <= now) {
      // 重算下次触发时间
      const nextDate = getNextCronDate(entry.cron!);
      state.nextFire = nextDate ? nextDate.getTime() : 0;

      this.inProgress.add(entry.id);
      void this.fire(entry, agentId, agentName, "").finally(() => {
        this.inProgress.delete(entry.id);
      });
    }
  }

  // GC: 清除磁盘上已不存在的 trigger 的内存状态
  this.gcTriggerState(allTriggers);
}

/** 前端通过 ws-bus 触发 */
onUserEvent(eventName: string, payload: string): void {
  if (eventName.startsWith("sp:")) return;  // 保留前缀

  const allTriggers = this.readAllTriggers();
  for (const { agentId, agentName, entry } of allTriggers) {
    if (entry.type !== "event" || !entry.enabled) continue;
    if (this.inProgress.has(entry.id)) continue;
    if (entry.eventName !== eventName) continue;

    this.inProgress.add(entry.id);
    void this.fire(entry, agentId, agentName, payload, eventName).finally(() => {
      this.inProgress.delete(entry.id);
    });
  }
}
```

**读盘方法**：

```ts
private readAllTriggers(): Array<{ agentId: string; agentName: string; entry: TriggerEntry }> {
  const result: Array<{ agentId: string; agentName: string; entry: TriggerEntry }> = [];
  for (const [agentId, agentStore] of this.projectStore.agents) {
    const entries = agentStore.triggers.list();  // 读 triggers/index.yml
    const profile = agentStore.getProfile();
    for (const entry of entries) {
      result.push({ agentId, agentName: profile.name, entry });
    }
  }
  return result;
}

private gcTriggerState(all: Array<{ entry: TriggerEntry }>): void {
  const diskIds = new Set(all.map((t) => t.entry.id));
  for (const id of this.triggerState.keys()) {
    if (!diskIds.has(id)) this.triggerState.delete(id);
  }
}
```

**fire()**（从 `trigger()` 重命名，接受 payload string）：

```ts
private async fire(
  entry: TriggerEntry,
  agentId: string,
  agentName: string,
  payload: string,
  eventName?: string,
): Promise<void> {
  const now = Date.now();
  const logEntry: TriggerLogEntry = {
    triggerId: entry.id,
    triggerName: entry.name || (entry.type === "time" ? entry.cron! : entry.eventName!),
    agentName,
    eventName,
    sessionId: "",
    triggeredAt: now,
    status: "running",
  };

  this.emit("trigger_triggered", { agentId, triggerId: entry.id, eventName, triggeredAt: now });

  try {
    let sessionId: string;
    if (entry.mode === "new_session") {
      sessionId = await this.sessionRuntime.createSession(agentId, "triggered");
    } else if (entry.targetSessionId) {
      sessionId = entry.targetSessionId;
      await this.sessionRuntime.restoreSession(agentId, sessionId);
    } else {
      throw new Error("existing_session mode but no targetSessionId");
    }

    logEntry.sessionId = sessionId;
    this.getTriggerStore(agentId)?.appendLog(logEntry);

    const resolvedMessage = resolveTemplateVars(entry.message, { agentName, payload });
    // 同样对 notificationMessage 做 resolveTemplateVars（支持 {{payload}}）

    await this.sessionRuntime.sendMessage(sessionId, resolvedMessage, (event) => {
      if (event.type === "agent_end") {
        this.getTriggerStore(agentId)?.appendLog({ ...logEntry, completedAt: Date.now(), status: "success" });
        this.emit("trigger_completed", { agentId, triggerId: entry.id, sessionId, status: "success" });
      }
    });
  } catch (err) {
    this.getTriggerStore(agentId)?.appendLog({ ...logEntry, completedAt: Date.now(), status: "failed", error: String(err) });
    this.emit("trigger_failed", { agentId, triggerId: entry.id, error: String(err) });
  }
}
```

**公开 API（CRUD + 查询 — 全部委托给 TriggerStore，不在内存缓存）**：

- `list(agentId): TriggerEntry[]` — `agentStore.triggers.list()`
- `get(agentId, triggerId): TriggerEntry | null` — `agentStore.triggers.get(triggerId)`
- `create(agentId, entry): void` — `agentStore.triggers.create(entry)`；emit `trigger_updated`
- `update(agentId, triggerId, partial): TriggerEntry | null` — `agentStore.triggers.update(triggerId, partial)`；emit `trigger_updated`；清除 `triggerState` 中该 ID 的缓存（让下次 tick 重建）
- `delete(agentId, triggerId): void` — `agentStore.triggers.delete(triggerId)`；`triggerState.delete(triggerId)`
- `deleteAllForAgent(agentId): void` — `agentStore.triggers.deleteAll()`（agent 删除时调用）
- `getNextTrigger(agentId, triggerId): Date | null` — 读盘获取 entry，仅 time + enabled 类型计算 `cron.next()`
- `getRecentLogs(agentId, limit?): TriggerLogEntry[]` — `agentStore.triggers.getRecentLogs(limit)`
- `runNow(agentId, triggerId): TriggerEntry | null` — 手动触发：读盘获取 entry，直接 `fire()`；时间触发器也重算 `triggerState`
- `stopAll(): void` — 清除 `inProgress`

**manual trigger（runNow）语义**：手动触发不走 `onTimeTick` / `onUserEvent`，直接读盘获取 entry 后调用 `fire(entry, agentId, agentName, "")`（payload 为空字符串）。

#### 2.6 AgentStore 变更

`get schedules()` → `get triggers(): TriggerStore`

#### 2.7 接线变更

**`factory.ts`**：
```ts
const triggerManager = new TriggerManager({ sessionRuntime, projectStore, logger });
const timerService = new TimerService(() => triggerManager.onTimeTick(), logger);
timerService.start();

return new ProjectRuntime({ projectManager, sessionRuntime, triggerManager, timerService, projectId, logger });
```

**`project-runtime.ts`**：
- `scheduler: Scheduler` → `triggerManager: TriggerManager`
- `timerService: TimerService`（新增）
- `deleteAgent()` → `this.triggerManager.deleteAllForAgent(agentId)`
- `shutdown()` → `this.timerService.stop(); this.triggerManager.stopAll();`

**`index.ts`（barrel）**：
- `export type { Scheduler }` → `export type { TriggerManager }`
- `export type { ScheduleEventPayload }` → `export type { TriggerEventPayload }`
- 新增 `export type { TimerService }`

### 3. Server 层

#### 3.1 Contracts

**`contracts/trigger.ts`**（替代 `contracts/schedules.ts`）：

```ts
const triggerEntry = Type.Object({
  id: Type.String(),
  name: Type.Optional(Type.String()),
  enabled: Type.Boolean(),
  type: Type.Union([Type.Literal("time"), Type.Literal("event")]),
  cron: Type.Optional(Type.String()),
  eventName: Type.Optional(Type.String()),
  mode: Type.Union([Type.Literal("new_session"), Type.Literal("existing_session")]),
  targetSessionId: Type.Optional(Type.String()),
  message: Type.String(),
  notify: Type.Boolean(),
  notificationMessage: Type.Optional(Type.String({ maxLength: 30 })),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
});

const triggerInfoEntry = Type.Intersect([
  triggerEntry,
  Type.Object({ nextTriggerAt: Type.Union([Type.Number(), Type.Null()]) }),
]);

const triggerCreateRequest = Type.Object({
  name: Type.Optional(Type.String()),
  type: Type.Union([Type.Literal("time"), Type.Literal("event")]),
  cron: Type.Optional(Type.String()),
  eventName: Type.Optional(Type.String()),
  mode: Type.Union([Type.Literal("new_session"), Type.Literal("existing_session")]),
  targetSessionId: Type.Optional(Type.String()),
  message: Type.String(),
  notify: Type.Boolean(),
  notificationMessage: Type.Optional(Type.String({ maxLength: 30 })),
});
// triggerUpdateRequest: 所有字段 Optional，增加 type/cron/eventName
```

导出类型重命名：`TriggerEntryContract`、`TriggerInfoEntryContract`、`TriggerListResponse`、`TriggerCreateRequest`、`TriggerUpdateRequest`、`TriggerLogEntryContract`、`TriggerLogListResponse`。

**`contracts/bus.ts`** 变更：

1. channel `"schedule"` → `"trigger"`
2. event type 前缀 `schedule_` → `trigger_`
3. `scheduleUpdatedPayload.schedule` 用 `triggerEntry` schema 替代 `Type.Unknown()`（消除技术债）
4. 新增 `emit-trigger-event` client message：

```ts
const busClientMessage = Type.Union([
  Type.Object({ kind: Type.Literal("subscribe"), projectId, channel: busClientChannel }),
  Type.Object({ kind: Type.Literal("unsubscribe"), projectId, channel: busClientChannel }),
  Type.Object({ kind: Type.Literal("ping") }),
  Type.Object({
    kind: Type.Literal("emit-trigger-event"),
    projectId: Type.String(),
    eventName: Type.String({ minLength: 1 }),
    payload: Type.Optional(Type.String()),  // 纯字符串
  }),
]);
```

`busClientChannel` 更新：`"trigger"` 替代 `"schedule"`。

**`contracts/index.ts`**：更新所有 re-export 名称。

#### 3.2 Routes（`routes/trigger.ts`）

替代 `routes/schedules.ts`，endpoint 重命名：

| Method | Path |
|--------|------|
| GET | `.../triggers` |
| GET | `.../triggers/:triggerId` |
| POST | `.../triggers` |
| PUT | `.../triggers/:triggerId` |
| DELETE | `.../triggers/:triggerId` |
| POST | `.../triggers/:triggerId/run` |
| GET | `.../trigger-logs` |

Create / Update 校验逻辑：

```ts
// type-specific validation
if (type === "time" && !isValidCron(cron)) throw badRequest("invalid cron expression");
if (type === "event") {
  if (!eventName?.trim()) throw badRequest("eventName is required for event type");
  if (eventName.startsWith("sp:")) throw badRequest("eventName cannot use reserved prefix 'sp:'");
}
```

`req.projectCtx!.scheduler` → `req.projectCtx!.triggerManager`。

#### 3.3 ws-bus.ts 变更

**subscribe `"trigger"` channel**（替代 `"schedule"`）：

```ts
const TRIGGER_EVENT_TYPES = ["trigger_triggered", "trigger_completed", "trigger_failed", "trigger_updated"];

case "trigger": {
  const ctx = this.registry.get(projectId);
  // 为每个 trigger 事件类型注册 listener → safeSend
  for (const type of TRIGGER_EVENT_TYPES) {
    ctx.triggerManager.on(type, handler);
  }
}
```

`buildTriggerPayload` 替代 `buildSchedulePayload`，使用 `triggerId` 而非 `scheduleId`。`trigger_updated` 的 `trigger` 字段用 `triggerEntry` schema 验证（不再 `Type.Unknown()`）。

**`emit-trigger-event` message handling**（新增）：

```ts
case "emit-trigger-event": {
  const ctx = this.registry.get(msg.projectId);
  if (!ctx) return;
  ctx.triggerManager.onUserEvent(msg.eventName, msg.payload ?? "");
  break;
}
```

- 任何已连接 client 都可 emit 事件，无需 subscribe
- `sp:` 前缀拒绝由 `onUserEvent` 内部处理
- 不返回 ack（fire-and-forget；trigger 执行异步进行，通过 trigger channel 事件通知结果）

#### 3.4 Registry 变更

```ts
export interface ProjectContext {
  runtime: ProjectRuntime;
  projectManager: ProjectManager;
  sessionRuntime: SessionManager;
  triggerManager: TriggerManager;   // was: scheduler
  projectId: string;
}
```

### 4. Frontend 层

#### 4.1 Feature 目录重命名

`features/agent-schedule/` → `features/agent-trigger/`

| 旧文件 | 新文件 |
|--------|--------|
| `index.tsx` | `index.tsx`（`ScheduleDialog` → `TriggerDialog`） |
| `store.ts` | `store.ts`（`useScheduleStore` → `useTriggerStore`） |
| `ScheduleEventBridge.tsx` | `TriggerEventBridge.tsx` |
| `ScheduleForm.tsx` | `TriggerForm.tsx` |
| `ScheduleList.tsx` | `TriggerList.tsx` |
| `ScheduleLogs.tsx` | `TriggerLogs.tsx` |
| `schedule-form-reducer.ts` | `trigger-form-reducer.ts` |
| `hooks/use-schedule-logs.ts` | `hooks/use-trigger-logs.ts` |
| `constants.ts` | `constants.ts` |
| `store.test.ts` | `store.test.ts` |
| `ScheduleFeature.structure.test.tsx` | `TriggerFeature.structure.test.tsx` |

#### 4.2 Store（`store.ts`）

全面重命名：

```ts
interface TriggerProjectData {
  triggersByAgent: Record<string, TriggerInfo[]>;
  runningTriggerIdsByAgent: Record<string, string[]>;
  triggerEventVersion: number;
}

interface TriggerStore {
  byProject: Record<string, TriggerProjectData>;
  refreshTriggers(projectId, client, agentId): Promise<void>;
  createTrigger(...): Promise<void>;
  updateTrigger(...): Promise<void>;
  deleteTrigger(...): Promise<void>;
  runTrigger(...): Promise<void>;            // was: triggerSchedule
  handleTriggerEvent(projectId, client, event): void;
  clearProject(projectId): void;
}
```

`refreshTriggers` 写入 `useProjectDataStore.setHasEnabledTriggers`（替代 `setHasEnabledSchedules`）。

#### 4.3 Form（`TriggerForm.tsx`）

**新增触发类型选择器**（type selector）：

```
┌─────────────────────────────────────────┐
│ 触发类型                                 │
│  [时间触发]  [事件触发]                   │
├─────────────────────────────────────────┤
│ type === "time":                        │
│  频率: [cron input]                      │
│  [每30分钟] [每小时] [每天09:00] ...      │
│  定时任务每 10 分钟检查一次...            │
├─────────────────────────────────────────┤
│ type === "event":                        │
│  事件名: [input] (如 "daily-review")     │
│  当此事件被触发时执行                     │
├─────────────────────────────────────────┤
│ 名称: [input]                            │
│ 消息内容: [textarea]                      │
│  {{payload}} (event) / {{date}} (time)   │  ← 变量按钮按 type 动态显示
│ 会话模式: [新建对话] [已有对话]            │
│ 完成后通知: [switch]                      │
└─────────────────────────────────────────┘
```

**form reducer** 新增字段：

```ts
export type TriggerFormFields = {
  type: TriggerType;        // 新增
  cron: string;
  eventName: string;        // 新增
  message: string;
  name: string;
  sessionMode: "new_session" | "existing_session";
  targetSessionId: string;
  notify: boolean;
  notificationMessage: string;
};
```

变量按钮根据 `type` 动态显示：
- time: `{{date}}` `{{time}}` `{{datetime}}` `{{weekday}}` `{{agent_name}}`
- event: `{{payload}}` `{{date}}` `{{time}}` `{{datetime}}` `{{weekday}}` `{{agent_name}}`

`handleSave` 校验：
- `type === "time"` → `cron` 非空
- `type === "event"` → `eventName` 非空、不以 `sp:` 开头

#### 4.4 EventBridge（`TriggerEventBridge.tsx`）

- `useBusSubscription(projectId, "trigger", ...)` （channel 从 `"schedule"` 改为 `"trigger"`）
- 事件类型从 `schedule_triggered` 等改为 `trigger_triggered` 等
- `handleTriggerEvent` 替代 `handleScheduleEvent`
- 预加载逻辑 `client.listTriggers(agent.id)` 替代 `client.listSchedules`
- `setHasEnabledTriggers` 替代 `setHasEnabledSchedules`

#### 4.5 bus-store 变更

`BusChannel` 类型：`"schedule"` → `"trigger"`。

新增 `emitAgentTriggerEvent` 方法：

```ts
interface BusStore {
  // ... existing
  emitAgentTriggerEvent(projectId: string, eventName: string, payload?: string): void;
}

emitAgentTriggerEvent(projectId, eventName, payload) {
  sendRaw({ kind: "emit-trigger-event", projectId, eventName, payload });
}
```

#### 4.6 UI SDK `emitAgentTriggerEvent` action

新增 `ui-sdk/handlers/emit-agent-trigger-event.ts`：

```ts
registerAction("emitAgentTriggerEvent", (params, ctx) => {
  const { eventName, payload } = params as { eventName: string; payload?: string };
  if (!eventName?.trim()) return;
  useBusStore.getState().emitAgentTriggerEvent(ctx.projectId, eventName, payload);
});
```

HtmlCard / 自定义 UI 可通过 `dispatchAction("emitAgentTriggerEvent", { eventName: "daily-review", payload: "第3章" })` 触发事件。

#### 4.7 API client + types

`api.ts` 方法重命名：`listSchedules` → `listTriggers`、`createSchedule` → `createTrigger`、`updateSchedule` → `updateTrigger`、`deleteSchedule` → `deleteTrigger`、`triggerSchedule` → `runTrigger`、`getScheduleLogs` → `getTriggerLogs`。endpoint 路径同步更新。

`lib/types.ts` re-export 重命名：`ScheduleEntry` → `TriggerEntry`、`ScheduleInfo` → `TriggerInfo`、`ScheduleLogEntry` → `TriggerLogEntry`、`ScheduleServerEvent` → `TriggerServerEvent`。

#### 4.8 AgentRow 指示器

`hasEnabledSchedulesByAgent` → `hasEnabledTriggersByAgent`。Clock icon tooltip i18n key 更新。右键菜单「定时任务」→「触发器」。

#### 4.9 AgentSessionDialogs / ProjectScope

引用更新：`ScheduleEventBridge` → `TriggerEventBridge`，dialog state `{kind: "schedule"}` → `{kind: "trigger"}`。

### 5. i18n 变更

**key 前缀**：`agent-schedule.` → `agent-trigger.`（全部 34 个 key 重命名）

**新增 key**：

| key | zh-CN |
|-----|-------|
| `agent-trigger.type` | 触发类型 |
| `agent-trigger.typeTime` | 时间触发 |
| `agent-trigger.typeEvent` | 事件触发 |
| `agent-trigger.eventName` | 事件名 |
| `agent-trigger.eventNamePlaceholder` | 输入自定义事件名，如 daily-review |
| `agent-trigger.eventHint` | 当此事件被触发时执行此任务 |
| `agent-trigger.eventNameReserved` | 事件名不能以 sp: 开头（保留前缀） |
| `agent-trigger.payloadVarHint` | 使用 \{\{payload\}\} 引用事件发送方的消息内容 |

**文案调整**（原有 key 的文案更新）：
- `dialogTitle`: 「定时任务」→「触发器」
- `menuItem`: 「定时任务」→「触发器」
- `createSchedule` → `createTrigger`: 「创建定时任务」→「创建触发器」
- `noSchedules` → `noTriggers`: 「暂无定时任务」→「暂无触发器」
- `confirmDelete`: 「确定删除此定时任务吗？」→「确定删除此触发器吗？」
- `indicatorTooltip`: 「已开启定时任务」→「已开启触发器」
- `notificationDefault`: 「定时任务已完成」→「触发器已完成」

三语（zh-CN / zh-TW / en）同步更新。

### 6. 文件影响清单

#### Core（`packages/core/src/`）
- `types.ts` — 类型重命名 + TriggerType
- `trigger/timer-service.ts` — **新增**
- `trigger/trigger-manager.ts` — **新增**（替代 `scheduler.ts`）
- `trigger/template.ts` — **新增**（从 `scheduler.ts` 提取）
- `store/trigger.ts` — **新增**（替代 `store/schedule.ts`）
- `scheduler.ts` — **删除**
- `store/schedule.ts` — **删除**
- `factory.ts` — 接线更新
- `project-runtime.ts` — 字段重命名
- `store/agent-store.ts` — `schedules` → `triggers`
- `store/session.ts` — source 迁移
- `index.ts` — barrel 更新
- `__tests__/scheduler.test.ts` → `trigger/__tests__/trigger-manager.test.ts`
- `__tests__/scheduler-template.test.ts` → `trigger/__tests__/template.test.ts`
- `__tests__/store/schedule.test.ts` → `__tests__/store/trigger.test.ts`

#### Server（`packages/server/src/`）
- `contracts/trigger.ts` — **新增**（替代 `contracts/schedules.ts`）
- `contracts/schedules.ts` — **删除**
- `contracts/bus.ts` — channel + emit-trigger-event + payload schema
- `contracts/index.ts` — re-export 更新
- `routes/trigger.ts` — **新增**（替代 `routes/schedules.ts`）
- `routes/schedules.ts` — **删除**
- `routes/index.ts` — 引用更新
- `ws-bus.ts` — trigger channel + emit-trigger-event handling
- `registry.ts` — ProjectContext 更新

#### App（`packages/app/src/`）
- `features/agent-trigger/` — **新增目录**（替代 `features/agent-schedule/`）
- `features/agent-schedule/` — **删除**
- `stores/bus-store.ts` — BusChannel + emitAgentTriggerEvent
- `stores/project-data-store.ts` — `hasEnabledSchedules` → `hasEnabledTriggers`
- `ui-sdk/handlers/emit-agent-trigger-event.ts` — **新增**
- `ui-sdk/handlers/data.ts` — 注册 emitAgentTriggerEvent
- `lib/api.ts` — 方法重命名
- `lib/types.ts` — re-export 重命名
- `features/agent-session-list/AgentRow.tsx` — 指示器 + 菜单项
- `features/agent-session-list/AgentSessionDialogs.tsx` — dialog 引用
- `layouts/ProjectScope.tsx` — EventBridge 引用

#### i18n（`packages/i18n/src/locales/`）
- `zh-CN.ts` — 34 key 重命名 + 8 新增 + 文案调整
- `zh-TW.ts` — 同步
- `en.ts` — 同步

### 7. 不在本次范围

- **LLM emit tool**：agent 通过 tool emit 事件（第三个事件来源）——未来 feature，本次只预留架构（`onUserEvent` 入口 + `sp:` 保留前缀 + source 类型 `"tool"`）
- **事件可观测性 UI**：事件 emit 历史、trigger 执行链路可视化——未来增强
- **事件 ack / 执行结果回传**：当前 emit 为 fire-and-forget，trigger 执行结果通过 trigger channel 事件推送
- **事件 schema 注册**：用户为自定义事件定义 payload schema 供前端校验——未来增强

### 8. 测试策略

#### Core 单元测试
- `timer-service.test.ts`：start/stop、回调触发（fake timers）
- `trigger-manager.test.ts`：
  - time trigger：写盘 → onTimeTick → fire → nextFire 重算
  - event trigger：写盘 → onUserEvent → fire
  - 匹配逻辑：time 仅在 onTimeTick 中处理，event 仅在 onUserEvent 中处理
  - inProgress 防重入
  - mode new_session / existing_session
  - 模板变量 `{{payload}}` / `{{date}}` 等
  - lifecycle events（trigger_triggered/completed/failed/updated）
  - CRUD 后下次 tick/event 读到最新磁盘内容（不需要 register）
  - stopAll
- `template.test.ts`：所有变量 + payload 字符串替换 + 边界
- `store/trigger.test.ts`：CRUD + logs

#### Server
- contract schema 验证（trigger.ts + bus.ts emit-trigger-event message）
- routes: create 校验（type-specific、sp: 前缀拒绝）

#### Frontend
- `store.test.ts`：store action + handleTriggerEvent
- `TriggerFeature.structure.test.tsx`：EventBridge 挂载在 ProjectScope、不在 dialog 内
