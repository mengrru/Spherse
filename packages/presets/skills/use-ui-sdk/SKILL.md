---
name: use-ui-sdk
description: 在 Spherse 的 HTML 内容中嵌入 postMessage 调用，实现 iframe 与 App 的交互（如创建会话、打开文件、key-value 数据读写）
---

# UI SDK — iframe 与 App 交互

Spherse 中的 HTML 文件（欢迎页、Content Browser 预览、聊天 HtmlCard）通过 iframe 展示。你可以使用浏览器原生 `postMessage` API 从 iframe 内触发 App 操作，无需引入任何脚本或依赖。

## 消息格式

所有交互通过 `window.parent.postMessage` 发送，消息必须包含以下结构：

```javascript
window.parent.postMessage({
  type: "spherse:action",
  action: "<action-name>",
  params: { /* action 参数 */ }
}, "*");
```

- `type` 必须为 `"spherse:action"`，其他值会被忽略
- `action` 为操作名称，见下方可用 action 列表
- `params` 为操作参数对象

## 运行时上下文（聊天 HtmlCard 专属）

当 HTML 作为**聊天 HtmlCard** 渲染时，App 会向卡片所在的 iframe 注入当前会话的运行时信息，卡片无需硬编码任何 ID 即可向「当前会话」发消息或读取上下文。Welcome Page 与 Content Browser 预览**不注入**运行时上下文。

注入方式有两种（同时提供，任选其一读取）：

1. **全局变量**：`window.__SPHERSE__`，在 iframe 加载后由 App 写入。

   ```javascript
   const { sessionId, agentId, projectId } = window.__SPHERSE__;
   ```

2. **postMessage 通知**：App 在 iframe 加载时发送 `{ type: "spherse:runtime", sessionId, agentId, projectId }`。在卡片脚本最早期注册监听器即可竞态安全地拿到（推荐用于需要在脚本初始化阶段就使用的场景）：

   ```javascript
   window.addEventListener("message", (e) => {
     if (e.data?.type === "spherse:runtime") {
       window.__SPHERSE__ = e.data;
       init();
     }
   });
   ```

> 对「用户点击按钮才触发」的交互式卡片，直接读 `window.__SPHERSE__` 即可（此时必然已注入）；对「加载时立即使用」的场景，使用 postMessage 监听更稳妥。

### 完整运行时读取封装（推荐）

```javascript
function getSpherseRuntime() {
  return new Promise((resolve) => {
    if (window.__SPHERSE__) return resolve(window.__SPHERSE__);
    const handler = (e) => {
      if (e.data?.type === "spherse:runtime") {
        window.removeEventListener("message", handler);
        resolve(e.data);
      }
    };
    window.addEventListener("message", handler);
  });
}
```

## 可用 Action

### createSession

创建新会话并导航到聊天页面，可选附带初始消息。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| agentId | string | 否 | 目标 agent 的 ID（UUID，与 `agentSlug` 二选一，同时提供时以 `agentId` 为准） |
| agentSlug | string | 否 | 目标 agent 的 slug（即 agent 目录名，形如 `writer-a1b2c3`，可在 agent 右键菜单「复制 ID」获取），作为 `agentId` 的替代 |
| message | string | 否 | 初始消息内容 |
| float | boolean | 否 | 为 `true` 时在浮窗中打开新会话，而非导航到聊天页 |

```javascript
// 通过 agent ID 创建会话
window.parent.postMessage({
  type: "spherse:action",
  action: "createSession",
  params: {
    agentId: "my-writer",
    message: "请帮我扩展这段世界观设定"
  }
}, "*");
```

也可以用人类可读的 agent slug（即 agent 目录名，形如 `writer-a1b2c3`，可在 agent 右键菜单「复制 ID」获取）替代 ID（二者二选一）：

```javascript
// 通过 agent slug 创建会话
window.parent.postMessage({
  type: "spherse:action",
  action: "createSession",
  params: {
    agentSlug: "writer-a1b2c3",
    message: "请帮我扩展这段世界观设定"
  }
}, "*");
```

### openFile

在 Content Browser 中打开指定项目文件。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | string | 是 | 项目内相对文件路径 |

```javascript
window.parent.postMessage({
  type: "spherse:action",
  action: "openFile",
  params: {
    path: "world/characters/主角设定.md"
  }
}, "*");
```

### sendMessage

向已有会话发送消息并导航到聊天页面。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| sessionId | string | 是 | 目标会话 ID（HtmlCard 中可用 `window.__SPHERSE__.sessionId` 获取当前会话） |
| message | string | 是 | 消息内容 |
| float | boolean | 否 | 为 `true` 时确保该会话在浮窗中显示再发送消息 |

`sendMessage` 支持 request-response 模式：传入 `requestId`（配合下文 Promise wrapper）可获取发送结果。

- 发送成功：`{ ok: true }`
- 目标会话仍在生成中（未到达 `agent_end`）：`{ ok: false, data: { error: "session_busy" } }`。此时消息**不会被发送**，卡片应提示用户稍后重试，或在会话空闲后再发。

```javascript
// 向当前会话发消息（HtmlCard 内）
const rt = window.__SPHERSE__;
window.parent.postMessage({
  type: "spherse:action",
  action: "sendMessage",
  params: {
    sessionId: rt.sessionId,
    message: "请继续分析这个角色的动机"
  }
}, "*");
```

带结果反馈的写法（推荐，可感知 busy 状态）：

```javascript
try {
  await spherseCall("sendMessage", { sessionId: rt.sessionId, message: "继续" });
  // 发送成功
} catch (e) {
  // 会话忙碌或发送失败，提示用户稍后重试
}
```

### floatSession

将会话显示为浮窗。一次只能有一个浮窗，新的浮窗会自动替换旧的。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| sessionId | string | 是 | 要浮窗的会话 ID |

```javascript
window.parent.postMessage({
  type: "spherse:action",
  action: "floatSession",
  params: {
    sessionId: "session-abc123"
  }
}, "*");
```

### unfloatSession

关闭当前浮窗。

无需参数。

```javascript
window.parent.postMessage({
  type: "spherse:action",
  action: "unfloatSession",
  params: {}
}, "*");
```

### emitAgentTriggerEvent

触发一个自定义事件，用于激活配置了「事件触发器」的 agent。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| eventName | string | 是 | 自定义事件名（不能以 `sp:` 开头，该前缀为系统保留） |
| payload | string | 否 | 事件附带的数据，会通过 `{{payload}}` 注入触发器的消息模板（是否使用取决于 trigger 配置） |

```javascript
window.parent.postMessage({
  type: "spherse:action",
  action: "emitAgentTriggerEvent",
  params: {
    eventName: "daily-review",
    payload: "第3章"
  }
}, "*");
```

例如 trigger 配置了消息模板 `"请回顾 {{payload}} 的写作进度"`，触发时会拼接为 `"请回顾 第3章 的写作进度"`。

事件触发后，所有匹配该事件名且启用的触发器将自动执行（创建会话或向已有会话发送消息）。此操作为单向触发，无返回值。

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
  <div class="card" onclick="openCharacters()">角色档案</div>
  <div class="card" onclick="startWriting()">开始写作</div>

  <script>
    function openCharacters() {
      window.parent.postMessage({
        type: "spherse:action",
        action: "openFile",
        params: { path: "world/characters.md" }
      }, "*");
    }

    function startWriting() {
      window.parent.postMessage({
        type: "spherse:action",
        action: "createSession",
        params: { agentId: "writer", message: "开始新的写作会话" }
      }, "*");
    }
  </script>
</body>
</html>
```

### 带 Agent 选择的内容页

```html
<!DOCTYPE html>
<html>
<body>
  <h2>势力关系图</h2>
  <p>北境王国与南方联盟之间维持着脆弱的和平。</p>
  <button onclick="analyzeWith('historian')">历史分析</button>
  <button onclick="analyzeWith('strategist')">战略推演</button>

  <script>
    function analyzeWith(agentId) {
      window.parent.postMessage({
        type: "spherse:action",
        action: "createSession",
        params: {
          agentId: agentId,
          message: "请分析北境王国与南方联盟的关系动态"
        }
      }, "*");
    }
  </script>
</body>
</html>
```

## Data Action — key-value 数据持久化

Data action 支持在 HTML 内读写持久化的 key-value 数据。数据存储在与 HTML 文件同级的 `.data.json` 文件中。

Data action 使用 request-response 模式，通过 `requestId` 匹配响应。

### Promise Wrapper（推荐）

将以下代码嵌入 HTML `<script>` 中即可使用 `await` 方式调用：

```javascript
function spherseCall(action, params) {
  return new Promise((resolve, reject) => {
    const requestId = "r" + Date.now() + Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => { cleanup(); reject(new Error("spherse timeout")); }, 10000);
    const handler = (e) => {
      if (e.data?.type === "spherse:response" && e.data.requestId === requestId) {
        cleanup();
        e.data.ok ? resolve(e.data.data) : reject(new Error(e.data.data?.error || "spherse data error"));
      }
    };
    function cleanup() { clearTimeout(timeout); window.removeEventListener("message", handler); }
    window.addEventListener("message", handler);
    window.parent.postMessage({ type: "spherse:action", action, params, requestId }, "*");
  });
}
```

### data.get

读取指定 key 的值。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | string | 是 | 数据文件路径（项目内相对路径，如 `world/game.data.json`） |
| key | string | 是 | 要读取的 key |

返回值：对应的 value（任意 JSON 类型），key 不存在时返回 `null`。

```javascript
const score = await spherseCall("data.get", { file: "world/game.data.json", key: "score" });
```

### data.set

写入 key-value，已存在的 key 覆盖。文件不存在时自动创建。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | string | 是 | 数据文件路径 |
| key | string | 是 | key 名 |
| value | any | 是 | 任意 JSON 可序列化值 |

返回值：写入后的 value。

```javascript
await spherseCall("data.set", { file: "world/game.data.json", key: "score", value: 100 });
await spherseCall("data.set", { file: "world/game.data.json", key: "player", value: { name: "Alice", hp: 80 } });
```

### data.delete

删除指定 key。key 不存在时也返回成功。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | string | 是 | 数据文件路径 |
| key | string | 是 | 要删除的 key |

返回值：`true`。

```javascript
await spherseCall("data.delete", { file: "world/game.data.json", key: "score" });
```

### 数据文件命名规范

- **文件名**：数据文件必须命名为 `{HTML文件名}.data.json`，放在 HTML 文件的同级目录
  - `world/game.html` → `world/game.data.json`
  - `welcome.html` → `welcome.data.json`
- **文件格式**：顶层 JSON object：`{ "key1": value1, "key2": value2 }`
- 仅支持顶层 key 操作，不支持嵌套路径（如 `a.b.c`）
- 所有 value 支持任意 JSON 可序列化类型（number、string、boolean、null、object、array）

### 完整示例

假设 HTML 文件为 `world/game.html`，数据文件约定为 `world/game.data.json`。

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

    function spherseCall(action, params) {
      return new Promise((resolve, reject) => {
        const requestId = "r" + Date.now() + Math.random().toString(36).slice(2);
        const timeout = setTimeout(() => { cleanup(); reject(new Error("spherse timeout")); }, 10000);
        const handler = (e) => {
          if (e.data?.type === "spherse:response" && e.data.requestId === requestId) {
            cleanup();
            e.data.ok ? resolve(e.data.data) : reject(new Error(e.data.data?.error || "spherse data error"));
          }
        };
        function cleanup() { clearTimeout(timeout); window.removeEventListener("message", handler); }
        window.addEventListener("message", handler);
        window.parent.postMessage({ type: "spherse:action", action, params, requestId }, "*");
      });
    }

    async function loadScore() {
      const score = await spherseCall("data.get", { file: DATA_FILE, key: "score" });
      document.getElementById("score").textContent = score ?? "无存档";
    }

    async function saveScore() {
      await spherseCall("data.set", { file: DATA_FILE, key: "score", value: 42 });
      document.getElementById("score").textContent = "42（已保存）";
    }
  </script>
</body>
</html>
```

## 注意事项

- **频率限制**：每分钟最多触发 10 次操作，超出会被静默丢弃。读取类 action（`data.get`）位于白名单内，不受频率限制，便于交互式页面频繁读取状态
- **无需引入脚本**：使用浏览器原生 `postMessage`，零依赖
- **适用场景**：欢迎页（Welcome Page）、Content Browser 预览、聊天 HtmlCard 中均可用
- **单向触发**：导航类操作（createSession、openFile）是单向的，iframe 无法获取执行结果。`sendMessage` 与 Data action（data.get/set/delete）例外，支持通过 `requestId` 获取返回值（`sendMessage` 在目标会话忙碌时返回 `{ ok: false, data: { error: "session_busy" } }`）
- **仅限 UI 操作与数据存取**：导航类操作不支持文件读写、删除等。Data action 支持 key-value 数据存取，数据存储在 HTML 同级的 `.data.json` 文件中
- **参数校验**：缺少必填参数或类型不匹配时操作会被静默忽略
- **action 严格匹配**：action 名称区分大小写，未知 action 会被忽略
