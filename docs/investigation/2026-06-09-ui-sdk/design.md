# UI SDK Design — iframe 内 HTML 与 App 的通信

## 1. 目标

让 iframe 中展示的用户 HTML 文件能够通过原生浏览器 API 触发 App 的 UI 操作（如创建会话、打开文件），无需引入任何额外脚本或依赖。

## 2. 通信机制：`window.postMessage`

选择 `postMessage` 作为唯一通信通道。调研结论见 `investigation.md`。

**为什么不用其他方案**：
- URL Scheme：需要修改 sandbox 策略、有 URL 长度限制
- HTTP API：`srcDoc` iframe 跨域问题、链路过长
- SDK 注入：不满足"不引入额外脚本"约束

### 2.1 调用端用法

```javascript
// iframe 内 HTML — 零依赖
window.parent.postMessage({
  type: "spherse:action",
  action: "createSession",
  params: { agentId: "writer-abc123", message: "帮我续写这段" }
}, "*");

window.parent.postMessage({
  type: "spherse:action",
  action: "openFile",
  params: { path: "world/locations/北方荒原.md" }
}, "*");
```

`window.parent` 在 iframe 上下文中指向 renderer 窗口。`"*"` 作为 targetOrigin 用于兼容不同 origin 场景（Content Browser 同源、HtmlCard origin 为 `null`），安全性通过 action 白名单和参数校验保障。

## 3. 消息协议

### 3.1 消息格式

```typescript
interface SpherseActionMessage {
  type: "spherse:action";
  action: string;
  params: Record<string, unknown>;
}
```

- `type` 固定为 `"spherse:action"`，用于在 renderer 的 message listener 中快速过滤无关消息
- `action` 为操作名称字符串，采用白名单机制
- `params` 为该操作的参数对象

### 3.2 支持的 Action（初始版本）

#### `createSession`

创建一个新会话并可选地发送初始消息，导航到聊天页面。

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `agentId` | `string` | 是 | 目标 agent 的 ID |
| `message` | `string` | 否 | 初始消息内容 |

行为：
1. 调用 `project-data-store.createSession(projectKey, client, agentId, message)`
2. 导航到 `/project/{key}/chat/{sessionId}`
3. Chat 组件挂载后 streaming store 自动发送初始消息

#### `openFile`

在 content browser 中打开指定文件。

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `path` | `string` | 是 | 项目内的相对文件路径 |

行为：
1. 导航到 `/project/{key}/content?path={path}`
2. ContentBrowser 组件加载并展示文件

### 3.3 未来可扩展的 Action

设计为开放扩展协议，后续可按需增加：

| Action | 说明 |
|--------|------|
| `openFile` | 在 content browser 打开文件 |
| `navigateToSession` | 导航到已有会话 |
| `showToast` | 在 App 中显示通知 |

不暴露任何写操作（文件写入/删除、agent 修改等），仅限 UI 导航和只读操作。

## 4. Renderer 端架构

### 4.1 新增 hook：`useSpherseActionListener`

位于 `packages/app/src/hooks/useSpherseActionListener.ts`。

```typescript
function useSpherseActionListener(): void
```

职责：
- 注册 `window.addEventListener("message", handler)`
- 过滤非 `spherse:action` 消息
- 根据 action 类型分发到对应的处理函数
- 清理时移除 listener

### 4.2 挂载位置

在 `ProjectLayout.tsx` 中调用。理由：
- `ProjectLayout` 拥有 `projectKey`、`project.ctx`（含 client 和 port）
- `ProjectLayout` 拥有 `navigate` 和 `createSession` 等依赖
- 每个 project 页面渲染时都会挂载 `ProjectLayout`，确保 listener 始终可用
- 不在 `App.tsx` 挂载，因为 `App.tsx` 无法直接访问当前 project 的 context

### 4.3 处理流程

```
message event 到达
  → 检查 event.data.type === "spherse:action"？
    → 否：忽略
    → 是：检查 action 是否在白名单中？
      → 否：忽略（可 console.warn）
      → 是：校验 params 类型
        → 校验失败：忽略（可 console.warn）
        → 校验通过：执行对应 handler
```

### 4.4 Handler 实现

#### `createSession` handler

```typescript
async (params) => {
  const { agentId, message } = params;
  const session = await createSession(projectKey, client, agentId, message);
  if (session) navigate(`/project/${projectKey}/chat/${session.id}`);
}
```

复用 `ProjectLayout` 已有的 `createSession` 和 `navigate`。

#### `openFile` handler

```typescript
(params) => {
  const { path } = params;
  navigate(buildContentUrl(projectKey, path, activeSessionId));
}
```

复用 `ProjectLayout` 已有的 `handleSelectFile` 逻辑。

### 4.5 参数校验

使用简单的类型检查（不引入 TypeBox，因为消息格式简单且仅限 renderer 端）：

```typescript
function validateCreateSessionParams(params: unknown): params is { agentId: string; message?: string } {
  if (typeof params !== "object" || params === null) return false;
  const p = params as Record<string, unknown>;
  if (typeof p.agentId !== "string" || !p.agentId) return false;
  if (p.message !== undefined && typeof p.message !== "string") return false;
  return true;
}

function validateOpenFileParams(params: unknown): params is { path: string } {
  if (typeof params !== "object" || params === null) return false;
  const p = params as Record<string, unknown>;
  if (typeof p.path !== "string" || !p.path) return false;
  return true;
}
```

## 5. 安全设计

### 5.1 威胁模型

| 威胁 | 缓解措施 |
|------|----------|
| 恶意 iframe 发送伪造 action | action 白名单 + 参数校验，只允许 UI 导航类操作 |
| 跨项目攻击 | handler 使用当前 project 的 context，无法影响其他 project |
| XSS 通过 params 注入 | params 仅作为数据传递，不执行为代码 |
| 外部网页发送伪造 message | 检查 `event.source` 是否为当前窗口内的 iframe（可选增强） |
| iframe 高频发送 message 导致性能问题 | 每个 action 独立滑动窗口频率限制（1 次/秒） |

### 5.2 不暴露的能力

以下操作**不会**通过此协议暴露：
- 文件写入、编辑、删除
- Agent 创建、修改、删除
- 设置修改
- 任意代码执行
- 访问文件系统原始内容

### 5.3 频率限制

防止恶意或故障的 iframe 通过高频 message 造成 renderer 端过载（如快速重复创建会话）。在 listener 中维护一个简单的滑动窗口计数器：

- 每个 action 独立计数
- 窗口大小：1 秒
- 阈值：每秒最多处理 **1 次** 同一 action
- 超出阈值的 message 直接丢弃，可选 `console.warn`

```typescript
const actionTimestamps: Record<string, number[]> = {};
const RATE_LIMIT_WINDOW = 1000;
const RATE_LIMIT_MAX = 1;

function isRateLimited(action: string): boolean {
  const now = Date.now();
  const timestamps = actionTimestamps[action] ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);
  actionTimestamps[action] = recent;
  return recent.length >= RATE_LIMIT_MAX;
}
```

状态保存在 hook 的 `useRef` 中，不触发 re-render。数值（窗口大小、阈值）以常量形式定义在文件顶部，便于后续调整。

### 5.4 source 验证（可选增强）

初始版本不做 `event.source` 验证（因为 HtmlCard 的 `srcDoc` iframe origin 为 `null`，难以可靠验证）。如果未来需要更强安全性，可以：

1. 为 Content Browser 和 Welcome Page 的 iframe 添加 `ref`
2. 收到 message 时检查 `event.source === iframeRef.current.contentWindow`
3. 对无法验证来源的 message（如 HtmlCard），限制可用的 action 子集

## 6. 对现有代码的影响

### 6.1 新增文件

| 文件 | 说明 |
|------|------|
| `packages/app/src/hooks/useSpherseActionListener.ts` | 全局 message listener hook |

### 6.2 修改文件

| 文件 | 变更 |
|------|------|
| `packages/app/src/layouts/ProjectLayout.tsx` | 调用 `useSpherseActionListener()` |

### 6.3 无需修改的部分

- iframe 的 `sandbox` 属性：现有配置已支持 `postMessage`
- preview route：无需变更
- server 端：无需变更
- Electron main process：无需变更
- contracts：无需新增 schema

## 7. 各 iframe 场景兼容性

| 场景 | 内容来源 | origin | postMessage | 备注 |
|------|----------|--------|-------------|------|
| Content Browser | `src` → `http://localhost:{port}` | 同源 Fastify | 正常可用 | 无 sandbox 限制 |
| Welcome Page | `src` → `http://localhost:{port}` | 同源 Fastify | 正常可用 | `allow-scripts allow-same-origin` |
| Chat HtmlCard | `srcDoc` | `null` | 正常可用 | `allow-scripts allow-same-origin`，origin 为 `null` |

三个场景均无需修改现有 sandbox 配置。

## 8. 用户文档

实现后应在 `docs/official/` 中补充一份用户指南，说明：
- 可用的 action 及参数格式
- 示例 HTML 代码
- 注意事项（如 `targetOrigin` 使用 `"*"`）

## 9. 文件索引

相关源码文件：

- `packages/app/src/layouts/ProjectLayout.tsx` — hook 挂载位置，包含 `createSession` 和 `handleSelectFile` 逻辑
- `packages/app/src/stores/project-data-store.ts` — `createSession` store 方法
- `packages/app/src/features/content-browser/ContentView.tsx` — Content Browser iframe
- `packages/app/src/features/welcome-page/index.tsx` — Welcome Page iframe
- `packages/app/src/features/chat/HtmlCard.tsx` — Chat HtmlCard iframe
- `packages/app/src/lib/api.ts` — API client（含 `getPreviewUrl`）
