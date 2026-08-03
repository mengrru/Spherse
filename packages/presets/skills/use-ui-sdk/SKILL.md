---
name: use-ui-sdk
description: 在 Spherse 的 HTML 内容中使用注入的 window.spherse SDK 调用 App 能力（创建会话、打开文件、读写数据、只读查询项目信息）
---

# UI SDK — `window.spherse`

Spherse 中的 HTML 内容（欢迎页、Content Browser 预览、聊天 HtmlCard）都在 iframe 中展示。**App 会自动向每个 HTML 注入一个零依赖的 SDK 脚本**，暴露 `window.spherse`（大小写不敏感，`window.Spherse` 是别名）。你**不需要**手写 `postMessage`、不需要内联 Promise wrapper、不需要引入任何脚本标签 —— 直接用即可。

## 快速上手

```html
<button onclick="spherse.openFile('world/characters.md')">打开角色档案</button>
<button onclick="startWriting()">开始写作</button>

<script>
  function startWriting() {
    spherse.createSession({ agentId: "writer", message: "开始新的写作会话" });
  }
</script>
```

SDK 已由 App 注入，**不要**再自己写 `<script>` 加载它，也**不要**复制 `spherseCall` 之类的 wrapper —— 那些都已内置。

## API 总览

`window.spherse` 提供三类方法：

| 类别 | 方法 | 说明 |
|------|------|------|
| 触发型（fire-and-forget） | `createSession` / `openFile` / `openExternalLink` / `floatSession` / `unfloatSession` / `floatContent` / `unfloatContent` / `emitAgentTriggerEvent` | 单向触发，无返回值 |
| 请求型（Promise） | `sendMessage(params)` → `Promise` | 等待发送结果 |
| 请求型（Promise） | `data.get` / `data.set` / `data.delete` | key-value 持久化 |
| 请求型（Promise） | `api.call(op, args)` 及 `api.*` 命名方法 | 只读查询项目信息（agents / sessions / content / triggers / settings） |
| 运行时 | `spherse.runtime`（同步读）/ `spherse.getRuntime()`（Promise） | 获取当前会话上下文（仅 HtmlCard 有值） |

所有请求型方法都返回 Promise，内部已处理 `requestId` 匹配与 10 秒超时，失败时 reject。

## 运行时上下文（聊天 HtmlCard 专属）

当 HTML 作为**聊天 HtmlCard** 渲染时，`spherse.runtime` 携带当前会话信息；Welcome Page 与 Content Browser 预览中为 `null`。

- **交互式卡片**（用户点击才触发）：直接读 `spherse.runtime`
- **加载即使用**：用 `await spherse.getRuntime()`（内部已处理竞态，无需自己注册 message 监听）

```javascript
const rt = await spherse.getRuntime();
// rt.sessionId / rt.agentId / rt.projectId
await spherse.sendMessage({ sessionId: rt.sessionId, message: "继续分析" });
```

## 触发型 Action

### `spherse.createSession(params)`

创建新会话并导航到聊天页面。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| agentId | string | 否 | 目标 agent 的 ID（UUID，与 `agentSlug` 二选一，同时提供时以 `agentId` 为准） |
| agentSlug | string | 否 | 目标 agent 的 slug（即 agent 目录名，形如 `writer-a1b2c3`，可在 agent 右键菜单「复制 ID」获取） |
| message | string | 否 | 初始消息内容 |
| float | boolean | 否 | 为 `true` 时在浮窗中打开 |

```javascript
spherse.createSession({ agentId: "writer", message: "请帮我扩展这段设定" });
// 或用 slug
spherse.createSession({ agentSlug: "writer-a1b2c3" });
```

### `spherse.openFile(path)`

在 Content Browser 中打开项目文件。`path` 可传字符串或 `{ path }`。

```javascript
spherse.openFile("world/characters/主角设定.md");
```

### `spherse.openExternalLink(url)`

在系统默认浏览器中打开外部链接（http/https/mailto/tel）。HTML 中的外部链接若用原生 `<a href>`，会在 iframe 内原地跳转，应改用本方法。`url` 可传字符串或 `{ url }`。

```javascript
spherse.openExternalLink("https://example.com/reference");
```

> 仅 http/https/mailto/tel 协议生效，其它协议会被静默忽略。

### `spherse.floatSession(sessionId)` / `spherse.unfloatSession()`

将指定会话显示为浮窗 / 关闭当前浮窗。`sessionId` 可传字符串或 `{ sessionId }`。一次只能有一个浮窗。

### `spherse.floatContent(path)` / `spherse.unfloatContent(path)`

将项目内文件以浮窗形式打开 / 关闭。多个文件可同时浮窗。

### `spherse.emitAgentTriggerEvent(params)`

触发自定义事件，激活配置了「事件触发器」的 agent。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| eventName | string | 是 | 自定义事件名（不能以 `sp:` 开头，该前缀为系统保留） |
| payload | string | 否 | 事件附带数据，会通过 `{{payload}}` 注入触发器消息模板 |

```javascript
spherse.emitAgentTriggerEvent({ eventName: "daily-review", payload: "第3章" });
```

## 请求型 Action — 发送消息

### `spherse.sendMessage(params)` → `Promise<void>`

向已有会话发送消息并导航到聊天页面。返回 Promise：

- 发送成功：resolve
- 目标会话仍在生成中（`session_busy`）：reject，消息**不会**被发送，应提示用户稍后重试

```javascript
const rt = await spherse.getRuntime();
try {
  await spherse.sendMessage({ sessionId: rt.sessionId, message: "继续" });
} catch (e) {
  // 会话忙碌或发送失败
}
```

## 请求型 Action — key-value 数据

`data.*` 系列在 HTML 同级的 `.data.json` 文件中读写 key-value。

### `spherse.data.get(params)` → `Promise<any>`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | string | 是 | 数据文件路径（如 `world/game.data.json`） |
| key | string | 是 | 要读取的 key |

返回值：对应的 value（任意 JSON 类型），key 不存在时返回 `null`。

```javascript
const score = await spherse.data.get({ file: "world/game.data.json", key: "score" });
```

### `spherse.data.set(params)` → `Promise<any>`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | string | 是 | 数据文件路径 |
| key | string | 是 | key 名 |
| value | any | 是 | 任意 JSON 可序列化值 |

返回写入后的 value。文件不存在时自动创建。

```javascript
await spherse.data.set({ file: "world/game.data.json", key: "score", value: 100 });
await spherse.data.set({ file: "world/game.data.json", key: "player", value: { name: "Alice", hp: 80 } });
```

### `spherse.data.delete(params)` → `Promise<true>`

```javascript
await spherse.data.delete({ file: "world/game.data.json", key: "score" });
```

### 数据文件命名规范

- 文件名必须为 `{HTML文件名}.data.json`，放在 HTML 同级目录（`world/game.html` → `world/game.data.json`）
- 顶层 JSON object，仅支持顶层 key 操作（不支持 `a.b.c` 嵌套路径）
- value 支持任意 JSON 可序列化类型

## 请求型 Action — 只读项目信息（HTTP bridge）

`spherse.api.*` 提供对项目信息的只读查询，底层经 App 已认证的 HTTP client 转发。**只读**：需要写入或触发副作用时用上述专用 action。

### 命名便捷方法

```javascript
// agents
const agents = await spherse.api.agents.list();
const agent = await spherse.api.agents.get("agent-id");

// sessions
const sessions = await spherse.api.sessions.list("agent-id");
const msgs = await spherse.api.sessions.messages("agent-id", "session-id");
const status = await spherse.api.sessions.status("agent-id", "session-id");

// content
const file = await spherse.api.content.get("notes/outline.md");

// 杂项
const tree = await spherse.api.fileTree();
```

### 通用入口

```javascript
const data = await spherse.api.call("agents.list");
const data = await spherse.api.call("sessions.messages", { agentId: "a1", id: "s1" });
```

可用 op 白名单（未列出的 op 返回 reject，`error: "unknown_op"`）：

`agents.list` · `agents.get` · `sessions.list` · `sessions.messages` · `sessions.status` · `content.get` · `fileTree`

> 读取走 server 既有访问策略（如 `.spherse/` 目录会被拒绝）。非白名单 op 一律拒绝 —— 需要新 op 时扩展 App 的 `api.call` handler 白名单。

## 完整示例

### 交互式欢迎页

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; padding: 2rem; }
    .card { padding: 1rem; border: 1px solid #e5e5e5; border-radius: 0.5rem; margin-bottom: 1rem; cursor: pointer; }
    .card:hover { background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>我的世界观</h1>
  <div class="card" onclick="spherse.openFile('world/characters.md')">角色档案</div>
  <div class="card" onclick="spherse.createSession({ agentId: 'writer', message: '开始新的写作会话' })">开始写作</div>
</body>
</html>
```

### 带数据持久化的游戏存档

假设 HTML 为 `world/game.html`，数据文件为 `world/game.data.json`。

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <h1>游戏存档</h1>
  <p>当前分数：<span id="score">--</span></p>
  <button onclick="loadScore()">读取存档</button>
  <button onclick="saveScore()">保存分数</button>

  <script>
    const DATA_FILE = "world/game.data.json";

    async function loadScore() {
      const score = await spherse.data.get({ file: DATA_FILE, key: "score" });
      document.getElementById("score").textContent = score ?? "无存档";
    }

    async function saveScore() {
      await spherse.data.set({ file: DATA_FILE, key: "score", value: 42 });
      document.getElementById("score").textContent = "42（已保存）";
    }
  </script>
</body>
</html>
```

### 查询 agent 列表渲染选择器

```javascript
const agents = await spherse.api.agents.list();
const html = agents.map(a => `<option value="${a.id}">${a.slug}</option>`).join("");
document.getElementById("agent-select").innerHTML = html;
```

## 注意事项

- **SDK 自动注入**：App 向每个 HTML 注入 `<script src="__spherse-sdk.js">`（同源加载，保留 iframe 真实 origin）。**不要**自己加载或复制 SDK 源码
- **频率限制**：每分钟最多触发 10 次操作，超出会被静默丢弃。`data.get` 与 `api.call` 受同一限制，交互式页面避免高频轮询
- **无 script-src 加载失败时**：若 HTML 自身设了限制性 CSP（如 `meta http-equiv="Content-Security-Policy"` 禁止同源 script），SDK 可能无法加载。应放宽 CSP 允许同源 script 加载，不要绕开 SDK 自行拼装 `postMessage`
- **参数校验**：缺少必填参数或类型不匹配时操作会被静默忽略
- **action 严格匹配**：名称区分大小写
