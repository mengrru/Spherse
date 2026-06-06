# Server & Core 结构化日志

## Overview

为 `@spherse/core` 和 `@spherse/server` 添加基于 pino 的结构化日志系统，增强 agent loop 的可观测性，并通过 WebSocket 推送日志流为后续 Chat Debug UI 预留数据通道。

本期不包含 Chat Debug UI 前端组件的实现。

## 方案选型

**选定方案：Core 直接依赖 pino**

Core 直接 `import pino`，通过工厂函数注入 logger 实例。Server 创建 pino root logger 并传递给 core。

选择理由：
- pino 零 native 依赖，对 Electron 构建无影响
- pino 的 child logger 机制天然支持 sessionId/agentId/toolName 上下文传递
- core 是内部包不会被外部复用，不需要日志库抽象层（YAGNI）
- pino 是 Fastify 官方推荐日志库，重新启用 Fastify logger 零额外成本

## Logger 基础设施

### 创建与传递

- `createEngine(projectRoot, options?)` 新增可选参数 `logger`
- 未传入时使用默认 pino 实例：`pino({ level: 'debug' })` + `pino-pretty` transport
- Server 在 `createServer()` 中创建 pino root logger，传递给 core
- Engine 为每个 session 创建 child logger：`logger.child({ sessionId, agentId })`
- Tool 执行时从 engine 获取 child logger 并附加 `{ tool: toolName }`

### 日志级别约定

| 级别 | 用途 | 示例 |
|------|------|------|
| `trace` | 工具入参/出参完整内容 | `tool_execution_update` 的 partialResult |
| `debug` | agent loop 生命周期事件 | turn_start、tool_execution_end、message_end |
| `info` | 关键业务事件 | session 创建、agent run 启动/结束、服务启动 |
| `warn` | 非致命异常 | 工具执行失败但可恢复、denylist 拦截 |
| `error` | 不可恢复错误 | DB 写入失败、LLM 调用异常 |

开发时默认 `debug` 级别，生产环境 `info`。

## Agent Loop 可观测性

### AgentEvent 日志映射

Engine 的 `sendMessage()` 已订阅 agent 的 10 种事件。新增 `logAgentEvent(logger, event)` 函数，在事件转发的同时输出结构化日志：

| Event | 级别 | 日志消息 | 附加上下文 |
|-------|------|----------|-----------|
| `agent_start` | info | `"agent run started"` | sessionId, agentId, model |
| `turn_start` | debug | `"turn started"` | — |
| `message_start` | debug | `"message streaming"` | messageId |
| `message_update` | — | 不记录 | 频率太高 |
| `message_end` | debug | `"message complete"` | tokenCount, thinkingTokens? |
| `tool_execution_start` | info | `"tool started"` | toolCallId, toolName, args（截断 500 字符） |
| `tool_execution_update` | trace | `"tool partial"` | toolCallId, partialResult |
| `tool_execution_end` | info | `"tool completed"` | toolCallId, toolName, isError, resultSummary（截断 500 字符） |
| `turn_end` | debug | `"turn ended"` | toolCount |
| `agent_end` | info | `"agent run ended"` | totalTurns, duration(ms) |

### 实现位置

在 `Engine.sendMessage()` 的 `agent.subscribe()` 回调中调用 `logAgentEvent(logger, event)`。logger 是已包含 sessionId 的 child logger。

### 性能

pino 在生产环境（`level: 'info'`）时，`debug`/`trace` 级别的字符串拼接不会执行（pino 内部短路），不影响运行时性能。

## WebSocket 日志推送

### 新增 `/ws/debug` 端点

独立于 `/ws/chat`，专门推送结构化日志消息。消息格式：

```json
{
  "level": "info",
  "time": 1717660800000,
  "msg": "tool completed",
  "sessionId": "...",
  "toolName": "edit_file",
  "toolCallId": "..."
}
```

前端 Chat Debug UI 在后续 feature 中订阅此端点。

### pino WebSocket Transport

创建自定义 transport，将 pino 日志输出同时推送到所有已连接的 `/ws/debug` 客户端。利用 pino 的 worker thread transport 机制，不阻塞主线程。

### 与 Chat Debug UI 的关系

Chat Debug UI 有两个数据源：
1. `/ws/chat` 的 AgentEvent — tool call 原始数据（已有）
2. `/ws/debug` 的日志流 — server 内部状态（本期新增）

本期只实现端点和 transport，不实现前端 UI。

### 为什么不用 `/ws/chat` 传日志

`/ws/chat` 面向聊天功能，事件格式已固定。日志是不同维度的信息（包含 server 路由日志、DB 操作等），混在一起增加前端过滤负担。

## 具体集成点

### Core 层

| 模块 | 文件 | 日志内容 | 级别 |
|------|------|----------|------|
| Engine | `engine.ts` | agent run 生命周期、session 创建/加载 | info/debug |
| Engine | `engine.ts` | agent event 全量（logAgentEvent） | info/debug/trace |
| Tools | `tools/*.ts` | 文件路径校验失败（denylist 拦截） | warn |
| Tools | `tools/*.ts` | 工具执行耗时、结果摘要 | debug |
| SessionStore | `session-store.ts` | DB 操作异常 | error |
| ProjectStore | `project-store.ts` | 项目配置加载/解析 | info |

### Server 层

| 模块 | 文件 | 日志内容 | 级别 |
|------|------|----------|------|
| Server | `index.ts` | 服务启动、端口绑定 | info |
| Routes | `routes/*.ts` | HTTP 请求（method + path + duration） | debug |
| WS Chat | `ws-chat.ts` | 连接建立/断开、消息收发 | info |
| WS FS Watch | `ws-fs-watch.ts` | 连接建立/断开、文件变更事件 | debug |
| WS Debug | `ws-debug.ts`（新增） | debug 客户端连接管理 | debug |

### Logger 传递链路

```
createServer()
  → pino({ level: 'debug' })
  → createEngine(projectRoot, { logger })
    → engine 内部: logger.child({ module: 'engine' })
    → sendMessage(): logger.child({ sessionId, agentId })
      → agent.subscribe(): logAgentEvent(childLogger, event)
      → tools: childLogger.child({ tool: toolName })
  → routes: Fastify({ logger })  // 重新启用 Fastify 内置 logger
  → ws-debug: WebSocketTransport 绑定到 root logger
```

### Fastify Logger 重新启用

将 `Fastify({ logger: false })` 改为 `Fastify({ logger })`，传入 pino 实例。Fastify 自动为每个请求创建 child logger（含 requestId），记录请求/响应日志。

## 测试策略

- Core 层：测试中注入 `pino({ level: 'silent' })` 确保 `no noise`
- 新增 `logAgentEvent` 单元测试：模拟 agent event 序列，验证输出正确的日志级别和字段
- Server 层：验证 `createServer()` 正确传递 logger 给 engine，Fastify logger 已启用

## Console 清理

- 本期替换 `packages/app/src/lib/api.ts` 和 `useCustomTheme.ts` 中的 `console.log/warn/error` 为 logger 调用
- **不收紧 ESLint `no-console` 规则**——等日志系统稳定后再做（对应 backlog 条目）

## 不在本期范围

- Chat Debug UI 前端组件
- 日志文件持久化（`.spherse/logs/`）
- 日志级别运行时动态调整
- 敏感信息脱敏（pino redact 配置）
