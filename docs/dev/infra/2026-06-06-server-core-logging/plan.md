# Server & Core Logging 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 core 和 server 添加基于 pino 的结构化日志系统，增强 agent loop 可观测性，并新增 `/ws/debug` WebSocket 端点。

**Architecture:** Core 直接依赖 pino，通过 `createEngine()` 工厂函数注入 logger。Engine 使用 child logger 传递 sessionId/agentId 上下文。新增 `logAgentEvent` 函数记录 agent loop 事件。Server 创建 pino root logger，重新启用 Fastify 内置 logger，新增 `/ws/debug` 端点推送日志流。

**Tech Stack:** pino, pino-pretty, @fastify/websocket, vitest

---

### Task 1: 添加 pino 依赖

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/server/package.json`

- [ ] **Step 1: 在 core 和 server 中安装 pino + pino-pretty**

```bash
npm install pino --workspace=packages/core
npm install pino pino-pretty --workspace=packages/server
```

`pino-pretty` 放在 server 的 dependencies 中（开发时通过 pino transport 引用），core 只依赖 `pino` 本身。

- [ ] **Step 2: 验证安装成功**

```bash
npm ls pino --workspace=packages/core
npm ls pino --workspace=packages/server
```

Expected: 两个 package 都显示 pino 版本

- [ ] **Step 3: Commit**

```bash
git add packages/core/package.json packages/core/package-lock.json packages/server/package.json
git commit -m "chore: add pino dependency to core and server"
```

---

### Task 2: 创建 core logger 模块

**Files:**
- Create: `packages/core/src/logger.ts`

- [ ] **Step 1: 创建 logger 模块**

```typescript
import pino from "pino";

export type Logger = pino.Logger;

export function createDefaultLogger(): Logger {
  return pino({
    level: "debug",
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  });
}
```

此模块导出 `Logger` 类型别名（方便其他模块使用）和一个默认 logger 工厂函数。`pino-pretty` 在 core 中通过 transport target 字符串引用，不需要 core 直接 import。

- [ ] **Step 2: 验证编译通过**

```bash
npm run build --workspace=packages/core
```

Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/logger.ts
git commit -m "feat(core): add logger module with default pino instance"
```

---

### Task 3: 创建 logAgentEvent 工具函数

**Files:**
- Create: `packages/core/src/engine/log-agent-event.ts`
- Create: `packages/core/src/__tests__/engine/log-agent-event.test.ts`

- [ ] **Step 1: 编写 logAgentEvent 测试**

```typescript
import { describe, expect, it, vi } from "vitest";
import { logAgentEvent } from "../../engine/log-agent-event.js";
import type { Logger } from "../../logger.js";
import type { AgentEvent } from "@mariozechner/pi-agent-core";

function createMockLogger(): {
  logger: Logger;
  info: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  trace: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const info = vi.fn();
  const debug = vi.fn();
  const trace = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const logger = {
    level: "debug",
    info,
    debug,
    trace,
    warn,
    error,
    fatal: vi.fn(),
    silent: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
  return { logger, info, debug, trace, warn, error };
}

describe("logAgentEvent", () => {
  it("logs agent_start at info level", () => {
    const { logger, info } = createMockLogger();
    logAgentEvent(logger, { type: "agent_start" } as AgentEvent);
    expect(info).toHaveBeenCalledWith({ event: "agent_start" }, "agent run started");
  });

  it("logs agent_end at info level with duration and totalTurns", () => {
    const { logger, info } = createMockLogger();
    logAgentEvent(logger, {
      type: "agent_end",
      messages: [],
    } as AgentEvent);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "agent_end" }),
      "agent run ended",
    );
  });

  it("logs turn_start at debug level", () => {
    const { logger, debug } = createMockLogger();
    logAgentEvent(logger, { type: "turn_start" } as AgentEvent);
    expect(debug).toHaveBeenCalledWith({ event: "turn_start" }, "turn started");
  });

  it("logs turn_end at debug level with toolCount", () => {
    const { logger, debug } = createMockLogger();
    logAgentEvent(logger, {
      type: "turn_end",
      message: {} as any,
      toolResults: [{}, {}],
    } as AgentEvent);
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: "turn_end", toolCount: 2 }),
      "turn ended",
    );
  });

  it("logs message_start at debug level", () => {
    const { logger, debug } = createMockLogger();
    logAgentEvent(logger, {
      type: "message_start",
      message: { id: "msg-1" } as any,
    } as AgentEvent);
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: "message_start", messageId: "msg-1" }),
      "message streaming",
    );
  });

  it("logs message_end at debug level", () => {
    const { logger, debug } = createMockLogger();
    logAgentEvent(logger, {
      type: "message_end",
      message: { id: "msg-1", usage: { totalTokens: 100 } } as any,
    } as AgentEvent);
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: "message_end" }),
      "message complete",
    );
  });

  it("does not log message_update", () => {
    const { logger, info, debug, trace } = createMockLogger();
    logAgentEvent(logger, { type: "message_update" } as AgentEvent);
    expect(info).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
    expect(trace).not.toHaveBeenCalled();
  });

  it("logs tool_execution_start at info level with truncated args", () => {
    const { logger, info } = createMockLogger();
    const longArgs = "x".repeat(600);
    logAgentEvent(logger, {
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "write_file",
      args: longArgs,
    } as AgentEvent);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tool_execution_start",
        toolCallId: "tc-1",
        toolName: "write_file",
        args: "x".repeat(500),
      }),
      "tool started",
    );
  });

  it("logs tool_execution_end at info level with truncated resultSummary", () => {
    const { logger, info } = createMockLogger();
    const longResult = "y".repeat(600);
    logAgentEvent(logger, {
      type: "tool_execution_end",
      toolCallId: "tc-1",
      toolName: "read_file",
      result: longResult,
      isError: false,
    } as AgentEvent);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tool_execution_end",
        toolCallId: "tc-1",
        toolName: "read_file",
        isError: false,
        resultSummary: "y".repeat(500),
      }),
      "tool completed",
    );
  });

  it("logs tool_execution_update at trace level", () => {
    const { logger, trace } = createMockLogger();
    logAgentEvent(logger, {
      type: "tool_execution_update",
      toolCallId: "tc-1",
      toolName: "render_card",
      args: {},
      partialResult: "partial",
    } as AgentEvent);
    expect(trace).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tool_execution_update",
        toolCallId: "tc-1",
        partialResult: "partial",
      }),
      "tool partial",
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test --workspace=packages/core -- --reporter=verbose src/__tests__/engine/log-agent-event.test.ts
```

Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 logAgentEvent**

```typescript
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { Logger } from "../logger.js";

const TRUNCATE_LIMIT = 500;

function truncate(value: unknown): string {
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (!str) return "";
  return str.length > TRUNCATE_LIMIT ? str.slice(0, TRUNCATE_LIMIT) : str;
}

export function logAgentEvent(logger: Logger, event: AgentEvent): void {
  switch (event.type) {
    case "agent_start":
      logger.info({ event: event.type }, "agent run started");
      break;

    case "agent_end":
      logger.info({ event: event.type }, "agent run ended");
      break;

    case "turn_start":
      logger.debug({ event: event.type }, "turn started");
      break;

    case "turn_end":
      logger.debug(
        { event: event.type, toolCount: event.toolResults?.length ?? 0 },
        "turn ended",
      );
      break;

    case "message_start":
      logger.debug(
        { event: event.type, messageId: (event.message as any)?.id },
        "message streaming",
      );
      break;

    case "message_end":
      logger.debug({ event: event.type }, "message complete");
      break;

    case "message_update":
      break;

    case "tool_execution_start":
      logger.info(
        {
          event: event.type,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: truncate(event.args),
        },
        "tool started",
      );
      break;

    case "tool_execution_end":
      logger.info(
        {
          event: event.type,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
          resultSummary: truncate(event.result),
        },
        "tool completed",
      );
      break;

    case "tool_execution_update":
      logger.trace(
        {
          event: event.type,
          toolCallId: event.toolCallId,
          partialResult: truncate(event.partialResult),
        },
        "tool partial",
      );
      break;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test --workspace=packages/core -- --reporter=verbose src/__tests__/engine/log-agent-event.test.ts
```

Expected: 所有测试 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engine/log-agent-event.ts packages/core/src/__tests__/engine/log-agent-event.test.ts
git commit -m "feat(core): add logAgentEvent utility with tests"
```

---

### Task 4: Engine 接入 logger

**Files:**
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/src/factory.ts`
- Modify: `packages/core/src/__tests__/engine.test.ts`

- [ ] **Step 1: 修改 Engine 构造函数，接受 logger 参数**

在 `packages/core/src/engine.ts` 中：

顶部新增 import:
```typescript
import type { Logger } from "./logger.js";
import { logAgentEvent } from "./engine/log-agent-event.js";
```

Engine 类新增 `private logger: Logger` 属性。构造函数新增 `options` 中的 `logger` 字段：

```typescript
constructor(
  profileStore: AgentProfileStore,
  sessionStore: SessionStore,
  projectStore: ProjectStore,
  skillStore: SkillStore,
  options?: { defaultModel?: string; logger?: Logger },
) {
  this.profileStore = profileStore;
  this.sessionStore = sessionStore;
  this.projectStore = projectStore;
  this.skillStore = skillStore;
  this.globalDefaultModel = options?.defaultModel;
  this.fileWriteMutex = new FileWriteMutex();
  this.logger = options?.logger ?? pino({ level: "silent" });
}
```

顶部还需 import pino:
```typescript
import pino from "pino";
```

Engine 类新增 `private logger` 属性声明：
```typescript
private logger: Logger;
```

- [ ] **Step 2: 在 sendMessage 中加入 agent event logging**

在 `sendMessage` 方法开头创建 child logger：

```typescript
const sessionLogger = this.logger.child({ sessionId });
```

修改 `agent.subscribe` 回调，使用 sessionLogger：

```typescript
const unsubscribe = agent.subscribe((event) => {
  logAgentEvent(sessionLogger, event);
  onEvent(event);
  if (event.type === "message_end") {
    this.sessionStore.appendMessage(sessionId, event.message);
  }
});
```

同时在 `createSession` 和 `restoreSession` 方法中加入日志：

在 `createSession` 中，`this.activeSessions.set(sessionId, agent)` 之后加入:
```typescript
this.logger.info({ sessionId, agentId }, "session created");
```

在 `restoreSession` 中，`this.activeSessions.set(sessionId, agent)` 之后加入:
```typescript
this.logger.info({ sessionId }, "session restored");
```

- [ ] **Step 3: 修改 factory.ts 传递 logger**

在 `packages/core/src/factory.ts` 中，`createEngine` 函数签名新增 `logger` 选项：

```typescript
import type { Logger } from "./logger.js";

export async function createEngine(
  projectRoot: string,
  options?: { projectName?: string; defaultModel?: string; logger?: Logger },
): Promise<{ engine: Engine; projectStore: ProjectStore }> {
```

构造 Engine 时传入 logger:
```typescript
const engine = new Engine(profileStore, sessionStore, projectStore, skillStore, {
  defaultModel: options?.defaultModel,
  logger: options?.logger,
});
```

- [ ] **Step 4: 更新 engine.test.ts**

在 `createEngineWithSessions` 中，构造 Engine 时传入 silent logger：

```typescript
import pino from "pino";

function createEngineWithSessions(initial: Record<string, SessionInfo>) {
  const sessions = new Map(Object.entries(initial));
  const sessionStore = {
    getSession: vi.fn((id: string) => sessions.get(id) ?? null),
    updateSessionTitle: vi.fn((id: string, title: string) => {
      const session = sessions.get(id);
      if (session) sessions.set(id, { ...session, title });
    }),
  };

  const engine = new Engine(
    {} as ConstructorParameters<typeof Engine>[0],
    sessionStore as ConstructorParameters<typeof Engine>[1],
    {} as ConstructorParameters<typeof Engine>[2],
    {} as ConstructorParameters<typeof Engine>[3],
    { logger: pino({ level: "silent" }) },
  );

  return { engine, sessionStore };
}
```

- [ ] **Step 5: 编译并运行全部 core 测试**

```bash
npm run build --workspace=packages/core && npm test --workspace=packages/core
```

Expected: 编译成功，所有测试 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/engine.ts packages/core/src/factory.ts packages/core/src/__tests__/engine.test.ts
git commit -m "feat(core): integrate logger into Engine constructor and sendMessage"
```

---

### Task 5: SessionStore 和 ProjectStore 加入日志

**Files:**
- Modify: `packages/core/src/store/session.ts`
- Modify: `packages/core/src/store/project.ts`

- [ ] **Step 1: SessionStore 接受 logger**

在 `packages/core/src/store/session.ts` 中：

新增 import:
```typescript
import type { Logger } from "../logger.js";
import pino from "pino";
```

构造函数新增 logger 参数:
```typescript
private logger: Logger;

constructor(logger?: Logger) {
  this.logger = logger ?? pino({ level: "silent" });
}
```

在 `appendMessage` 的 DB 操作成功后加入:
```typescript
this.logger.debug({ sessionId }, "message persisted");
```

在 `init` 方法末尾加入:
```typescript
this.logger.info({ dbPath }, "session store initialized");
```

在 `createSession` 方法中 `return id` 前加入:
```typescript
this.logger.info({ sessionId: id, agentId }, "session created in store");
```

注意 `createSession` 方法中已有 `agentId` 参数。

- [ ] **Step 2: ProjectStore 接受 logger**

在 `packages/core/src/store/project.ts` 中：

新增 import:
```typescript
import type { Logger } from "../logger.js";
import pino from "pino";
```

构造函数新增 logger 参数:
```typescript
private logger: Logger;

constructor(rootPath: string, logger?: Logger) {
  this.rootPath = path.resolve(rootPath);
  this.spherseDir = path.join(this.rootPath, PROJECT_META_DIR);
  this.logger = logger ?? pino({ level: "silent" });
}
```

在 `open` 方法成功解析 config 后加入:
```typescript
this.logger.info({ rootPath: this.rootPath }, "project opened");
```

在 `create` 方法末尾 `return this.config` 前加入:
```typescript
this.logger.info({ rootPath: this.rootPath, name }, "project created");
```

- [ ] **Step 3: 更新 factory.ts 传递 logger 给 stores**

在 `packages/core/src/factory.ts` 中：

```typescript
const projectStore = new ProjectStore(projectRoot, options?.logger);
```

```typescript
const sessionStore = new SessionStore(options?.logger);
```

- [ ] **Step 4: 更新 store 测试**

对于 `packages/core/src/__tests__/store/session.test.ts` 和 `packages/core/src/__tests__/store/project.test.ts`，在构造 store 时传入 silent logger 避免测试噪音：

```typescript
import pino from "pino";
// 在每个 test/describe 中构造 store 时:
const store = new SessionStore(pino({ level: "silent" }));
const store = new ProjectStore(tempDir, pino({ level: "silent" }));
```

- [ ] **Step 5: 编译并运行全部 core 测试**

```bash
npm run build --workspace=packages/core && npm test --workspace=packages/core
```

Expected: 编译成功，所有测试 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/store/session.ts packages/core/src/store/project.ts packages/core/src/factory.ts packages/core/src/__tests__/
git commit -m "feat(core): add logging to SessionStore and ProjectStore"
```

---

### Task 6: Server 接入 pino + 重新启用 Fastify logger

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/ws-chat.ts`
- Modify: `packages/server/src/ws-fs-watch.ts`

- [ ] **Step 1: 修改 createServer 创建 pino root logger**

在 `packages/server/src/index.ts` 中：

```typescript
import pino from "pino";
```

在 `createServer` 函数体中，将:
```typescript
const fastify = Fastify({ logger: false });
```

替换为:
```typescript
const logger = pino({
  level: "debug",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

const fastify = Fastify({ logger });
```

将 logger 传递给 `createEngine`:
```typescript
const { engine, projectStore } = await createEngine(projectRoot, {
  ...options,
  logger,
});
```

在 `await fastify.listen(...)` 后加入:
```typescript
const address = fastify.server.address();
logger.info({ port: (address as any).port }, "server listening");
```

- [ ] **Step 2: ws-chat.ts 加入日志**

在 `packages/server/src/ws-chat.ts` 中：

在 socket 连接建立后加入（使用 `fastify.log`）:
```typescript
fastify.log.info({ sessionId }, "chat ws connected");
```

在 socket.on("message") 的 catch 中，发送 error 前加入:
```typescript
fastify.log.error({ err, sessionId }, "chat ws message error");
```

在 socket.on("close") 中加入:
```typescript
fastify.log.info({ sessionId }, "chat ws disconnected");
```

注意：需要新增 `socket.on("close", ...)` 监听器（当前代码中没有）。

- [ ] **Step 3: ws-fs-watch.ts 加入日志**

在 `packages/server/src/ws-fs-watch.ts` 中：

在 socket 连接后加入:
```typescript
fastify.log.info("fs-watch ws connected");
```

在 socket.on("close") 回调中加入:
```typescript
fastify.log.debug("fs-watch ws disconnected");
```

- [ ] **Step 4: 编译 server**

```bash
npm run build --workspace=packages/server
```

Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/ws-chat.ts packages/server/src/ws-fs-watch.ts
git commit -m "feat(server): integrate pino logger, re-enable Fastify logging"
```

---

### Task 7: 创建 /ws/debug WebSocket 端点

**Files:**
- Create: `packages/server/src/ws-debug.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: 创建 ws-debug.ts**

```typescript
import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";

const clients = new Set<any>();

export function handleDebugWebSocket(
  fastify: FastifyInstance,
): void {
  fastify.get(
    "/ws/debug",
    { websocket: true },
    (socket) => {
      clients.add(socket);
      fastify.log.debug({ clients: clients.size }, "debug ws client connected");

      socket.on("close", () => {
        clients.delete(socket);
        fastify.log.debug({ clients: clients.size }, "debug ws client disconnected");
      });
    },
  );
}

export function createDebugStream(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      const line = chunk.toString().trim();
      if (!line) {
        callback();
        return;
      }
      for (const socket of clients) {
        try {
          socket.send(line);
        } catch {
          clients.delete(socket);
        }
      }
      callback();
    },
  });
}
```

- [ ] **Step 2: 在 server/index.ts 中注册 ws-debug 并创建 debug stream**

在 `packages/server/src/index.ts` 中：

新增 import:
```typescript
import { handleDebugWebSocket, createDebugStream } from "./ws-debug.js";
```

修改 Task 6 中创建的 logger，增加 debug stream 作为第二个输出目标。pino 构造函数的第二个参数接受 `DestinationStream | DestinationStream[]`：

```typescript
const pretty = pino.transport({
  target: "pino-pretty",
  options: { colorize: true },
});

const logger = pino(
  { level: "debug" },
  [pretty, createDebugStream()],
);
```

注册 ws-debug handler（在 `handleFsWatchWebSocket` 之后）:
```typescript
handleDebugWebSocket(fastify);
```

- [ ] **Step 3: 编译 server**

```bash
npm run build --workspace=packages/server
```

Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/ws-debug.ts packages/server/src/index.ts
git commit -m "feat(server): add /ws/debug WebSocket endpoint for log streaming"
```

---

### Task 8: 清理 app 层 console 调用

**Files:**
- Modify: `packages/app/src/lib/api.ts`
- Modify: `packages/app/src/hooks/useCustomTheme.ts`

- [ ] **Step 1: api.ts — 移除 console.log 调用**

在 `packages/app/src/lib/api.ts` 的 `createChatWebSocket` 方法中，移除三行 console:

删除:
```typescript
console.log("[WS] connecting to", url);
```

删除:
```typescript
ws.onopen = () => console.log("[WS] connected");
```

将:
```typescript
ws.onerror = (e) => {
  console.error("[WS] error", e);
  onEvent({ type: "error", message: "WebSocket connection error" });
};
```

改为:
```typescript
ws.onerror = () => {
  onEvent({ type: "error", message: "WebSocket connection error" });
};
```

注意：这些是 renderer 进程的 console 调用。Renderer 进程目前没有 logger 基础设施，且 devtools 中可以直接看到 WebSocket 事件。直接移除即可，不需要替换为 pino（pino 不适合在 renderer 进程运行）。

- [ ] **Step 2: useCustomTheme.ts — 移除 console.warn**

将:
```typescript
link.onerror = () => {
  console.warn("[CustomTheme] Failed to load theme");
  link.remove();
};
```

改为:
```typescript
link.onerror = () => {
  link.remove();
};
```

主题加载失败是可预期的（项目可能没有自定义主题），不需要日志。

- [ ] **Step 3: 运行 lint 确认无问题**

```bash
npm run lint --workspace=packages/app
```

Expected: lint 通过

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/lib/api.ts packages/app/src/hooks/useCustomTheme.ts
git commit -m "chore(app): remove console.log/warn/error diagnostic outputs"
```

---

### Task 9: 集成验证

- [ ] **Step 1: 全量编译**

```bash
npm run build
```

Expected: 所有 package 编译成功

- [ ] **Step 2: 运行 core 全部测试**

```bash
npm test --workspace=packages/core
```

Expected: 所有测试 PASS

- [ ] **Step 3: 全仓库 lint 检查**

```bash
npm run lint
```

Expected: lint 通过，无错误

- [ ] **Step 4: 手动启动验证（开发者手动）**

```bash
npm run dev --workspace=packages/core &
npm run dev --workspace=packages/server &
npm run dev
```

在终端中观察 pino-pretty 的彩色日志输出。发送一条 chat 消息，确认能看到 agent_start、tool_execution_start、tool_execution_end、agent_end 等日志。
