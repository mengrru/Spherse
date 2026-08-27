# [Investigation] UI SDK — iframe 内 HTML 与 App 的通信方案

## 1. 需求概述

用户的 HTML 文件（通过 iframe 在主页 welcome page、content browser preview、chat HtmlCard 中展示）需要具备与 App 通信的能力，以触发 UI 级操作。典型场景包括：

- **创建新会话并发送初始消息**：HTML 中某个按钮点击后，打开指定 agent 的对话并发送一条预设消息
- **用 content browser 打开文件**：HTML 中的链接点击后，跳转到 content browser 查看指定项目文件

核心约束：
- 调用端（iframe 内 HTML）尽可能**轻量**，不希望必须引入额外脚本
- 优先使用**原生能力**通信
- App 端收到消息后**自行解析和执行**

## 2. 现状分析

### 2.1 iframe 使用现状

项目中有 **3 处**渲染 iframe：

| 位置 | 文件 | 内容来源 | sandbox |
|------|------|----------|---------|
| Content Browser 预览 | `features/content-browser/ContentView.tsx:41` | `src={client.getPreviewUrl(filePath)}` (Fastify 静态服务) | **无** |
| Welcome Page | `features/welcome-page/index.tsx:68` | `src={client.getPreviewUrl(path)}` (Fastify 静态服务) | `allow-scripts allow-same-origin` |
| Chat HtmlCard | `features/chat/HtmlCard.tsx:86` | `srcDoc={card.html}` (agent 工具生成) | `allow-scripts allow-same-origin` |

所有 iframe 均为**单向只读展示**，没有任何 `postMessage` / `contentWindow` 通信机制。

### 2.2 iframe 加载架构

Content Browser 和 Welcome Page 的 iframe 通过 Fastify 预览路由提供内容：

```
client.getPreviewUrl("path/to/file.html")
  → "http://localhost:{port}/api/preview/path/to/file.html"
  → Fastify route (packages/server/src/routes/preview.ts) 读取文件并返回
```

HtmlCard 使用 `srcDoc` 直接内嵌 HTML 字符串。

### 2.3 关键同源信息

- Fastify 服务器监听在 `127.0.0.1` 的**随机端口**（`port: 0`），每个项目一个实例
- React renderer 在 dev 模式下通常为 `localhost:5173`（Vite），prod 模式为 `file://` 协议
- iframe 中通过 `getPreviewUrl` 加载的页面与 Fastify 服务器**同源**（`http://localhost:{port}`）
- 但 iframe 与 renderer（React 页面）**不同源**

### 2.4 现有 UI 操作路径

**创建会话**：
```
UI → project-data-store.createSession(projectKey, client, agentId, initialMessage?)
   → client.createSession(agentId)  // POST /api/sessions
   → navigate(/project/{key}/chat/{sessionId})
   → Chat 组件挂载 → streamingStore.attach() → 发送初始消息
```

**打开文件**：
```
UI → navigate(buildContentUrl(projectKey, filePath, sessionId))
   → /project/{key}/content?path={filePath}
   → ContentBrowser 组件加载文件
```

这两个操作都需要访问** renderer 端的 React Router navigate** 和 **Zustand store**，无法直接通过 HTTP API 完成 UI 层面的导航。

## 3. 通信方案分析

### 3.1 方案 A：`window.postMessage`（推荐）

**原理**：iframe 内页面通过 `window.parent.postMessage(data, targetOrigin)` 向父窗口发送消息，renderer 端通过 `window.addEventListener("message", handler)` 接收。

**调用端代码示例**：
```javascript
// iframe 内 HTML — 零依赖，原生 API
window.parent.postMessage({
  type: "spherse:action",
  action: "createSession",
  params: { agentId: "xxx", message: "Hello" }
}, "*");
// 或指定 targetOrigin 以增强安全性
```

**App 端实现**：
- 在全局（如 `App.tsx` 或单独的 hook）注册 `message` 事件监听器
- 解析消息中的 action 和 params，调用对应的 store 方法和 router navigate
- 需要对 iframe ref 调用 `ref.contentWindow` 来验证消息来源，或使用 `event.source` 校验

**优点**：
- **零依赖**：iframe 内只需调用浏览器原生 `postMessage`，无需引入任何脚本
- **浏览器原生**：所有现代浏览器均支持，Electron 完全兼容
- **安全性可控**：可通过 `targetOrigin` 限制目标窗口，通过 `event.origin` / `event.source` 验证来源
- **灵活**：消息格式完全自定义，可扩展新的 action 类型

**缺点**：
- Content Browser 的 iframe 当前**没有 sandbox**，iframe 页面可以自由访问 `window.parent`，没有问题
- Welcome Page 和 HtmlCard 使用了 `sandbox="allow-scripts allow-same-origin"`——`postMessage` 在此 sandbox 配置下**可以正常工作**（不需要额外的 sandbox token）
- 但如果未来为了安全性添加了 `sandbox` 但没有 `allow-same-origin`，则 `postMessage` 仍可用但 `event.origin` 会变为 `null`，影响来源验证
- renderer 端需要新增全局 message listener

**对 iframe 的影响**：**无**。不需要修改 sandbox 配置。

### 3.2 方案 B：自定义 URL Scheme（`spherse://`）

**原理**：在 Electron main process 中注册自定义协议（`app.setAsDefaultProtocolClient`），iframe 内通过 `<a href="spherse://createSession?agentId=xxx&message=Hello">` 触发。

**调用端代码示例**：
```html
<!-- iframe 内 HTML -->
<a href="spherse://createSession?agentId=xxx&message=Hello">创建会话</a>
```

**App 端实现**：
- Electron main process 注册 `spherse://` 协议处理器
- 解析 URL 中的 action 和参数
- 通过 `mainWindow.webContents.send()` 将指令转发到 renderer
- renderer 通过 IPC 或自定义事件接收并执行 UI 操作

**优点**：
- **最轻量**：iframe 内只需一个 `<a>` 标签或 `location.href = "spherse://..."` ，连 JavaScript 都不需要
- **用户友好**：对无 JS 的纯 HTML 场景也适用
- **系统级**：甚至可以从 App 外部触发（浏览器、其他应用）

**缺点**：
- Electron 中 `sandbox` iframe 内的自定义协议可能被**阻止导航**（`allow-top-navigation` 不涵盖自定义协议）
- 需要 `allow-popups` 或 `allow-top-navigation` sandbox token 才能让 iframe 触发导航，这会**降低安全性**
- 参数传递受限：URL 长度限制，复杂消息（如长文本）难以传递
- 需要 main process 中转，架构复杂度增加
- 多实例时需要处理协议冲突
- 首次使用时 OS 可能弹出确认对话框

**对 iframe 的影响**：需要添加 `allow-top-navigation` sandbox token，或配合 `allow-popups`。

### 3.3 方案 C：HTTP API + 轮询/Webhook

**原理**：iframe 内直接调用 Fastify HTTP API 触发操作，Fastify 通过 WebSocket 或其他机制通知 renderer 执行 UI 变更。

**调用端代码示例**：
```javascript
// iframe 内 HTML
fetch("/api/sdk/action", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "createSession", params: { agentId: "xxx", message: "Hello" } })
});
```

**App 端实现**：
- Fastify 新增 SDK action 路由
- 通过 WebSocket（fs-watch 或新建专用 WS）推送 action 事件到 renderer
- renderer 接收后执行 UI 操作

**优点**：
- iframe 与 Fastify **同源**（Content Browser 和 Welcome Page），无需跨域处理
- 利用已有的 HTTP + WebSocket 基础设施
- 可支持非 iframe 场景（如外部工具调用）

**缺点**：
- 需要 iframe 知道 API 路径和格式，**不够轻量**（需要写 fetch 调用）
- HtmlCard 使用 `srcDoc`，内容可能来自任意 origin，调用 Fastify API 会遇到**跨域问题**
- renderer 需要新的 WebSocket 监听机制来接收 UI 指令
- 增加了 server 层的职责（本应是纯 renderer 侧的 UI 操作）
- 响应链路长：iframe → HTTP → server → WS → renderer → UI 更新

**对 iframe 的影响**：无。但 `srcDoc` iframe 受到跨域限制。

### 3.4 方案 D：注入 SDK 脚本到 iframe

**原理**：在服务 HTML 时（preview route 或 srcDoc 拼接）注入一段 JS SDK，封装通信逻辑。

**调用端代码示例**：
```javascript
// 注入的 SDK 提供全局对象
window.SpherseSDK.createSession({ agentId: "xxx", message: "Hello" });
window.SpherseSDK.openFile({ path: "world/characters.md" });
```

**App 端实现**：
- preview route 在返回 HTML 时注入 `<script>` 标签
- SDK 内部使用 `postMessage` 或其他方式与 parent 通信
- renderer 端处理 `postMessage`

**优点**：
- 对用户来说 API 更友好，有明确的函数签名
- 可以做参数校验、错误处理、版本管理
- 底层通信方式可以随时替换（postMessage / CustomEvent 等）

**缺点**：
- **不满足"不引入额外脚本"的约束**
- 可能与用户 HTML 中的 JS 冲突
- `srcDoc` 场景（HtmlCard）需要额外处理注入逻辑
- 需要维护 SDK 代码和版本兼容性
- 增加了攻击面（注入的脚本有更高权限）

**对 iframe 的影响**：需要修改 preview route 和 srcDoc 处理逻辑。

### 3.5 方案 E：Custom Protocol Handler（`protocol.registerStringProtocol`）

**原理**：在 Electron 中注册自定义协议（如 `spherse-action://`），在 renderer 的 `webRequest` 或 `will-navigate` 中拦截。

**与方案 B 的区别**：不需要注册为 OS 级协议处理器，仅在 Electron 进程内拦截。

**优点**：
- 不需要 OS 级注册
- iframe 内用 `<a href="spherse-action://createSession?...">` 即可

**缺点**：
- Electron 的 `protocol.registerStringProtocol` 作用于 main process 的 session，**不会拦截 iframe 的请求**
- 需要使用 `webContents` 的 `will-navigate` 或 `did-navigate` 事件来拦截 iframe 导航
- sandbox iframe 的导航限制依然存在
- 同样有 URL 长度限制

**对 iframe 的影响**：需要 `allow-top-navigation` sandbox token。

## 4. 方案对比

| 维度 | A. postMessage | B. URL Scheme | C. HTTP API | D. SDK 注入 | E. Protocol |
|------|---------------|---------------|-------------|-------------|-------------|
| 调用端复杂度 | 极低（1 行代码） | 最低（`<a>` 标签） | 中（fetch 调用） | 低（SDK 封装） | 最低（`<a>` 标签） |
| 零依赖 | ✅ | ✅ | ❌（需 fetch） | ❌（需 SDK） | ✅ |
| 原生能力 | ✅ | ✅ | ✅ | ❌ | ✅ |
| sandbox 兼容 | ✅ 无需修改 | ⚠️ 需加导航权限 | ⚠️ srcDoc 跨域 | ✅ | ⚠️ 需加导航权限 |
| 参数传递 | 无限制 | URL 长度限制 | 无限制 | 无限制 | URL 长度限制 |
| 安全验证 | origin/source | 协议识别 | 同源校验 | 同源+校验 | 协议识别 |
| 架构改动 | renderer 加 listener | main+renderer | server+renderer | server+renderer | main+renderer |
| 可扩展性 | 高 | 中 | 高 | 高 | 中 |

## 5. 推荐方案

### 主推荐：方案 A（`postMessage`）

理由：
1. **完全满足约束**：iframe 内只需调用浏览器原生 `postMessage`，零依赖，无需引入脚本
2. **sandbox 兼容**：现有三种 iframe 的 sandbox 配置均支持 `postMessage`，无需修改
3. **参数传递灵活**：可传递任意 JSON 数据，不受 URL 长度限制
4. **实现简单**：renderer 端只需加一个全局 message listener
5. **安全性好**：可通过 `event.origin` 和 `event.source` 验证消息来源

### 可选补充：方案 B（URL Scheme）作为降级方案

对于**无 JavaScript** 的纯 HTML 场景（如纯 CSS 交互、`<a>` 链接），可以作为 `postMessage` 的补充。但需要：
- 为 Welcome Page 和 HtmlCard 的 iframe 添加 `allow-top-navigation` sandbox token
- 评估安全性影响

## 6. 方案 A 实现要点

### 6.1 消息协议设计

```typescript
// iframe → parent 消息格式
interface SpherseMessage {
  type: "spherse:action";
  action: string;
  params: Record<string, unknown>;
}

// 支持的 action 列表（初始版本）
type SpherseAction =
  | { action: "createSession"; params: { agentId: string; message?: string } }
  | { action: "openFile"; params: { path: string } };
```

### 6.2 iframe 端调用方式

```javascript
// 最简调用 — 无需任何依赖
window.parent.postMessage({
  type: "spherse:action",
  action: "createSession",
  params: { agentId: "agent-xxx", message: "帮我分析这段文本" }
}, "*");

window.parent.postMessage({
  type: "spherse:action",
  action: "openFile",
  params: { path: "world/characters/主角设定.md" }
}, "*");
```

### 6.3 Renderer 端实现位置

建议创建一个全局 hook `useSpherseMessageListener`，在 `App.tsx` 或 `ProjectLayout.tsx` 中调用：

```typescript
// useSpherseMessageListener.ts
function useSpherseMessageListener() {
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "spherse:action") return;
      // 校验来源（可选，根据安全性需求）
      // 解析 action，调用 store 方法 + router navigate
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);
}
```

### 6.4 各 iframe 的注意事项

| iframe 场景 | 来源 | origin | 注意 |
|-------------|------|--------|------|
| Content Browser | `src` (Fastify 预览) | `http://localhost:{port}` | 无 sandbox，可正常 postMessage |
| Welcome Page | `src` (Fastify 预览) | `http://localhost:{port}` | 有 sandbox，但 `allow-scripts allow-same-origin` 支持 postMessage |
| HtmlCard | `srcDoc` | `null` | origin 为 `null`，event.origin 验证需特殊处理 |

### 6.5 安全考量

1. **消息来源验证**：检查 `event.data.type === "spherse:action"` 前缀，避免处理无关消息
2. **action 白名单**：只处理预定义的 action 类型，忽略未知 action
3. **参数校验**：对 params 做基本的类型/格式校验
4. **跨项目隔离**：确保 action 只影响当前项目（通过 projectKey 绑定）
5. **敏感操作限制**：不应暴露文件写入/删除等危险操作（只暴露 UI 导航类操作）

## 7. 文件索引

本次调研涉及的关键文件：

- `packages/app/src/features/content-browser/ContentView.tsx` — Content Browser iframe 渲染
- `packages/app/src/features/welcome-page/index.tsx` — Welcome Page iframe 渲染
- `packages/app/src/features/chat/HtmlCard.tsx` — Chat HtmlCard iframe 渲染
- `packages/server/src/routes/preview.ts` — Fastify 预览路由（静态文件服务）
- `packages/app/src/layouts/ProjectLayout.tsx` — 项目布局，包含 session 创建和文件导航逻辑
- `packages/app/src/stores/project-data-store.ts` — 会话创建 store 方法
- `packages/app/src/lib/api.ts` — API client（含 getPreviewUrl）
- `packages/app/electron/preload.ts` — Electron preload bridge
- `packages/app/electron/window.ts` — BrowserWindow 创建（含安全配置）
