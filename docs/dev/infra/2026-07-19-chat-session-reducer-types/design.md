# chat-session-reducer 类型补全：消除 any/as，重建 server 透明传输契约

## 背景

`packages/app/src/features/chat/chat-session-reducer.ts` 中存在大量 `any` 与 `as`，根因是 server contract 在 WebSocket 与 HTTP 边界丢失了 pi-ai / pi-agent-core 已有的类型信息：

- `packages/server/src/contracts/websocket.ts` 的 `ChatServerEvent` 对 `message`/`args`/`partialResult`/`result`/`messages`/`toolResults`/`assistantMessageEvent` 全部使用 `Type.Unknown()`
- `packages/server/src/contracts/sessions.ts` 的 `sessionMessagesResponse` / `sessionMessagesPageResponse.messages` 使用 `Type.Array(Type.Unknown())`
- 这些 `unknown` 一路传到 chat-session-reducer，迫使其用 `(content: any)` / `(event.partialResult as any).details` 等才能干活
- `packages/app/src/features/chat/streaming-store.ts:270` 的 `parseChatServerEvent(raw) as AgentEvent` 是 chat-session-reducer 内所有 `any/as` 的真正入口：把 `unknown` payload 强制窄化为 AgentEvent，下游误以为有类型，实际运行时未校验

rebase 后 `packages/core/src/store/session.ts` 已完成同类工作（commit `60a8bf4`）：`SessionStore.getSessionMessages(): AgentMessage[]`、`getRecentTurns(): { messages: AgentMessage[]; ... }`、内置 `isAgentMessage` 守卫。本设计在 app 侧补齐等价能力。

## 架构原则

**Server 是透明传输，不应感知 payload 内部结构**。

- server 已是工具无关：`ws-chat.ts` 仅做 `socket.send(JSON.stringify(parseChatServerEvent(event)))`，不感知具体工具
- server 已是消息无关：`server/src/contracts/websocket.ts` 不 import pi-ai 或 pi-agent-core，contract 只定义事件 discriminator 与原语字段（`type`、`toolCallId`、`toolName`、`isError`、`message`、`code`）
- 复杂 payload（`message`/`args`/`result`/`partialResult`）的类型化由 **app 端**通过 core re-export 重建
- 这避免了在 contract 里镜像 pi-ai Message 结构（与 pi-ai 类型漂移、维护成本翻倍）

## chat-session-reducer.ts 现状清单

按 `any`/`as` 来源分 3 类：

### 第 1 类：Message/content 结构（pi-ai 已有强类型）
- line 77、92：`(content: any) => content.type === "text"` —— message.content 被当成 `unknown`，需 `any` 才能访问 `type`/`text`
- line 192：`parseHistoryMessages(history: any[])` —— history 来自 `SessionMessagesPageResponse.messages: unknown[]`
- line 197、217、225：`(content: any) => ...` —— 同上
- line 233：`"error" as const` / `"completed" as const` —— 这两个是字面量窄化，实际无需修改

### 第 2 类：工具调用 details（pi-agent-core `args/partialResult/result` 本身是 `any`）
- line 129：`(event.isError ? "error" : "completed") as ToolCallInfo["status"]` —— 用 `as const` 即可消除
- line 152-163：`(event.partialResult as any).details?.type === "html"` / `(event.partialResult as any).details` —— render_card / generate_image 的 details 形状在各 tool 的 `execute()` 内构造，需要 type guard 窄化
- line 193：`details?: any` —— tool result details
- line 241：`(content.arguments as any)?.content` —— render_card 调用方传入的 `arguments.content`

### 第 3 类：测试 fixture（不在主文件，但签名变更会波及）
- `chat-session-reducer.test.ts` 中大量内联对象字面量（如 `{ type: "message_start", message: { role: "assistant", content: [] } }`），新签名下需要 `as AgentEvent` 或 fixture builder

## 改动范围

### 1. Server contract（仅文档化，无结构变更）

**文件**：`packages/server/src/contracts/websocket.ts`、`packages/server/src/contracts/sessions.ts`

- 在 `chatServerEvent` 与 `sessionMessagesResponse` 的 `Type.Unknown()` 字段处加注释，明确：server 是 transparent transport，payload 的类型化由消费端通过 `@spherse/core` re-export 重建
- 不新增 Typebox schema（避免与 pi-ai 类型镜像/漂移）
- 不改 `parseChatServerEvent` / `parseChatClientMessage` 行为

### 2. Core 新增 re-export

**文件**：`packages/core/src/index.ts`

新增：
```ts
export type { AgentMessage } from "@earendil-works/pi-agent-core";
export type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
  ThinkingContent,
  ToolCall,
  StopReason,
} from "@earendil-works/pi-ai";
```

注意：**不 re-export `AgentEvent`**。pi-agent-core 的 `AgentEvent` 不含 server 扩展的 `error`/`pong` 变体，不能直接覆盖 reducer 的输入。app 在 `features/chat/agent-event-parse.ts` 内显式定义自己的 `AgentEvent`（见第 5 节）。

### 3. 工具 details 接口抽取（render-card / generate-image）

**文件**：`packages/core/src/tools/render-card.ts`、`packages/core/src/tools/generate-image.ts`

把 `onUpdate` 与 `return` 中重复构造的 details 对象抽成命名 interface 并 export：

```ts
// render-card.ts
export interface RenderCardDetails {
  type: "html";
  html?: string;
  file_path?: string;
  title?: string;
  width?: number;
  height?: number;
  max_width?: number;
  max_height?: number;
}
// 兼容字段：返回值 details 还带 cardType: "html"
```

```ts
// generate-image.ts
export interface ImageCardDetails {
  type: "image";
  cardType?: "image";  // 返回值有，onUpdate 没有
  status: "generating" | "done" | "error";
  path?: string;
  prompt: string;
  model?: string;
  mimeType?: string;
  errorMessage?: string;
}
```

工具 `execute()` 内部构造 details 时使用这些 interface，保持运行时形状不变。

### 4. App `lib/types.ts` 切换类型来源

**文件**：`packages/app/src/lib/types.ts`

```ts
// before
export type { ChatServerEvent as AgentEvent } from "@spherse/server/contracts";

// after
export type {
  AgentMessage,
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
  ThinkingContent,
  ToolCall,
} from "@spherse/core";
```

注意：**`AgentEvent` 不再从 core re-export**。原因：pi-agent-core 的 `AgentEvent` 不包含 `error`/`pong` 变体（这两个是 server 侧扩展），无法直接覆盖 reducer 的全部事件。`AgentEvent` 改为在 app 内显式定义（见第 5 节）。

`ChatServerEvent` 不再 alias 为 `AgentEvent`。仍然从 server 导入 `parseChatServerEvent`、`ErrorEventCode`、`ChatServerEvent`（parser 入参用）等。

### 5. App 新增 `features/chat/agent-event-parse.ts`

提供边界窄化能力。**核心产物是 app 内显式定义的 `AgentEvent` 类型**（替代原 `ChatServerEvent as AgentEvent` alias），覆盖 ChatServerEvent 全部 11 个变体（含 `error`/`pong`），但 payload 全部强类型化：

```ts
import type {
  AgentMessage,
  AssistantMessage,
  Message,
  TextContent,
  ToolCall,
  ToolResultMessage,
} from "@spherse/core";
import type { ErrorEventCode } from "@spherse/server/contracts";

// app 内显式定义的 reducer 输入事件类型
export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: "error"; message: string; code?: ErrorEventCode }
  | { type: "pong" };
```

注意：
- `args`/`result`/`partialResult` 仍是 `unknown`（pi-agent-core 自身把它们标为 `any`，app 端用 `unknown` 强制消费方窄化）
- `message_update` 不暴露 `assistantMessageEvent`（reducer 当前不用，省略）
- `tool_execution_*` 不暴露 server schema 里的所有字段，只保留 reducer 实际消费的字段

辅助 type guard（用 `typeof`/`in`，**内部不使用 `as`**）：

```ts
function isObject(x: unknown): x is Record<string, unknown>;
function isTextContent(x: unknown): x is TextContent;
function isToolCall(x: unknown): x is ToolCall;
function isAssistantMessage(x: unknown): x is AssistantMessage;
function isUserMessage(x: unknown): x is UserMessage;
function isToolResultMessage(x: unknown): x is ToolResultMessage;
function isAgentMessage(x: unknown): x is AgentMessage;
function isRenderCardDetails(x: unknown): x is RenderCardDetails;
function isImageCardDetails(x: unknown): x is ImageCardDetails;
```

边界 parser：

```ts
export function parseAgentEvent(event: ChatServerEvent): AgentEvent;
export function parseAgentMessage(payload: unknown): AgentMessage;  // 用于 history
```

**容错策略**：parser 不抛异常。字段缺失时按当前 reducer 已有的"防御性访问"行为构造兼容值。例如 `message_update` 的 `message` 字段在 ChatServerEvent 中是 `unknown`，parser 用 `isAssistantMessage` 检查；若不是 assistant message 则返回 `message_start` 等价的占位 message（非 assistant role），reducer 的 `if (event.message.role === "assistant")` 自然短路。理由：当前代码已在用 `?.` 防御未知形状，新 parser 不应比现状更严格、避免运行时抖动。

### 6. `streaming-store.ts` 边界替换

**文件**：`packages/app/src/features/chat/streaming-store.ts`

```ts
// line 270 before
const parsed = parseChatServerEvent(raw) as AgentEvent;

// after
import { parseAgentEvent } from "./agent-event-parse";
const parsed = parseAgentEvent(parseChatServerEvent(raw));
```

其余消费 `AgentEvent` 的代码（line 102、150、169 等）签名不变，自动获得强类型。

### 7. `chat-session-reducer.ts` 主文件重写

**文件**：`packages/app/src/features/chat/chat-session-reducer.ts`

- 从 `./agent-event-parse` 导入 `AgentEvent`（替代原 `../../lib/types` 的 alias）
- 入参 `events: AgentEvent[]`，签名其它部分不变
- `applyEventToMessages`：
  - `event.message` 现已是 `AgentMessage`，先 `isAssistantMessage(event.message)` 窄化，再访问 `content` 数组
  - 取代 `event.message?.role === "assistant"`（语义等价，但类型安全）
  - `event.message.content` 现已是 `(TextContent | ThinkingContent | ToolCall)[]`，用 `isTextContent(c)` 取代 `(content: any) => content.type === "text"`
- `tool_execution_update` 中工具 details 窄化：
  - `event.partialResult` 是 `unknown`，先 `isObject(event.partialResult)` 再 `isRenderCardDetails(event.partialResult.details)`，匹配后直接用强类型访问
  - 同理 `isImageCardDetails`
- `tool_execution_end` 中 result 转字符串：`typeof event.result === "string"` 分支处理（不变）
- `parseHistoryMessages(history: unknown[])`：
  - 入参从 `any[]` 改为 `unknown[]`
  - 内部用 `parseAgentMessage(payload)` 窄化每条记录（覆盖 user/assistant/toolResult/custom 等 role）
  - toolResult details 字段类型从 `any` 改为 `unknown`，用 `isRenderCardDetails`/`isImageCardDetails` 窄化后访问
  - `message.content` 数组元素用 `isTextContent`/`isToolCall` 窄化（消除 `(content: any) => ...`）
  - `toolCall.arguments` 类型是 `Record<string, any>`（pi-ai 定义），保留这一处 `any`（上游问题），但访问 `(content.arguments as any)?.content` 改为先 `isObject(content.arguments)` 再 `typeof arguments.content === "string"` 取值，消除 `as any`
- line 129 状态字面量窄化：`event.isError ? "error" as const : "completed" as const`，移除外层 `as ToolCallInfo["status"]`
- 全文件无 `any`、无 `as`（不计字面量 `as const`，不计上游 `Record<string, any>` 的 arguments 字段类型标注）

### 8. 测试 fixture 处理

**文件**：`packages/app/src/features/chat/chat-session-reducer.test.ts`

测试允许用 `as AgentEvent` 构造 fixture（test-only 例外，符合 vitest 社区惯例）。原因：
- 真实 `AgentEvent` 变体（如 `AssistantMessage`）需要 `api`/`provider`/`model`/`usage`/`stopReason`/`timestamp` 等大量字段，测试构造完整对象字面量噪声过大
- 测试关注 reducer 行为，不关注 AgentEvent 构造完整性
- 若坚持测试无 `as`，需要写 5+ 个 fixture builder helpers，工作量翻倍且收益有限

主文件 `chat-session-reducer.ts` 严格无 `any`/`as`。

## 测试与验证

### 单元测试
- `chat-session-reducer.test.ts`：保持现有 30+ 测试全部通过；fixture 加 `as AgentEvent`
- 新增 `agent-event-parse.test.ts`：覆盖 `parseAgentEvent` 各分支的窄化逻辑
  - type discriminator 正确分发
  - 容错：缺字段时不抛错，返回兼容形状
  - type guard 真阳/假阳边界

### 类型检查
- `npm run lint --workspace=packages/app`
- `npm run lint --workspace=packages/core`
- `npm run lint --workspace=packages/server`
- `npm run typecheck`（如存在）

### 运行时验证
- `npm test --workspace=packages/app`
- 手动启动 dev 应用，发起一轮 chat 对话，验证：
  - 文本消息流式正常
  - render_card 卡片正常显示
  - generate_image 图片卡片正常显示
  - 历史会话加载正常（重新打开会话）
  - 错误事件正确显示 `_error` 与 `_errorCode`

### 回归 E2E（按 AGENTS.md「E2E 验证选择」）
- `npm run test:e2e --workspace=packages/app -- e2e/chat-streaming-resilience.spec.ts`（chat streaming 路径）
- `npm run test:e2e --workspace=packages/app -- e2e/ui-sdk-html-card.spec.ts`（render_card 路径）

## 不在范围

- `packages/core/src/session/live-session.ts:82,84,88` 仍有 `as any`/`as AgentMessage[]`（core 内部边界，独立工单）
- `packages/core/src/project-manager.ts:120,131` 的 `getSessionHistory(): unknown[]` / `getRecentSessionHistory(): { messages: unknown[]; ... }` 主动降级类型（独立工单）
- pi-agent-core 自身 `args/partialResult/result: any`（上游问题，无法在 spherse 内修复）
- `streaming-store.ts` 内的其它 `as`（仅替换 line 270 边界 cast，其余不动）
- `api-contracts.test.ts` 内可能新增的对 `parseChatServerEvent` 的弱类型断言（保留现有测试）

## 影响面与风险

| 风险 | 缓解 |
|------|------|
| type guard 容错过松，掩盖真实数据问题 | parser 不抛错但 reducer 行为保持现状（已用 `?.` 防御）；后续可加 debug 日志观察窄化失败率 |
| 测试 fixture 加 `as AgentEvent` 后，弱 fixture 通过测试但运行时失败 | 在 `agent-event-parse.test.ts` 中用真实形状构造 fixture 覆盖 parser |
| core re-export 范围扩大，需保证 tree-shaking | 全部用 `export type`，编译期擦除，无运行时影响 |
| render-card / generate-image details interface 漂移（与 execute 内构造不一致） | interface 直接作为 execute 返回值的类型标注，编译期保证一致 |

## Backlog 维护

完成本工单后，在 `docs/dev/backlog.md` 标记对应条目（若存在）完成，并新增 backlog：
- core 内部剩余 `as any`/`as AgentMessage[]` 清理（live-session.ts、project-manager.ts）
