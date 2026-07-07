# SessionRuntime 拆分：LiveSession + SessionManager

> 状态：design（待 review）
> 日期：2026-07-07
> 类型：refactor
> 关联：`docs/dev/features/2026-07-02-context-engineering/`（已落地压缩逻辑，本期只重构承载它的类）

## 1. 背景与现状

`packages/core/src/session-runtime.ts` 的 `SessionRuntime` 类同时承担两层职责：

| 层 | 职责 | 现状方法 |
|---|---|---|
| **Multi-session 协调** | 维护 `Map<sessionId, {agent, agentId}>`、create/destroy/closeAll/evictAgent、hot-swap 广播、转发调用 | 大部分 public 方法 |
| **单 session 运行时** | buildAgent、装配 system prompt、sendMessage + compaction、restore（含 compaction 分支）、abort、getTurnContext | buildAgent / sendMessage / maybeCompact / restoreSession 内部逻辑 |

两层混在一个 308 行的类里，导致：

1. **压缩策略不集中**：`maybeCompact`、`buildAgent` 里的 `systemPromptTokenEstimate`、`liveMessageDbIds` 维护、restore 时的 compaction 分支——这些单 session 的运行时关注点散落在 multi-session 编排代码中间，读起来要在"这个方法是操作一个 session 还是所有 session"之间反复切换。
2. **状态归属模糊**：`liveMessageDbIds: Map<sessionId, number[]>` 表面看是 manager 状态，实际语义是 per-session 的（与 `agent.state.messages` 一一对应）。Manager 持有它只是为了在 create/restore/destroy 时维护生命周期。
3. **热替换逻辑外溢**：`setDefaultModel`/`setTemperature` 里"遍历 active sessions + 判断 profile 是否覆盖 + 改 agent.state.model/streamFn"——单 session 的配置响应逻辑被写在了 manager 里（`syncActiveAgentsModel`/`syncActiveAgentsStreamFn`）。
4. **测试维护成本高**：现有 context-engineering 测试为访问 `activeSessions`/`liveMessageDbIds`，要把 runtime cast 成 `any`/自定义 `RichRuntimeInternals`，是封装泄漏的信号。

## 2. 目标与非目标

### 目标

1. **职责拆分**：把单 session 运行时逻辑（init/restore/send/compact/hot-swap 响应）收敛到一个类，multi-session 协调（生命周期 Map 管理）收敛到另一个类。
2. **封装单 session 状态**：`agent`、`liveMessageDbIds`、`systemPromptTokenEstimate` 等 per-session 状态收进 inner 类，外层不再持有。
3. **保持外部 API 不变**：`SessionManager` 保留原 `SessionRuntime` 的全部 public 方法签名，消费者（server `ws-chat`/`routes`/`registry`、core `scheduler`/`project-runtime`）零改动。
4. **可测试性提升**：单 session 运行时（含 compaction）可独立单测，无需 cast 到 `any`。

### 非目标（本期不做）

- 改变 compaction 算法、threshold、keepRecentTurns（`2026-07-02-context-engineering` 已定）。
- 改变 system prompt 装配逻辑（`ContextBlock` + serialize 已定）。
- 改变外部 API 形状（仍是 `sessionRuntime.createSession()` / `.sendMessage()` 等）。
- 引入异步生命周期管理、session 池化、并发 send 锁等新机制。

## 3. 决策摘要

| 决策点 | 选择 | 理由 |
|---|---|---|
| 拆分深度 | A：单 session 运行时 + multi-session 协调两层 | 用户提议，对症 |
| Inner 类命名 | `LiveSession` | "session runtime"与历史 `SessionRuntime` 重名，"LiveSession" 明确表达"已加载到内存的 session 实例" |
| Outer 类命名 | `SessionManager` | 同上，避免命名混淆 |
| DB 读取归属 | LiveSession 内部 | Manager 不应懂单个 session 需要 assemble 什么 messages；compaction 分支更不该外泄 |
| sessionId 生成 | Manager（调 `agentStore.sessions.createSession()`） | "在 DB 注册新 session"是 multi-session 编排动作；LiveSession 假设 sessionId 已确定 |
| Hot-swap 路径 | A：Inner 暴露 `applyDefaultModel` / `applyTemperature` | 封装"profile 覆盖则跳过"判断在 inner；Manager 只存值 + 广播 |
| 依赖注入 | `SessionContext` 聚合对象 | 参数收敛，future 加共享资源只改一处 |
| create/restore 构造 | 静态工厂（`LiveSession.create` / `LiveSession.restore`） | 统一走私有构造 + `buildAgent`，差异只在初始 messages |
| 外部 API | SessionManager 保留全部原 SessionRuntime 方法签名 | 消费者零改动 |

## 4. 模块结构

```
packages/core/src/session/
├── session-manager.ts   # SessionManager：multi-session 协调（原 SessionRuntime 的编排部分）
├── live-session.ts      # LiveSession：单 session 运行时（新文件）
├── types.ts             # SessionContext、LiveSessionDeps、TurnContextSnapshot（从 session-runtime.ts 搬）
└── index.ts             # barrel（如需）
```

原 `packages/core/src/session-runtime.ts` 删除。`packages/core/src/index.ts` 改为导出 `SessionManager`（仍用 `export type { SessionManager }` 保持 type-only 语义，与现 `SessionRuntime` 一致）；`export type { SessionRuntime }` 行删除。

`packages/core/src/factory.ts` 改为 `new SessionManager(...)`；`project-runtime.ts`、`scheduler.ts` 的 `import type { SessionRuntime }` 改为 `SessionManager`。

## 5. SessionContext（共享依赖聚合）

```ts
// session/types.ts
import type { ProjectStore } from "../store/project.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import type { Logger } from "../logger.js";

export interface SessionContext {
  projectStore: ProjectStore;
  projectRoot: string;
  fileWriteMutex: FileWriteMutex;
  logger: Logger;
  defaultModel?: string;
  temperature?: number;
}
```

- `projectRoot` 从 `projectStore.getRootPath()` 取（每次 LiveSession 构造时快照，避免反复调用）。
- `defaultModel` / `temperature` 是**可变字段**：hot-swap 时 Manager 直接改 `ctx.defaultModel = m`，再通过 `applyDefaultModel`/`applyTemperature` 广播给 active sessions。新建 LiveSession 时读 ctx 当前值作为初始默认。
- Manager 持有 ctx 引用；每次 new LiveSession 时把同一 ctx 传入。LiveSession 内部不应直接读 `ctx.defaultModel`/`ctx.temperature` 来响应热替换（这两字段随时会被改），而是通过 `applyDefaultModel`/`applyTemperature` 方法显式接收变化——避免 LiveSession 行为依赖"刚好这一刻 ctx 的值"。LiveSession 仅在 `buildAgent` 构造时读一次 ctx 的 defaultModel/temperature 作为初始默认。

## 6. LiveSession（单 session 运行时）

### 6.1 构造与初始化

```ts
// session/live-session.ts
export class LiveSession {
  private readonly agent: Agent;
  private readonly agentId: string;
  private readonly sessionId: string;
  private readonly ctx: SessionContext;
  private readonly liveMessageDbIds: number[] = [];
  private readonly systemPromptTokenEstimate: number;

  private constructor(
    agent: Agent,
    agentId: string,
    sessionId: string,
    ctx: SessionContext,
    systemPromptTokenEstimate: number,
  ) { ... }

  /** create 路径：空 messages */
  static async create(ctx: SessionContext, agentId: string, sessionId: string): Promise<LiveSession> {
    const agentStore = ctx.projectStore.getAgent(agentId);
    if (!agentStore) throw new NotFoundError(`Agent profile "${agentId}" not found`);
    const profile = agentStore.getProfile();
    const { agent, systemPromptTokenEstimate } = await this.buildAgent(ctx, profile, sessionId);
    return new LiveSession(agent, agentId, sessionId, ctx, systemPromptTokenEstimate);
  }

  /** restore 路径：读 DB（含 compaction 分支），assemble 初始 messages + ids */
  static async restore(ctx: SessionContext, agentId: string, sessionId: string): Promise<LiveSession> {
    const agentStore = ctx.projectStore.getAgent(agentId);
    if (!agentStore) throw new NotFoundError(`Agent "${agentId}" not found`);
    const session = agentStore.sessions.getSession(sessionId);
    if (!session) throw new NotFoundError(`Session "${sessionId}" not found`);

    const profile = agentStore.getProfile();
    const { agent, systemPromptTokenEstimate } = await this.buildAgent(ctx, profile, sessionId);
    const live = new LiveSession(agent, agentId, sessionId, ctx, systemPromptTokenEstimate);

    // compaction 分支：自己读 SessionStore，组装 digest + tail
    const latest = agentStore.sessions.getLatestCompaction(sessionId);
    if (latest) {
      const digest = JSON.parse(latest.digestContent);
      const tailRows = agentStore.sessions.getMessagesAfter(sessionId, latest.anchorMessageId);
      agent.state.messages = [digest, ...tailRows.map((r) => r.message)];
      live.liveMessageDbIds.push(latest.anchorMessageId, ...tailRows.map((r) => r.id));
    } else {
      const rows = agentStore.sessions.getSessionMessagesWithIds(sessionId);
      agent.state.messages = rows.map((r) => r.message);
      live.liveMessageDbIds.push(...rows.map((r) => r.id));
    }
    return live;
  }

  /** 共享的 agent 装配（system prompt / tools / model） */
  private static async buildAgent(
    ctx: SessionContext,
    profile: AgentProfile,
    sessionId: string,
  ): Promise<{ agent: Agent; systemPromptTokenEstimate: number }> { ... }
}
```

**要点**：
- 私有构造 + 两个静态工厂，统一走 `buildAgent`，差异只在初始 messages/ids 装配。
- `buildAgent` 是 static 方法，与现状实现一致（搬自 `SessionRuntime.buildAgent`），包括 `ContextBlock` 装配、`serializeSystemPrompt`、`resolveModelById`（含 dev 新增的 `ModelNotConfiguredError` 路径）。
- `liveMessageDbIds` 是普通 `number[]`（不再是 `Map` 的 value），生命周期与 LiveSession 实例一致。

### 6.2 行为方法

| 方法 | 实现 | 来源 |
|---|---|---|
| `sendMessage(message, onEvent)` | 现 `SessionRuntime.sendMessage` + `maybeCompact` 合并到一个方法 | session-runtime.ts:154-206 |
| `abort()` | `this.agent.abort()` | session-runtime.ts:208 |
| `getTurnContext()` | 现 `getTurnContext`（返回 `TurnContextSnapshot`） | session-runtime.ts:222-238 |
| `applyDefaultModel(modelId?)` | 现 `syncActiveAgentsModel` 的单 session 分支：profile.model 覆盖则跳过，否则 resolve + 写 `agent.state.model` | session-runtime.ts:68-85 的循环体 |
| `applyTemperature(temp?)` | 现 `syncActiveAgentsStreamFn` 的单 session 分支：改 `agent.streamFn` | session-runtime.ts:87-91 的循环体 |

**sendMessage 内部结构**：

```ts
async sendMessage(message: string, onEvent: AgentEventHandler): Promise<void> {
  const sessionLogger = this.ctx.logger.child({ sessionId: this.sessionId });
  const agentStore = this.ctx.projectStore.getAgent(this.agentId);

  const unsubscribe = this.agent.subscribe((event) => {
    logAgentEvent(sessionLogger, event);
    onEvent(event);
    if (event.type === "message_end") {
      const msgId = agentStore?.sessions.appendMessage(this.sessionId, event.message);
      if (msgId !== undefined) this.liveMessageDbIds.push(msgId);
    }
  });

  try {
    await this.agent.prompt(message);
    await this.maybeCompact();
  } finally {
    unsubscribe();
  }
}

private async maybeCompact(): Promise<void> {
  // 现 SessionRuntime.maybeCompact 逻辑，用 this.agent / this.liveMessageDbIds
}
```

### 6.3 暴露给 Manager 的状态

Manager 需要：
- 判断 session 是否还活着 → LiveSession 实例存在于 Map 即代表活着，无需额外标记。
- evictAgent 时按 agentId 过滤 → LiveSession 暴露 readonly `agentId` getter。
- hot-swap 时遍历调用 → Manager 持有 `Map<sessionId, LiveSession>` 直接遍历。

**LiveSession 不暴露 `agent`**。Manager 只通过方法（`sendMessage`/`abort`/`applyDefaultModel`/`applyTemperature`/`getTurnContext`）与之交互。

## 7. SessionManager（multi-session 协调）

```ts
// session/session-manager.ts
export class SessionManager {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly ctx: SessionContext;

  constructor(projectStore: ProjectStore, options?: { defaultModel?: string; temperature?: number; logger?: Logger }) {
    this.ctx = {
      projectStore,
      projectRoot: projectStore.getRootPath(),
      fileWriteMutex: new FileWriteMutex(),
      logger: options?.logger ?? createSilentLogger(),
      defaultModel: options?.defaultModel,
      temperature: options?.temperature,
    };
  }

  /** 在 DB 注册 + 构造 LiveSession（create 路径） */
  async createSession(agentId: string, source?: string): Promise<string> {
    const agentStore = this.ctx.projectStore.getAgent(agentId);
    if (!agentStore) throw new NotFoundError(`Agent profile "${agentId}" not found`);
    const sessionId = agentStore.sessions.createSession(undefined, source);
    const session = await LiveSession.create(this.ctx, agentId, sessionId);
    this.sessions.set(sessionId, session);
    this.ctx.logger.info({ sessionId, agentId }, "session created");
    return sessionId;
  }

  /** 幂等恢复：已活则直接返回，否则构造 LiveSession（restore 路径） */
  async restoreSession(agentId: string, sessionId: string): Promise<string> {
    if (this.sessions.has(sessionId)) return sessionId;
    const session = await LiveSession.restore(this.ctx, agentId, sessionId);
    this.sessions.set(sessionId, session);
    this.ctx.logger.info({ sessionId }, "session restored");
    return sessionId;
  }

  // —— 纯转发 ——
  async sendMessage(sessionId: string, message: string, onEvent: AgentEventHandler): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError(`No active session "${sessionId}"`);
    return session.sendMessage(message, onEvent);
  }

  abortSession(sessionId: string): void {
    this.sessions.get(sessionId)?.abort();
  }

  getTurnContext(sessionId: string): TurnContextSnapshot {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError(`No active session "${sessionId}"`);
    return session.getTurnContext();
  }

  // —— 生命周期 ——
  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  hasActiveSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  evictAgent(agentId: string): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.agentId === agentId) this.sessions.delete(sessionId);
    }
  }

  closeAll(): void {
    this.sessions.clear();
  }

  // —— hot-swap：改 ctx + 广播 ——
  setDefaultModel(model: string | undefined): void {
    this.ctx.defaultModel = model;
    for (const session of this.sessions.values()) {
      session.applyDefaultModel(model);
    }
  }

  setTemperature(temperature: number | undefined): void {
    this.ctx.temperature = temperature;
    for (const session of this.sessions.values()) {
      session.applyTemperature(temperature);
    }
  }
}
```

**要点**：
- 状态只剩 `sessions: Map<string, LiveSession>` 和 `ctx: SessionContext`。不再持有 `liveMessageDbIds`、`activeSessions`（内层结构）、`globalDefaultModel`/`globalTemperature`（进 ctx）。
- `fileWriteMutex` 在 ctx 里，所有 LiveSession 共享同一个实例（与现状一致）。
- 外部方法签名与原 `SessionRuntime` **完全一致**（含 `hasActiveSession`、`evictAgent`、`closeAll`、`setDefaultModel`、`setTemperature`）。

## 8. 修改范围

### 新增

| 文件 | 内容 |
|---|---|
| `packages/core/src/session/types.ts` | `SessionContext` 接口 |
| `packages/core/src/session/live-session.ts` | `LiveSession` 类（搬 + 收敛现 `SessionRuntime` 单 session 逻辑） |
| `packages/core/src/session/session-manager.ts` | `SessionManager` 类（搬现 `SessionRuntime` 协调逻辑） |

### 修改

| 文件 | 变更 |
|---|---|
| `packages/core/src/session-runtime.ts` | 删除 |
| `packages/core/src/index.ts` | `export type { SessionRuntime }` → `export type { SessionManager }` |
| `packages/core/src/factory.ts` | `new SessionRuntime(...)` → `new SessionManager(...)` |
| `packages/core/src/project-runtime.ts` | `import type { SessionRuntime }` → `SessionManager`；字段类型同步 |
| `packages/core/src/scheduler.ts` | 同上 |
| `packages/server/src/registry.ts` | `import type { SessionRuntime }` → `SessionManager`（仅类型名变，行为零改） |

### 不变

- `packages/server/src/ws-chat.ts`、`routes/sessions.ts`、`routes/debug.ts`：通过 `ctx.sessionRuntime.xxx()` 调用，属性名 `sessionRuntime` 不变（ProjectRuntime 字段名保留），方法签名不变。
- `packages/server/src/__tests__/ws-chat.test.ts`、`registry.test.ts`：mock 的是 `sessionRuntime` 对象的方法，方法签名不变，零改。
- compaction 算法、threshold、keepRecentTurns。
- system prompt 装配（ContextBlock + serialize）。
- SessionStore schema 与 CRUD。
- 前端。

## 9. 测试计划

| 文件 | 覆盖 |
|---|---|
| `__tests__/session/live-session.test.ts`（新） | create/restore 初始 messages 装配（含 compaction 分支）；sendMessage 后 compaction 触发与持久化；maybeCompact 占位 anchorMessageId 正确；repeated compaction restore 不过度包含；applyDefaultModel profile 覆盖跳过；applyTemperature 改 streamFn；getTurnContext 字段；abort。可直接 new LiveSession（static 工厂），不需 cast 到 any |
| `__tests__/session/session-manager.test.ts`（新） | create/restore 幂等；destroy/has/evictAgent/closeAll 生命周期；sendMessage/abort/getTurnContext 转发；setDefaultModel/setTemperature 广播到所有 active session；不存在的 sessionId 抛 NotFoundError |
| `__tests__/session-runtime.test.ts`（删） | 内容拆分到上面两个文件 |
| `__tests__/session/temperature-propagation.test.ts`（如拆） | 现 temperature 相关用例迁移 |
| server `ws-chat.test.ts`、`registry.test.ts` | 现状零改，回归通过 |

## 10. 迁移步骤建议

1. 先建 `session/types.ts`（`SessionContext`）。
2. 建 `session/live-session.ts`，从 `SessionRuntime` 搬 `buildAgent`/`maybeCompact`/`sendMessage`/`getTurnContext`/`abort`，加上 `applyDefaultModel`/`applyTemperature`（从 `syncActiveAgents*` 抽单 session 分支）。
3. 建 `session/session-manager.ts`，从 `SessionRuntime` 搬协调逻辑，调用 LiveSession。
4. 改 `factory.ts`/`project-runtime.ts`/`scheduler.ts`/`index.ts` 指向新类。
5. 删 `session-runtime.ts`。
6. 拆 `session-runtime.test.ts` 到 `live-session.test.ts` + `session-manager.test.ts`。
7. 跑 `npm run lint && npm test --workspace=packages/core && npm test --workspace=packages/server`。

每步保持全绿。
