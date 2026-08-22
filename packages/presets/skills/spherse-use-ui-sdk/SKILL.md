---
name: spherse-use-ui-sdk
description: 在 Spherse 的 HTML 内容中使用注入的 window.spherse SDK 调用 App 能力（创建会话并获取会话 ID、静默后台发送消息、打开已有会话、打开文件、向会话发消息、读写数据、枚举数据、目录列表、文件元信息、订阅文件变化、只读查询项目信息、弹 toast 提示）
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

`window.spherse` 提供以下能力：

| 类别 | 方法 | 说明 |
|------|------|------|
| 触发型（fire-and-forget） | `openSession` / `openFile` / `openExternalLink` / `floatSession` / `unfloatSession` / `floatContent` / `unfloatContent` / `emitAgentTriggerEvent` / `toast` | 单向触发，无返回值 |
| 请求型（Promise） | `createSession(params)` → `Promise<{ sessionId }>` | 创建会话，返回新会话 ID |
| 请求型（Promise） | `sendMessage(params)` → `Promise` | 等待发送结果 |
| 请求型（Promise） | `data.get` / `data.set` / `data.delete` / `data.keys` / `data.entries` / `data.mutate` | key-value 持久化 + manifest 结构性变更 |
| 请求型（Promise） | `api.call(op, args)` 及 `api.*` 命名方法 | 只读查询项目信息（agents / sessions / content / fileTree） |
| 事件型 | `events.on("file:update", filter, handler)` | 订阅指定项目文件的变化信号 |
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

### `spherse.openFile(path)` / `spherse.openFile(params)`

在 Content Browser 中打开项目文件。`path` 可传字符串或对象 `{ path, float }`。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | string | 是 | 项目内文件路径 |
| float | boolean | 否 | 为 `true` 时在浮窗中打开（仅 desktop；web 端忽略并回退到主面板导航） |

```javascript
spherse.openFile("world/characters/主角设定.md");
// 直接以浮窗打开
spherse.openFile({ path: "world/characters/主角设定.md", float: true });
```

> 与 [`floatContent`](#sphersefloatcontentpath--spherseunfloatcontentpath) 的区别：`openFile({ float: true })` 是「一步直接浮窗打开」；`floatContent` 用于把文件浮窗化（可多窗口并存）。两者可按场景选用。

### `spherse.openSession(sessionId)`

打开**已有**会话并导航到聊天页面，**不发消息**。`sessionId` 可传字符串或 `{ sessionId, float }`。`float` 为 `true` 时在浮窗中打开（desktop），否则在主面板打开。

> 这是「只跳转、不发消息」的正确方式。`sendMessage` 只用于发送消息。

```javascript
const rt = await spherse.getRuntime();
spherse.openSession(rt.sessionId);
// 或浮窗打开
spherse.openSession({ sessionId: rt.sessionId, float: true });
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

### `spherse.toast(params)`

在 App 中弹出一条 toast 提示。`message` 必填，`variant` / `description` 可选。fire-and-forget，无返回值。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | 是 | 提示正文 |
| variant | string | 否 | `"default"` \| `"success"` \| `"error"` \| `"warning"` \| `"info"`，默认 `default` |
| description | string | 否 | 次要说明文字 |

```javascript
spherse.toast({ variant: "success", message: "已保存", description: "world/game.html" });
spherse.toast({ variant: "error", message: "保存失败，请重试" });
```

## 请求型 Action — 创建会话

### `spherse.createSession(params)` → `Promise<{ sessionId }>`

创建新会话，成功时 resolve `{ sessionId }`（新会话的 ID），默认导航到聊天页面。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| agentId | string | 否 | 目标 agent 的 ID（UUID，与 `agentSlug` 二选一，同时提供时以 `agentId` 为准） |
| agentSlug | string | 否 | 目标 agent 的 slug（即 agent 目录名，形如 `writer-a1b2c3`，可在 agent 右键菜单「复制 ID」获取） |
| message | string | 否 | 初始消息内容（`open: false` 时为排队语义：等会话被打开后才发出） |
| name | string | 否 | 会话名称（作为会话标题显示在会话列表中；空白字符串会被忽略） |
| open | boolean | 否 | 为 `false` 时只创建会话、不跳转不浮窗；省略即默认打开 |
| float | boolean | 否 | 为 `true` 时在浮窗中打开（与 `open: false` 同给时以 `open: false` 为准） |

- 成功：resolve `{ sessionId: string }`，可继续用于 `sendMessage` / `openSession` / `floatSession`
- 失败：reject（`agent_not_found` / `create_failed`）

```javascript
const { sessionId } = await spherse.createSession({ agentId: "writer", message: "请帮我扩展这段设定" });
// 或用 slug
spherse.createSession({ agentSlug: "writer-a1b2c3" });
// 创建时命名（显示在会话列表）
spherse.createSession({ agentSlug: "writer-a1b2c3", name: "角色设定整理" });
```

**后台会话 compose 模式**（创建即静默执行，不打开任何 UI）：

```javascript
const { sessionId } = await spherse.createSession({ agentId: "writer", open: false });
await spherse.sendMessage({ sessionId, message: "后台整理设定集", open: false });
```

## 请求型 Action — 发送消息

### `spherse.sendMessage(params)` → `Promise<void>`

向已有会话**发送消息**，默认导航到聊天页面。`message` 必填 —— 这是发消息动作，**不能**省略 `message`。如需只打开已有会话不发消息，请用 [`spherse.openSession`](#spherseopensessionsessionid)。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| sessionId | string | 是 | 目标会话 ID |
| message | string | 是 | 消息内容 |
| open | boolean | 否 | 为 `false` 时静默发送：不跳转不浮窗，消息直接送达 server 立即执行（会话未打开也能发送） |
| float | boolean | 否 | 为 `true` 时在浮窗中打开（与 `open: false` 同给时以 `open: false` 为准） |

返回 Promise：

- resolve：消息**已发出**（目标会话已打开时走实时通道，未打开时由 server 直接执行并持久化）
- `session_busy`：目标会话正在生成中（含后台运行），消息不会被发送，应稍后重试
- `session_not_found` / `send_failed`：会话不存在或发送失败

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

需要设计页面与 Agent 共同读写的数据型应用时，加载 `spherse-build-data-app` skill；本节作为页面侧 API 参数与返回值参考。

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

### `spherse.data.mutate(params)` → `Promise<object>`

执行数据文件 `$manifest` 中声明的业务命名 mutation（与 agent 的 `mutate_data` 同一入口）。**结构性写入（新增/修改/删除数组条目等）优先用此接口**，不要用 `data.set` 传整个数组——避免与 agent 并发写同一集合时互相覆盖。`append` 返回新增条目（包含 `auto` 生成的 `id`、时间等字段），`update` 返回更新后的条目，`remove` 返回被删除的条目，`set` 返回更新后的目标对象。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | string | 是 | 数据文件路径 |
| name | string | 是 | mutation 入口名（见文件 `$manifest`，或让生成页面的 agent 告知） |
| args | object | 否 | 入口参数（必填字段见 manifest 声明；identity/match 字段按名传入） |
| idempotencyKey | string | 否 | 幂等键：同一 key 重试返回首次结果，不重复执行 |

```javascript
const todo = await spherse.data.mutate({ file: "board.data.json", name: "addTodo", args: { title: "买牛奶" }, idempotencyKey: "add-milk-1" });
console.log(todo.id); // manifest 中 auto.id 生成的 UUID
await spherse.data.mutate({ file: "board.data.json", name: "setTodoStatus", args: { id: "abc", status: "done" } });
```

### `spherse.data.keys(params)` → `Promise<string[]>`

返回数据文件中所有顶层 key 列表。文件不存在时返回 `[]`。

```javascript
const keys = await spherse.data.keys({ file: "world/game.data.json" });
// → ["score", "name", "items"]
```

### `spherse.data.entries(params)` → `Promise<Record<string, any>>`

返回数据文件中全部 key-value 对象。文件不存在时返回 `{}`。

```javascript
const all = await spherse.data.entries({ file: "world/game.data.json" });
// → { score: 100, name: "Alice", items: [1, 2] }
```

### 数据文件命名规范

- 文件名必须为 `{HTML文件名}.data.json`，放在 HTML 同级目录（`world/game.html` → `world/game.data.json`）
- 顶层 JSON object，仅支持顶层 key 操作（不支持 `a.b.c` 嵌套路径；key 中的点不会被解释为路径）
- value 支持任意 JSON 可序列化类型
- `data.set` / `data.delete` 是**key 级原子操作**：单次写入不撕裂文件、同 key 并发不互相覆盖，页面无需防写撕裂
- **写入粒度约定**：`data.set` 适合单值/标量/低冲突数据；**集合类（数组）的结构性增删改必须走 `data.mutate`**——`data.set` 传整个数组会覆盖 agent 并发写入的条目（丢失更新）
- 数据文件损坏（非法 JSON）时 `data.*` 返回错误（`ok:false`），不会静默把文件重置为空
- 顶层 `$` 前缀键为平台保留（如 `$manifest`）：`data.set` 拒绝写入、`data.keys` / `data.entries` 不返回它们

### 为数据文件声明 `$manifest`（结构性数据推荐）

数据会随使用增长、且希望 agent 后续能直接按业务语义读写（而不是整文件读改写）时，生成页面时应在数据文件根部内嵌 `$manifest`，声明业务命名的查询/变更入口。agent 将通过 `query_data` / `mutate_data` 工具按这些入口精准读写，schema 校验也保证不会写坏页面渲染假设。数据建模方法见 `spherse-build-data-app` skill，HTML 落地约束见 `spherse-write-html` skill。

## 事件订阅 — 文件变化

### `spherse.events.on("file:update", filter, handler)` → `unsubscribe`

订阅指定项目文件的变化信号。`filter.path` 支持两种写法：

- `./data.json`、`../shared/data.json`：基于当前 HTML 的 `document.baseURI` 解析，SDK 自动转换为项目相对路径，适合与 `fetch("./data.json")` 共用路径。
- `world/data.json`：直接作为项目根目录相对路径。

App 只发送变化信号，不发送文件内容。收到信号后由页面重新 `fetch` 或调用其它 SDK 读取方法。绝对 URL、越过 preview 项目根目录的相对路径会被拒绝。

```javascript
async function render() {
  const data = await fetch("./atlas.data.json").then((response) => response.json());
  // 使用 data 更新页面
}

const unsubscribe = spherse.events.on(
  "file:update",
  { path: "./atlas.data.json" },
  render,
);

render();
```

返回的 `unsubscribe()` 可重复调用且只会取消一次。页面卸载时 SDK 也会自动清理订阅。

handler 收到的事件结构：

```javascript
{
  path: "world/atlas.data.json"
}
```

handler 中的 `path` 始终是归一化后的项目根目录相对路径，即使订阅时传入的是 `./atlas.data.json`。

`file:update` 的语义是“该文件可能已经变化”。handler 应重新读取目标文件并处理读取失败；短时间内同一路径的连续变化会被合并。操作系统底层的文件事件类型不会暴露给用户 HTML，因为它无法可靠区分创建、删除和编辑器的原子替换。

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
  const entries = await spherse.api.content.listDir("world");
  const meta = await spherse.api.content.stat("notes/outline.md");

  // 杂项
  const tree = await spherse.api.fileTree();
  ```

### 通用入口

```javascript
const data = await spherse.api.call("agents.list");
const data = await spherse.api.call("sessions.messages", { agentId: "a1", id: "s1" });
```

可用 op 白名单（未列出的 op 返回 reject，`error: "unknown_op"`）：

`agents.list` · `agents.get` · `sessions.list` · `sessions.messages` · `sessions.status` · `content.get` · `content.listDir` · `content.stat` · `fileTree`

> 读取走 server 既有访问策略（如 `.spherse/` 目录会被拒绝）。非白名单 op 一律拒绝 —— 需要新 op 时扩展 App 的 `api.call` handler 白名单。

#### `content.listDir` 返回值

```typescript
{ name: string, type: "file" | "directory" }[]
```

列出指定目录的一层内容（非递归）。空目录返回 `[]`。返回所有条目（含 dotfiles / node_modules / .spherse），需在页面中自行过滤。

#### `content.stat` 返回值

```typescript
{ size: number, mtime: number, isDirectory: boolean }
```

`size` 为字节数，`mtime` 为 Unix 毫秒时间戳。路径不存在时返回 `request_failed`。

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
- **媒体播放**：Preview Server 支持 mp3/mp4/wav/webm/ogg/flac/mov 等音视频格式（含 Range 请求，可拖动进度条）。HTML 中直接用相对路径的 `<audio src="music.mp3">` 或 `<video src="clip.mp4">` 即可播放
- **频率限制**：每分钟最多触发 30 次操作，超出会被静默丢弃。`data.get`、`data.keys` 与 `data.entries` 不受限（便于交互式页面频繁读取状态），交互式页面避免高频轮询
- **事件订阅限制**：每个 HTML 最多同时订阅 100 个事件；订阅控制消息不计入 action 频率限制
- **无 script-src 加载失败时**：若 HTML 自身设了限制性 CSP（如 `meta http-equiv="Content-Security-Policy"` 禁止同源 script），SDK 可能无法加载。应放宽 CSP 允许同源 script 加载，不要绕开 SDK 自行拼装 `postMessage`
- **参数校验**：缺少必填参数或类型不匹配时操作会被静默忽略
- **action 严格匹配**：名称区分大小写
