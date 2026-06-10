---
name: use-ui-sdk
description: 在 Spherse 的 HTML 内容中嵌入 postMessage 调用，实现 iframe 与 App 的交互（如创建会话、打开文件）
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

## 可用 Action

### createSession

创建新会话并导航到聊天页面，可选附带初始消息。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| agentId | string | 是 | 目标 agent 的 ID |
| message | string | 否 | 初始消息内容 |

```javascript
window.parent.postMessage({
  type: "spherse:action",
  action: "createSession",
  params: {
    agentId: "my-writer",
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
| sessionId | string | 是 | 目标会话 ID |
| message | string | 是 | 消息内容 |

```javascript
window.parent.postMessage({
  type: "spherse:action",
  action: "sendMessage",
  params: {
    sessionId: "session-abc123",
    message: "请继续分析这个角色的动机"
  }
}, "*");
```

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

## 注意事项

- **频率限制**：每分钟最多触发 10 次操作，超出会被静默丢弃
- **无需引入脚本**：使用浏览器原生 `postMessage`，零依赖
- **适用场景**：欢迎页（Welcome Page）、Content Browser 预览、聊天 HtmlCard 中均可用
- **单向触发**：操作是单向的，iframe 无法获取执行结果（如创建的 sessionId）
- **仅限 UI 操作**：只支持导航类操作，不支持文件读写、删除等
- **参数校验**：缺少必填参数或类型不匹配时操作会被静默忽略
- **action 严格匹配**：action 名称区分大小写，未知 action 会被忽略
