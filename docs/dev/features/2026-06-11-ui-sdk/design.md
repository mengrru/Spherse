# [Feature] UI SDK — iframe 与 App 内统一 Action 通信框架

## 1. 概述

Spherse 中的用户 HTML 内容通过 iframe 展示（Content Browser 预览、Welcome Page、Chat HtmlCard），目前为单向只读。本 feature 建立一套通用的 action 通信框架，使 iframe 内 HTML 和 App 内代码都能通过统一机制触发 UI 级操作。

### 目标用户

主要使用者是 **LLM**——通过 skill 文档学习协议格式后，在生成 HTML 时嵌入 `postMessage` 调用。

### 核心场景

- iframe 内按钮点击 → 创建新会话并发送初始消息
- iframe 内链接点击 → 在 Content Browser 中打开指定文件
- App 内代码直接调用同一套 action（如其他 feature 复用）

### 设计原则

- **零依赖**：iframe 端使用浏览器原生 `postMessage`，不引入任何脚本
- **统一入口**：iframe 外部调用和 App 内调用走同一个 handler registry
- **可扩展**：新增 action 只需注册新 handler，不改动 listener 或 registry 代码

## 2. 协议层

### 2.1 消息格式

iframe 通过 `window.parent.postMessage` 发送消息，格式如下：

```typescript
interface SpherseActionMessage {
  type: "spherse:action";
  action: string;
  params: Record<string, unknown>;
}
```

### 2.2 iframe 端调用示例

```javascript
// 创建会话
window.parent.postMessage({
  type: "spherse:action",
  action: "createSession",
  params: { agentId: "agent-xxx", message: "帮我分析这段文本" }
}, "*");

// 打开文件
window.parent.postMessage({
  type: "spherse:action",
  action: "openFile",
  params: { path: "world/characters/主角设定.md" }
}, "*");
```

`targetOrigin` 使用 `"*"`，因为三个 iframe 场景的 origin 各异：

| iframe 场景 | 内容来源 | origin |
|-------------|----------|--------|
| Content Browser | `src`（Fastify 预览） | `http://localhost:{port}` |
| Welcome Page | `src`（Fastify 预览） | `http://localhost:{port}` |
| HtmlCard | `srcDoc` | `null` |

安全性通过 app 端 action 白名单和参数校验保证，而非依赖 `targetOrigin`。

### 2.3 现有 sandbox 兼容性

当前三个 iframe 的 sandbox 配置均支持 `postMessage`，无需修改：

- Content Browser：无 sandbox——完全兼容
- Welcome Page：`allow-scripts allow-same-origin`——兼容
- HtmlCard：`allow-scripts allow-same-origin`——兼容

## 3. 架构设计

### 3.1 文件结构

```
packages/app/src/ui-sdk/
├── types.ts                          # ActionContext, ActionHandler 类型
├── registry.ts                       # registerAction / dispatchAction
├── use-spherse-message-listener.ts   # postMessage → dispatchAction 桥梁
├── rate-limit.ts                     # 外部调用频率限制
└── handlers/
    ├── create-session.ts
    ├── open-file.ts
    └── send-message.ts
```

### 3.2 调用路径

```
iframe postMessage ──→ message listener ──→ [rate limit check] ──→ dispatchAction ──→ handler
App 内代码 ────────→ dispatchAction("action", params, ctx) ──────→ handler
```

### 3.3 类型定义（types.ts）

```typescript
interface ActionContext {
  navigate: NavigateFunction;
  projectKey: string;
  client: ApiClient;
}

type ActionHandler<P = Record<string, unknown>> = (
  params: P,
  ctx: ActionContext,
) => void | Promise<void>;
```

### 3.4 Handler Registry（registry.ts）

```typescript
const handlers = new Map<string, ActionHandler>();

function registerAction(name: string, handler: ActionHandler): void {
  handlers.set(name, handler);
}

function dispatchAction(
  name: string,
  params: Record<string, unknown>,
  ctx: ActionContext,
): void | Promise<void> {
  const handler = handlers.get(name);
  if (!handler) {
    console.warn(`[spherse:action] Unknown action: ${name}`);
    return;
  }
  return handler(params, ctx);
}
```

### 3.5 App 内调用

App 内代码直接调用 `dispatchAction`，传入调用方构建的 `ActionContext`：

```typescript
import { dispatchAction } from "../ui-sdk";

dispatchAction("sendMessage", { sessionId, message }, { navigate, projectKey });
```

不提供额外的封装层——`dispatchAction` 就是唯一的调用入口，iframe 和 App 内代码使用同一个函数。

### 3.6 postMessage Listener（use-spherse-message-listener.ts）

在 `ProjectLayout.tsx` 中调用的 hook，职责：

1. 监听 `window` 的 `message` 事件
2. 过滤非 `spherse:action` 类型的消息
3. 检查 rate limit
4. 构建 `ActionContext` 并调用 `dispatchAction`

```typescript
function useSpherseMessageListener() {
  const navigate = useNavigate();
  const projectKey = /* from route params */;
  const client = /* from store */;

  useEffect(() => {
    const ctx: ActionContext = { navigate, projectKey, client };
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "spherse:action") return;
      if (!checkRateLimit(event)) return;
      dispatchAction(event.data.action, event.data.params ?? {}, ctx);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [navigate, projectKey, client]);
}
```

## 4. 初始 Action

### 4.1 createSession

创建新会话并导航到聊天页面，可选附带初始消息。

```typescript
// handlers/create-session.ts
registerAction("createSession", async (params, ctx) => {
  const { agentId, message } = params as { agentId: string; message?: string };
  if (!agentId || typeof agentId !== "string") return;

  const session = await projectDataStore.getState().createSession(
    ctx.projectKey,
    ctx.client,
    agentId,
    message,
  );
  if (session) {
    ctx.navigate(`/project/${ctx.projectKey}/chat/${session.id}`);
  }
});
```

参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| agentId | string | 是 | 目标 agent ID |
| message | string | 否 | 初始消息内容 |

### 4.2 openFile

在 Content Browser 中打开指定项目文件。

```typescript
// handlers/open-file.ts
registerAction("openFile", (params, ctx) => {
  const { path } = params as { path: string };
  if (!path || typeof path !== "string") return;

  ctx.navigate(
    `/project/${ctx.projectKey}/content?path=${encodeURIComponent(path)}`,
  );
});
```

参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | string | 是 | 项目内相对文件路径 |

### 4.3 sendMessage

向已有会话发送消息并导航到聊天页面。

```typescript
// handlers/send-message.ts
registerAction("sendMessage", (params, ctx) => {
  const { sessionId, message } = params as { sessionId: string; message: string };
  if (!sessionId || typeof sessionId !== "string") return;
  if (!message || typeof message !== "string") return;

  const { sendMessage: wsSend, sessions } = useStreamingStore.getState();
  const ws = sessions[sessionId]?.ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    wsSend(sessionId, message);
  } else {
    useProjectDataStore.getState().setInitialMessage(ctx.projectKey, sessionId, message);
  }
  ctx.navigate(`/project/${ctx.projectKey}/chat/${sessionId}`);
});
```

参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| sessionId | string | 是 | 目标会话 ID |
| message | string | 是 | 消息内容 |

App 内接入点：`StartSessionPopover.tsx` 的 `handleSendToCurrentSession` 方法通过 `dispatchAction("sendMessage", ...)` 调用。

## 5. 安全

### 5.1 消息过滤

只处理 `type === "spherse:action"` 的消息，忽略所有其他 postMessage。

### 5.2 Action 白名单

只有通过 `registerAction` 注册的 action 会被执行。未知 action 打 warn 并忽略。

### 5.3 参数校验

每个 handler 内部校验必要参数的类型和存在性，缺失或类型不匹配则 early return。

### 5.4 调用频率限制

对来自 postMessage 的外部调用实施频率限制：**每分钟最多处理 10 次**。超出限制的消息静默丢弃。

App 内通过 `dispatchAction` 直接调用不受此限制。

```typescript
// rate-limit.ts
const MAX_CALLS_PER_MINUTE = 10;
const windowMs = 60_000;
const timestamps: number[] = [];

function checkRateLimit(event: MessageEvent): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }
  if (timestamps.length >= MAX_CALLS_PER_MINUTE) return false;
  timestamps.push(now);
  return true;
}
```

### 5.5 敏感操作隔离

只暴露 UI 导航类操作（创建会话、打开文件），不暴露文件写入、删除、服务端操作等。

### 5.6 跨项目隔离

action 通过 `ActionContext.projectKey` 绑定当前项目，handler 内的操作只影响当前项目。

## 6. 集成点

### 6.1 ProjectLayout

在 `packages/app/src/layouts/ProjectLayout.tsx` 中调用 hook：

```typescript
import { useSpherseMessageListener } from "../ui-sdk/use-spherse-message-listener";

function ProjectLayout() {
  useSpherseMessageListener();
  // ...existing code
}
```

选择 `ProjectLayout` 而非 `App.tsx` 的原因：action 需要 `projectKey` 和 `client`，这些只在项目上下文中可用。`ProjectLayout` 是所有项目路由的公共布局组件。

### 6.2 各 iframe 无需修改

三个 iframe（Content Browser、Welcome Page、HtmlCard）的渲染代码不需要任何改动——`postMessage` 在当前 sandbox 配置下均可正常工作。

## 7. 扩展新 Action

新增一个 action 的步骤：

1. 在 `handlers/` 下新建文件
2. 调用 `registerAction("actionName", handler)`
3. 在 `index.ts` 中添加 side-effect import
4. 更新 LLM skill 文档

无需修改 listener、registry 或任何现有 handler。

## 8. LLM Skill

为 LLM 编写一个 skill，内容包括：

- 协议格式说明（`type: "spherse:action"` 消息结构）
- 可用 action 列表及其参数
- 代码模板（可直接复制使用的 postMessage 调用）
- 使用注意事项（如 rate limit、参数校验行为）

Skill 放在 `packages/presets/skills/` 下，具体内容在实现阶段编写。

## 9. E2E 验收测试

### 9.1 测试策略

通过 Content Browser iframe 加载包含 postMessage 调用的 HTML 文件，验证 action 从 iframe 到 app 的完整链路。测试文件放在 `packages/app/e2e/ui-sdk.spec.ts`。

### 9.2 测试项目准备

创建一个临时项目，包含：

```
.spherse/
  agents/
    test-agent.yaml        # 至少一个 agent，用于 createSession 测试
sdk-test-trigger.html      # 包含 postMessage 调用的 HTML 文件
world/
  target-file.md           # openFile 测试的目标文件
```

`sdk-test-trigger.html` 内容：

```html
<!DOCTYPE html>
<html>
<body>
  <button id="btn-open" onclick="openFile()">打开文件</button>
  <button id="btn-session" onclick="createSession()">创建会话</button>
  <script>
    function openFile() {
      window.parent.postMessage({
        type: "spherse:action",
        action: "openFile",
        params: { path: "world/target-file.md" }
      }, "*");
    }
    function createSession() {
      window.parent.postMessage({
        type: "spherse:action",
        action: "createSession",
        params: { agentId: "test-agent", message: "E2E test" }
      }, "*");
    }
  </script>
</body>
</html>
```

### 9.3 测试用例

**Test 1: openFile action 从 iframe 触发成功**

1. 启动 app，导航到 content browser 查看 `sdk-test-trigger.html`
2. 等待 iframe 加载完成（通过 `page.frameLocator` 定位 iframe 内按钮）
3. 点击 `#btn-open` 按钮
4. 断言 URL 导航到 `/project/{key}/content?path=world%2Ftarget-file.md`

**Test 2: createSession action 从 iframe 触发成功**

1. 启动 app，导航到 content browser 查看 `sdk-test-trigger.html`
2. 等待 iframe 加载完成
3. 点击 `#btn-session` 按钮
4. 断言 URL 导航到 `/project/{key}/chat/{sessionId}`（sessionId 为动态生成的 UUID）
5. 断言 chat 页面可见（如消息输入框出现）

**Test 3: 未知 action 被忽略**

1. 通过 `page.evaluate` 从 renderer 直接 `postMessage` 发送一个未知 action
2. 断言页面无变化（URL 不变，无错误弹窗）

**Test 4: 调用频率限制**

1. 通过 `page.evaluate` 快速发送 12 次 postMessage
2. 断言只有前 10 次被处理，后 2 次被丢弃

### 9.4 测试技术要点

- 使用 Playwright `page.frameLocator()` 定位 content browser 内的 iframe，与 iframe 内元素交互
- 导航断言使用 `page.url()` 检查 hash router 的 URL 变化
- 遵循现有 E2E 模式：隔离的临时项目目录 + 独立 Electron user data dir + try/finally 清理

## 10. 不做的事

- **不提供 SDK 脚本**：iframe 端直接使用原生 `postMessage`，不注入或提供 JS SDK
- **不支持响应/回调**：action 是单向触发，iframe 无法获取执行结果（如创建的 sessionId）。如需此能力，可作为后续扩展
- **不支持 URL Scheme 降级**：不在初始版本中支持 `spherse://` 等自定义协议
- **不修改 sandbox 配置**：现有三个 iframe 的 sandbox 无需任何调整
