# [infra] Debug 工具：下载当前 session 当前 turn 的完整上下文

## 背景

调试 agent 行为时，需要查看发送给 LLM 的完整 payload（system prompt + 对话历史 + 工具定义），以便排查模型响应异常、prompt 构造问题等。目前 debug 工具只提供 DevTools 切换、Streaming Log、App Data 查看和重置功能，缺少导出 agent 运行时上下文的能力。

## 目标

在 debug menu 中新增一个按钮，一键下载当前活跃 session 的完整 turn 上下文为 JSON 文件。

## 需求

| 项目 | 决定 |
|------|------|
| 上下文范围 | System Prompt + 对话历史（messages）+ 工具定义（tools） |
| 触发方式 | Debug Menu 中手动点击按钮 |
| 输出格式 | JSON |
| 数据来源 | 运行时从活跃 Agent 实例的 `state` 直接读取 |

## 方案对比

### 方案 A：新增 HTTP API 端点（选用）

新增 `GET /api/debug/sessions/:id/turn-context`，Engine 暴露 `getTurnContext(sessionId)` 从内存中的 Agent 实例读取 state，返回 JSON。前端通过 `URL.createObjectURL` + anchor click 触发下载。

优点：关注点分离清晰，debug 功能独立于 chat 协议，数据最准确。
缺点：需要新增路由和 Engine 方法。

### 方案 B：扩展 chat WS 协议

在 `/ws/chat/:sessionId` 增加 `get_turn_context` 消息类型。

优点：无需新端点。
缺点：debug 关注点混入 chat 协议；大 payload 过 WS；chat 页面需处理 debug 消息。

### 方案 C：复用已有 messages API + 客户端组装

客户端用 `GET /api/sessions/:id/messages` 获取历史，自行组装 system prompt。

优点：无服务端改动。
缺点：system prompt 组装逻辑在 core 层，客户端重建不精确；无法获取运行时 state。

## 设计

### 数据流

```
[DebugMenu 按钮]
    → fetch GET /api/debug/sessions/:id/turn-context
        → Engine.getTurnContext(sessionId)
            → 从 activeSessions Map 获取 Agent 实例
            → 读取 agent.state: { systemPrompt, messages, tools }
        ← 返回 JSON { systemPrompt, messages, tools, sessionId, capturedAt }
    → 前端 Blob + URL.createObjectURL + <a> 触发文件下载
```

### 后端

#### Engine.getTurnContext(sessionId)

新增方法于 `packages/core/src/engine.ts`：

```typescript
getTurnContext(sessionId: string): TurnContextSnapshot {
  const agent = this.activeSessions.get(sessionId);
  if (!agent) throw new Error(`No active session "${sessionId}"`);

  return {
    sessionId,
    capturedAt: new Date().toISOString(),
    systemPrompt: agent.state.systemPrompt,
    messages: agent.state.messages,
    tools: agent.state.tools.map(tool => ({
      name: tool.name,
      description: (tool as any).label ?? tool.description ?? "",
      parameters: tool.parameters,
    })),
  };
}
```

返回类型 `TurnContextSnapshot`：

```typescript
interface TurnContextSnapshot {
  sessionId: string;
  capturedAt: string;
  systemPrompt: string;
  messages: AgentMessage[];
  tools: Array<{
    name: string;
    description: string;
    parameters: unknown;
  }>;
}
```

若 session 不在 `activeSessions` 中则抛错，前端据此 disable 按钮。

#### API 路由

新建 `packages/server/src/routes/debug.ts`：

```
GET /api/debug/sessions/:id/turn-context
```

- 调用 `ctx.engine.getTurnContext(req.params.id)`
- 404 返回 `{ error: "No active session" }`
- 成功返回 `application/json`

在 `packages/server/src/routes/index.ts` 的 `registerAllRoutes` 中注册。

### 前端

#### API Client

`packages/app/src/lib/api.ts` 新增：

```typescript
async getTurnContext(sessionId: string): Promise<TurnContextSnapshot> {
  const res = await fetch(
    `${baseUrl}/api/debug/sessions/${encodeURIComponent(sessionId)}/turn-context`,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request failed" }));
    throw new Error(err.error ?? "request failed");
  }
  return res.json();
}
```

#### DebugMenu

`packages/app/src/features/debug-tools/DebugMenu.tsx` 新增 "Download Turn Context" 菜单项：

- 从路由 params 中提取当前 sessionId（`useParams` 读取 `:sessionId`，或从 `useLocation` pathname 中解析 `/chat/:sessionId`）
- 按钮仅在有 active session 时启用
- 点击后调用 API，使用 `Blob` + `URL.createObjectURL` + hidden `<a>` 触发下载
- 文件名：`turn-context-{sessionId前8位}-{timestamp}.json`

### 输出 JSON 结构

```json
{
  "sessionId": "a1b2c3d4-...",
  "capturedAt": "2026-06-07T10:00:00.000Z",
  "systemPrompt": "## Project Index\n...\n---\n\nYou are an AI assistant...",
  "messages": [
    { "role": "user", "content": [{ "type": "text", "text": "hello" }], "timestamp": 1749280800000 },
    { "role": "assistant", "content": [{ "type": "text", "text": "Hi there!" }], "timestamp": 1749280801000 }
  ],
  "tools": [
    {
      "name": "read_file",
      "description": "Read file content",
      "parameters": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"] }
    }
  ]
}
```

## 边界情况

| 场景 | 处理 |
|------|------|
| 无活跃 session | 按钮显示但 disabled |
| Session 不在 activeSessions（服务端已销毁） | API 返回 404，前端 catch 并提示 |
| Agent 正在 streaming | 仍可下载，获取当前 state 快照（messages 包含到此刻的完整历史） |
| 无当前 session（在项目首页） | 按钮显示但 disabled |

## 涉及文件

| 文件 | 变更 |
|------|------|
| `packages/core/src/engine.ts` | 新增 `getTurnContext()` 方法和 `TurnContextSnapshot` 类型 |
| `packages/server/src/routes/debug.ts` | 新建，注册 debug API 路由 |
| `packages/server/src/routes/index.ts` | 注册 debug 路由 |
| `packages/app/src/lib/api.ts` | 新增 `getTurnContext()` |
| `packages/app/src/features/debug-tools/DebugMenu.tsx` | 新增下载按钮及逻辑 |
| `packages/i18n/src/locales/zh-CN.ts` | 新增 debug 下载相关文案 |
