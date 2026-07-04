# [fix] 用户未配置/未选择模型时的连接死循环与错误展示

## 问题描述

用户未选择模型时出现三个相互关联的问题：

1. **chat 反复重连 ws + 重拉 history（约 1 秒一次）**：WS 连上后服务端立即 `restoreSession`，因模型解析失败而 `socket.close()`；前端 `onclose` 把它当意外断线触发重连，重连又失败，形成死循环。每次 `connect()` 还顺带调用 `client.getSessionMessagesPage(...)` 重新拉取 history。
2. **ws 主动发 `{type:"error", message:"Could not resolve model: "}`**：该错误源自连接建立阶段服务端主动调用 `restoreSession` → `buildAgent` → `resolveModelById`，失败后由 `ws-chat.ts` 的 catch 分支作为 error 事件发回前端并关闭连接。前端直接渲染了该 raw message。
3. **错误渠道不统一**：用户没有配置模型这一「配置缺失」状态，不应在连接建立阶段就被当作致命错误抛出，而应在用户真正尝试发消息时才被发现并返回展示。

## 根因分析

### 根因 1：空串穿透 `??` 运算符

模型 id 的解析链路（`session-runtime.ts:217`）：

```ts
const modelId = profile.model ?? this.globalDefaultModel ?? config.defaultModel;
```

用户在 settings 中未选择模型时，`settings.models.text.defaultModel` 为空串 `""`（见 `use-settings-form.ts:42`）。该空串经 `electron/ipc/settings.ts` → `registry.setDefaultModel` → `SessionRuntime.setDefaultModel` 一路传到 `this.globalDefaultModel`。

`??`（nullish coalescing）只挡 `null`/`undefined`，**不挡空串**。因此 `"" ?? config.defaultModel` 的结果是 `""`，绕过了本应兜底的 `config.defaultModel`（`gemini-2.5-pro`）。空串 `""` 传入 `resolveModelById`：

```ts
// model-providers/index.ts:105
export function resolveModelById(modelId: string) {
  const slashIdx = modelId.indexOf("/");  // "" 中找不到 "/"，slashIdx = -1
  // ...跳过 provider/id 分支
  const providers = models.getProviders();
  for (const provider of providers) {
    const model = models.getModel(provider.id, modelId);  // 用 "" 查找，必然 miss
    if (model) return model;
  }
  throw new Error(`Could not resolve model: ${modelId}`);  // → "Could not resolve model: "
}
```

故错误消息末尾为空（`modelId` 是 `""`）。

### 根因 2：连接建立阶段即做模型解析

`ws-chat.ts:21-25`：WS 一建立，服务端立即调用 `ctx.sessionRuntime.restoreSession(agentId, sessionId)`，而 `restoreSession` → `buildAgent`（`session-runtime.ts:218`）在构造 Agent 时强制 `resolveModelById`。模型不可解析即抛错，`.catch` 把错误作为 `{type:"error"}` 发回前端并 `socket.close()`。

### 根因 3：前端无法区分「致命错误」与「临时断线」

`streaming-store.ts:276` 的 `ws.onclose` 对所有非手动关闭的 close 事件一视同仁地 `scheduleReconnect`。服务端因模型问题主动关闭连接后，前端把它当意外断线，`RECONNECT_BACKOFFS[0] = 1000ms`（`:15`）→ 1 秒重连 → 再失败 → 死循环。

### 错误传递链路（当前）

```
settings defaultModel = ""
  → registry.setDefaultModel("")
    → SessionRuntime.globalDefaultModel = ""
      → buildAgent: modelId = "" ?? config.defaultModel = ""  (!! ?? 不挡空串)
        → resolveModelById("") throws "Could not resolve model: "
          → restoreSession rejects
            → ws-chat.ts catch: send {type:"error", message} + socket.close()
              → frontend onclose: scheduleReconnect (1s)
                → reconnect → restoreSession rejects again → loop
```

## 方案

采用 **方案 A：buildAgent 容忍缺模型，sendMessage 时解析**。核心思路是把模型解析从「连接建立阶段」延迟到「真正发消息阶段」，使 session 在无模型状态下也能正常打开和存活。

### 1. 移除 project-level `defaultModel`

**决策**：模型选择完全由用户级 settings 决定，项目级不再持有默认模型。

| 文件 | 改动 |
|------|------|
| `packages/core/src/types.ts:7` | 从 `ProjectConfig` 接口删除 `defaultModel: string` 字段 |
| `packages/core/src/store/project.ts:61` | `create(name, defaultModel)` → `create(name)`；write 时不再写入 `defaultModel` |
| `packages/core/src/factory.ts:32` | 删除 `options?.defaultModel ?? "gemini-2.5-pro"` 兜底（`create` 不再需要该参数） |

**老项目兼容**：`ProjectConfigStore.read()`（`project-config.ts:43`）用 `YAML.parse` 直接解析文件内容为对象，TypeScript 类型仅在编译期检查，运行时不拒绝额外字段。因此老项目 `project.yaml` 里残留的 `defaultModel` 字段会被自然忽略，不报错、不删除。下次 write config 时（如改 aiAccess / welcomePage）该字段自然消失。

> 注意：`factory.ts` / `registry.ts` / `server/index.ts` 的 options 链路里传递的 `defaultModel` **保留**，但其语义统一为「来自用户 settings 的全局默认模型」（即 `globalDefaultModel`），不再与 project config 关联。

### 2. 统一 modelId 解析（修空串根因）

新增统一的 modelId 解析函数，替代散落在 `session-runtime.ts:62` 和 `:217` 的重复逻辑：

```ts
function resolveEffectiveModelId(
  profile: AgentProfile,
  globalDefaultModel: string | undefined,
): string | undefined {
  return profile.model || globalDefaultModel || undefined;
}
```

- 用 `||` 而非 `??`：空串视为未配置（与用户诉求一致：settings 为空串 = 用户明确未选择）。
- 返回 `undefined` 表示「无模型」。
- 移除原 `?? config.defaultModel` 兜底（project-level defaultModel 已删除）。

`session-runtime.ts:62`（`syncActiveAgentsModel`）和 `:217`（`buildAgent`）均改为调用此函数。

### 3. buildAgent 容忍缺模型

**文件**: `packages/core/src/session-runtime.ts` — `buildAgent`（`:180`）

当前：`const model = resolveModelById(modelId)` 失败即抛错，导致 `restoreSession` 失败。

改后：
- 调用 `resolveEffectiveModelId` 得到 `modelId`（可能为 `undefined`）。
- 若 `modelId` 存在，尝试 `resolveModelById`；成功则传入 `initialState.model`，失败（无效 modelId）则记录日志但不抛错。
- 若 `modelId` 为 `undefined`（未配置），**不传 `model`**，正常构造 Agent。

Agent 在「无模型」态可存活——`AgentOptions.initialState` 是 `Partial<Omit<...>>`（见 `pi-agent-core/dist/agent.d.ts:6`），`model` 可选；`agent.state.model` 是可写属性（`syncActiveAgentsModel` 已在 `:67` 赋值）。

### 4. sendMessage 时延迟解析模型

**文件**: `packages/core/src/session-runtime.ts` — `sendMessage`（`:110`）

在 `agent.prompt(message)` 前，新增一步 `ensureModelForAgent`：

```ts
private ensureModelForAgent(agent: Agent, agentId: string): void {
  const profile = this.projectStore.getAgent(agentId)?.getProfile();
  const modelId = resolveEffectiveModelId(profile, this.globalDefaultModel);
  if (!modelId) {
    throw new ModelNotConfiguredError();
  }
  try {
    agent.state.model = resolveModelById(modelId);
  } catch (err) {
    throw new ModelNotConfiguredError();
  }
}
```

`sendMessage` 调用：
```ts
async sendMessage(sessionId, message, onEvent): Promise<void> {
  const entry = this.activeSessions.get(sessionId);
  if (!entry) throw new NotFoundError(...);
  const { agent, agentId } = entry;
  this.ensureModelForAgent(agent, agentId);  // 新增：发消息前确保模型可用
  // ...其余逻辑不变
}
```

该错误会被 `ws-chat.ts:47` 现有的 catch 捕获，作为 error 事件发给前端。**连接不被关闭**——用户配置好模型后可直接重试，无需重连。

### 5. 新增 `ModelNotConfiguredError`

**文件**: `packages/core/src/errors.ts`

```ts
export class ModelNotConfiguredError extends Error {
  constructor() {
    super("Model is not configured. Please select a model in Settings.");
    this.name = "ModelNotConfiguredError";
  }
}
```

承载「模型未配置」的语义化错误，便于服务端/前端按错误类型/码识别。

### 6. 热更新保留

`SessionRuntime.syncActiveAgentsModel`（`:56`）**保留不动**。它继续负责：用户在 settings 中配置/修改模型后，经 `electron/ipc/settings.ts` → `updateDefaultModel` → `registry.setDefaultModel` → `syncActiveAgentsModel`，遍历所有 active sessions 更新 `agent.state.model`。

因此：
- **配置好模型后已打开 session 立即可用**：`syncActiveAgentsModel` 同步，下次 sendMessage 即生效（`ensureModelForAgent` 也能解析成功）。
- **聊天时改模型、当前 session 热修改**：`syncActiveAgentsModel` 已在做，改完下一轮 prompt 就用新模型。

### 7. WS close code 语义化（阻断重连）

**目标**：让前端能区分「致命错误，别重连」和「临时断线，可重连」。

#### 7.1 close code 定义与导出

**文件**: `packages/server/src/contracts/websocket.ts`

定义 close code 常量并导出（前端引用，避免魔法数字散落）：

```ts
export const CHAT_CLOSE_CODES = {
  SESSION_UNRECOVERABLE: 4401,
} as const;
```

#### 7.2 服务端发送致命 close code

**文件**: `packages/server/src/ws-chat.ts`

`restoreSession` 的 catch 按错误类型决定 close code：

```ts
ctx.sessionRuntime.restoreSession(agentId, sessionId).catch((err) => {
  const message = err instanceof Error ? err.message : "request failed";
  const code = err instanceof NotFoundError
    ? CHAT_CLOSE_CODES.SESSION_UNRECOVERABLE
    : 1000;
  socket.send(JSON.stringify(parseChatServerEvent({ type: "error", message })));
  socket.close(code, message);
});
```

`NotFoundError`（agent/session 不存在）→ `4401`（致命，不重连）；其余瞬时错误 → `1000`（让前端重试）。

> 模型解析错误**不会**出现在连接阶段（方案 A 已延迟到 sendMessage），通过 error 事件的 `code` 字段（`ErrorEventCode`）传递，不关闭连接，故无需对应的 close code。

#### 7.3 前端识别致命 close code

**文件**: `packages/app/src/features/chat/streaming-store.ts`

`ws.onclose`（`:276`）接收 `CloseEvent`，读取 `event.code`：

```ts
import { CHAT_CLOSE_CODES } from "@spherse/server/contracts";

const FATAL_CLOSE_CODES = new Set<number>([
  CHAT_CLOSE_CODES.SESSION_UNRECOVERABLE,
]);

ws.onclose = (event) => {
  // ...现有清理逻辑不变...
  if (FATAL_CLOSE_CODES.has(event.code)) {
    manuallyClosed.set(sessionId, true);  // 阻断后续重连
    return;
  }
  if (!manuallyClosed.get(sessionId) && (attachedCount > 0)) {
    scheduleReconnect(sessionId);
  }
};
```

关键点：
- 致命错误时**不清理已加载的 messages 和 history**——用户能看到之前的对话，只是不能再发新消息。
- `manuallyClosed` 置位后阻断重连。用户切换页面再回来时 `attach` → `connect` 会重置 `manuallyClosed`（`:251`），给一次重试机会（session 若已被清理，重连会再拿到致命 close，符合预期）。

### 8. error 事件新增 `code` 字段（i18n 识别）

**目标**：前端按结构化 code 映射到 i18n 文案，不依赖脆弱的字符串匹配。

#### 8.1 contract schema 扩展

**文件**: `packages/server/src/contracts/websocket.ts`

```ts
export enum ErrorEventCode {
  ModelNotConfigured = "MODEL_NOT_CONFIGURED",
}

const chatServerEvent = Type.Union([
  // ...其它事件不变...
  Type.Object({
    type: Type.Literal("error"),
    message: Type.String(),
    code: Type.Optional(Type.Enum(ErrorEventCode)),  // 新增可选字段
  }),
  // ...
]);
```

`code` 为 `Optional`，保证旧的无 code 的 error 消息仍能被 parse（向后兼容）。

#### 8.2 服务端发送带 code 的 error

**文件**: `packages/server/src/ws-chat.ts`

`sendMessage` 的 catch 中，按错误类型附带 code：

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : "chat error";
  const code = err instanceof ModelNotConfiguredError
    ? ErrorEventCode.ModelNotConfigured
    : undefined;
  socket.send(JSON.stringify(parseChatServerEvent(
    code ? { type: "error", message, code } : { type: "error", message },
  )));
}
```

#### 8.3 前端存储 code，视图层 i18n 渲染

reducer（`chat-session-reducer.ts`）是纯函数，运行在 zustand store 内部，**无法访问 `useI18n()`**（React hook）。因此采用「reducer 存结构化 code，视图层在渲染时翻译」的方式，与现有 `_error` 字段的分层一致。

**文件**: `packages/app/src/features/chat/types.ts` — `ChatMessage`

新增可选字段：

```ts
_errorCode?: ErrorEventCode;
```

**文件**: `packages/app/src/features/chat/chat-session-reducer.ts` — `appendErrorMessage`（`:38`）

透传 `code` 到 ChatMessage，不做翻译。**实现时修正**：`appendErrorMessage` 不仅附带 `_errorCode`，还将错误文本从 `content`（旧的 `[Error] ${message}` 内联方式）移到 `_error` 字段，使 `MessageItem.tsx:53` 的 `message._error &&` 门控能够触发 `ErrorMessageSection` 渲染。这与 `message_end` 错误路径（`stopReason === "error"`）的分层一致——所有错误统一通过 `ErrorMessageSection`（可折叠错误区）展示，而非内联 raw 文本：

```ts
export function appendErrorMessage(
  prev: ChatMessage[],
  message: string,
  code?: ErrorEventCode,
): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last?.role === "assistant" && last._streaming) {
    return [...prev.slice(0, -1), { ...last, _error: message, _streaming: false, ...(code && { _errorCode: code }) }];
  }
  return [...prev, { role: "assistant", content: "", _error: message, ...(code && { _errorCode: code }) }];
}
```

> 注意：streaming-merge 分支同时置 `_streaming: false`，因为错误终止了当前 run。新消息分支 `content: ""`（空），错误文本完全由 `_error` 承载，`ErrorMessageSection` 渲染。

`applyEventToMessages`（`:181`）的 `error` 分支传递 `event.code`：

```ts
if (event.type === "error") {
  return appendErrorMessage(prev, event.message, event.code);
}
```

**文件**: `packages/app/src/features/chat/ErrorMessageSection.tsx`

视图层在渲染时用 `useI18n()` 翻译。当 `_errorCode === ErrorEventCode.ModelNotConfigured` 时显示 i18n 文案，否则显示原始 `error`：

```tsx
const { t } = useI18n();
// 传入 _errorCode，若为 ModelNotConfigured 则用 t("chat.error.modelNotConfigured") 替换展示文案
```

#### 8.4 错误事件清除 streaming 状态

**实现时补充**：当 `sendMessage` 在 `agent.prompt()` 前抛出 `ModelNotConfiguredError`，不会有 `agent_end` 事件产生。若不清除 streaming 状态，Composer 的发送按钮会保持禁用（仅显示 Abort），且 ThinkingIndicator 与错误提示同时渲染——与「配置后可直接重试」的设计目标矛盾。

`chat-session-reducer.ts` 的 `applyEventToStreaming` 增加 error 事件分支：

```ts
function applyEventToStreaming(event: AgentEvent): boolean | null {
  if (event.type === "agent_start") return true;
  if (event.type === "agent_end") return false;
  if (event.type === "error") return false;  // 新增：错误终止 run，清除 streaming
  return null;
}
```

返回 `false` 后，`flushQueuedEvents` 会通过 `setStreaming` 通知 `project-data-store`，Composer 重新启用发送按钮。

#### 8.5 i18n 新增文案

**文件**: `packages/i18n/src/locales/{zh-CN,zh-TW,en}.ts`

| key | zh-CN | zh-TW | en |
|-----|-------|-------|-----|
| `chat.error.modelNotConfigured` | 尚未配置模型，请在设置中选择一个模型后再发送消息。 | 尚未設定模型，請在設定中選擇一個模型後再傳送訊息。 | No model configured. Please select a model in Settings before sending messages. |

以 zh-CN 为基准，带场景注释（说明：用户未配置模型时尝试发消息，聊天区显示的错误提示）。

## 错误时序契约

明确连接生命周期各阶段的错误归属，作为实现的对照基准：

| 阶段 | 错误来源 | 传递方式 | 前端表现 |
|------|---------|---------|---------|
| WS 连接建立 | 服务端 registry 找不到 project | `socket.close()`（无 error 事件） | onclose → 重连（服务可能重启中） |
| `restoreSession` | agent/session 不存在（`NotFoundError`） | `{type:"error"}` + `close(4401)` | 渲染错误消息 + **不重连** |
| `restoreSession` | 瞬时错误（磁盘 IO 等） | `{type:"error"}` + `close(1000)` | 渲染错误 + 重连 |
| `sendMessage`（模型未配置） | `ModelNotConfiguredError` | `{type:"error", code:"MODEL_NOT_CONFIGURED"}`（**不关连接**） | 渲染 i18n 错误文案，连接保持，用户配置后可重试 |
| `sendMessage`（运行时错误） | provider 401、超时等 | `{type:"error"}`（不关连接） | 渲染错误，连接保持 |

**核心原则**：连接建立后（onopen 后），除致命 session 错误外，**连接不再因业务错误被关闭**。模型未配置、provider 鉴权失败等都在 sendMessage 路径返回 error 事件，连接保持活跃。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `packages/core/src/types.ts` | 从 `ProjectConfig` 删除 `defaultModel` 字段 |
| `packages/core/src/errors.ts` | 新增 `ModelNotConfiguredError` |
| `packages/core/src/session-runtime.ts` | `buildAgent` 容忍缺模型；`sendMessage` 延迟解析；新增 `resolveEffectiveModelId` / `ensureModelForAgent` |
| `packages/core/src/store/project.ts` | `create(name)` 签名变更，不再写 `defaultModel` |
| `packages/core/src/factory.ts` | 删除 project-level defaultModel 兜底 |
| `packages/server/src/contracts/websocket.ts` | error 事件加 `code` 字段；新增 `ErrorEventCode` enum、`CHAT_CLOSE_CODES` 常量 |
| `packages/server/src/ws-chat.ts` | `restoreSession` catch 按错误类型发致命 close code；`sendMessage` catch 附带 code |
| `packages/app/src/features/chat/streaming-store.ts` | `onclose` 识别致命 close code，阻断重连 |
| `packages/app/src/features/chat/types.ts` | `ChatMessage` 新增 `_errorCode?: ErrorEventCode` |
| `packages/app/src/features/chat/chat-session-reducer.ts` | `appendErrorMessage` 透传 `code` 到消息（不翻译） |
| `packages/app/src/features/chat/ErrorMessageSection.tsx` | 按 `_errorCode` 映射 i18n 文案渲染 |
| `packages/i18n/src/locales/zh-CN.ts` | 新增 `chat.error.modelNotConfigured`（带注释） |
| `packages/i18n/src/locales/zh-TW.ts` | 新增对应翻译 |
| `packages/i18n/src/locales/en.ts` | 新增对应翻译 |

## 测试覆盖

| 层 | 文件 | 覆盖点 |
|----|------|--------|
| core | `session-runtime.test.ts` | `buildAgent` 无模型时不抛错；`sendMessage` 无模型时抛 `ModelNotConfiguredError`；配置模型后 `sendMessage` 成功 |
| core | `session-runtime.test.ts` | 空串 modelId 被视为未配置（`resolveEffectiveModelId` 用 `\|\|`） |
| core | `store/project.test.ts` / `project-config.test.ts` | `ProjectConfig` 无 `defaultModel` 字段；读取含 `defaultModel` 的老 project.yml 时忽略该字段不报错 |
| server | contracts 测试 | error 事件含 `code` 字段能正确 parse；无 `code` 时兼容旧消息 |
| server | ws-chat 相关测试 | `restoreSession` 致命错误（`NotFoundError`）时 `close(4401)`；非致命时 `close(1000)` |
| app | `streaming-store.test.ts` | 致命 close code（4401）不触发重连；非致命 close code 触发重连；致命错误后 messages 保留 |
| app | `chat-session-reducer` 测试 | error 事件带 `MODEL_NOT_CONFIGURED` code 时消息携带 `_errorCode`；无 code 时保持原行为 |
| app | `ErrorMessageSection` 测试 | `_errorCode === ModelNotConfigured` 时渲染 i18n 文案 |

## 不改动的部分

- **`globalDefaultModel` 传递链路**：`factory.ts` / `registry.ts` / `server/index.ts` 接受的 `defaultModel` options 保留，语义为「来自 settings 的全局默认」。
- **`syncActiveAgentsModel`**：热更新逻辑保留不动。
- **`getTurnContext`**：调试面板依赖的 turn-context 快照照常工作（Agent 已构造，只是可能暂无 model）。
- **project.yaml 老字段**：不主动清理，自然忽略。
