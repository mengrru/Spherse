---
name: write-html
description: 在 Spherse 中产出任何 HTML 之前必须先阅读本 skill。当用户要求创建或修改 HTML 页面、生成网页、制作可视化展示（欢迎页、导览主页、内容卡片、预览页等任意 HTML 交付物）时，务必在写出 HTML 代码前先读本 skill，了解 charset、数据与渲染分离的决策、数据加载模式与 App 能力调用（含交互式卡片回传会话）的约定；切勿未经阅读直接输出 HTML
---

# 编写 HTML 页面 — 数据读写与 App 能力调用

本 skill 只规范 HTML 页面**如何读取/写入数据、如何调用 App 内能力**，不约束页面视觉风格、布局或代码风格。

## 强制：声明字符编码

所有 HTML 页面必须在 `<head>` 中添加 `<meta charset="UTF-8">`，且尽量靠近 `<head>` 起始位置，避免中文乱码。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>页面标题</title>
</head>
<body>
  <!-- ... -->
</body>
</html>
```

## 强制：不要禁止页面滚动

HtmlCard 在**固定高度**的 iframe 中渲染（默认 400px，上限 600px）。当页面内容超出卡片高度时，必须能滚动查看全部内容——**切勿设置 `body { overflow: hidden }` 或 `html { overflow: hidden }`**，否则超出部分被裁剪、无法滚动，用户看不到完整内容。

```css
/* ❌ 错误：卡片内内容会被裁剪，无滚动条 */
body { overflow: hidden; }

/* ✅ 正确：保持默认（visible）或显式允许滚动 */
body { overflow-y: auto; }
```

> 即便不加 `overflow:hidden`，App 也会在渲染时强制注入 `html,body{overflow-y:auto!important}` 作为兜底；但请勿依赖兜底，页面自身就应保持可滚动。

## 区分两种渲染模式

Spherse 中的 HTML 有两种加载方式，决定了数据能否通过 `fetch` 访问同目录文件：

| 模式 | 加载方式 | 能否 `fetch` 同目录文件 | 典型场景 |
|------|----------|------------------------|----------|
| **文件模式** | HTML 落在项目目录，经 preview 路由以 `src` 加载（真实 origin） | ✅ 可以 | Welcome Page、Content Browser 预览、HtmlCard 带 `file_path` |
| **字符串模式** | 纯 HTML 字符串经 `srcDoc` 加载（无真实 origin） | ❌ 不可以 | Chat HtmlCard 无 `file_path` |

判断方法：如果页面是作为**文件**写入用户项目目录（而非内联字符串），按「文件模式」处理。

## 何时将数据与渲染分离

实现一个 HTML 页面前，先判断它属于哪类，决定数据是「外置 JSON」还是「内联进 HTML」：

| 倾向 | 适用场景 | 做法 |
|------|----------|------|
| **外置 JSON（推荐）** | 信息量较大（多条目列表/表格/清单）、预计需要长期维护与更新、数据可能被其它页面复用 | 数据存成独立的 `{页面名}.data.json` 文件，HTML 只负责渲染并用 `fetch` 加载数据 |
| **内联进 HTML** | 少量一次性展示内容、纯结构展示、字符串模式且无需持久化 | 数据直接写进 `<script>` 中的 JS 对象或 DOM |

外置的好处：数据与结构解耦，后续只改 JSON 即可更新内容，无需触碰 HTML；JSON 也可被其它页面 `fetch` 复用。

> 实现时务必**用 write 工具分别落盘两个文件**：HTML 页面（如 `world/atlas.html`）和数据文件（如 `world/atlas.data.json`），不要只写 HTML。

## 只读展示数据：外置为同目录 JSON（文件模式推荐）

**文件模式**下，把页面需要的展示数据外置到同目录的 `.json` 文件，用 `fetch` 加载。这样数据与结构分离，便于维护和更新，也避免把大段数据塞进 HTML。

约定：数据文件名形如 `{页面名}.data.json`，与 HTML 同级。

假设页面为 `world/atlas.html`，数据文件为 `world/atlas.data.json`：

```json
{
  "regions": [
    { "name": "北境", "climate": "寒带", "faction": "守夜人" },
    { "name": "南境", "climate": "亚热带", "faction": "商会联盟" }
  ]
}
```

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>世界 atlas</title>
</head>
<body>
  <ul id="list"></ul>
  <script>
    // 相对路径基于 HTML 自身 URL 解析，指向同目录的 atlas.data.json
    async function render() {
      const data = await fetch("./atlas.data.json").then((r) => r.json());
      document.getElementById("list").innerHTML = data.regions
        .map((r) => `<li>${r.name}（${r.climate}）</li>`)
        .join("");
    }

    spherse.events.on(
      "file:update",
      { path: "./atlas.data.json" },
      render,
    );
    render();
  </script>
</body>
</html>
```

> - **字符串模式**下 `fetch` 相对路径会解析到 `about:srcdoc` 而失败。此时把数据直接内联进 HTML（如 `<script>` 中的 JS 对象），或改用 ui-sdk 的 data action（见下文）。
> - preview 路由支持 `json`、`css`、`js`、图片、字体等常见静态资源类型，同目录的 CSS / JS / 图片同样可用相对路径引用。
> - 需要在 JSON 被外部工具或 agent 修改后自动刷新页面时，用 `spherse.events.on("file:update", { path: "./atlas.data.json" }, handler)` 订阅。`./` / `../` 路径与 `fetch` 一样基于当前 HTML 的 base 解析；也可以传项目根目录相对路径。完整说明见 `use-ui-sdk` skill。

## 持久化读写：使用 ui-sdk data action

页面需要**写入/持久化**数据（如表单、进度、勾选状态）时，使用注入的 `window.spherse.data.*` key-value 接口。请读取 `use-ui-sdk` skill 获取完整 API。

要点速览（详情见 `use-ui-sdk`）：

- `spherse.data.get` / `spherse.data.set` / `spherse.data.delete`：对 key-value 数据的读写删（均返回 Promise）
- `spherse.data.mutate`：执行数据文件 `$manifest` 声明的业务 mutation 入口（结构性写入用，见下文 `$manifest` 一节）
- 数据文件路径通过 `file` 参数显式指定，约定命名为 `{HTML文件名}.data.json` 并与 HTML 同级（如 `world/atlas.html` → `world/atlas.data.json`）；**字符串模式**下 HTML 不是文件，需自行指定一个项目内的 `.data.json` 路径
- 数据文件**不能**放在 `.spherse/` 目录下
- 两种渲染模式都可用（经 App 注入的 SDK，不依赖 `fetch`）

## 强制：会增长/需要 agent 互动的数据文件必须内嵌 `$manifest`

判断：数据是**静态展示**（一次性内容，页面只 `fetch` 渲染）→ 无需 manifest；数据会**随使用增长**（清单、记录、游戏存档）或**需要 agent 与页面互动读写**（agent 查看用户操作、代用户增删条目）→ 数据文件根部**必须**内嵌 `$manifest` 字段。

manifest 是你（生成页面时）向后续读该文件的 agent 传递业务语义的唯一通道：声明业务命名的查询/变更入口后，agent 用 `query_data` / `mutate_data` 工具按入口读写，一次调用直达数据，不必读整个大文件，写入形状也由 schema 保证不会写坏页面。

生成时三件套**同源产出**：HTML（data action 调用代码）+ 业务数据 + `$manifest`。manifest 的 mutations **必须覆盖页面 SDK 代码实际会做的结构性变更**（页面会 append 条目就声明 append 入口），fields 的枚举值与页面渲染假设一致（页面按 `pending/done` 渲染就不要声明别的值）。

规则：

- 顶层 `$` 前缀键是平台保留，业务数据键不得以 `$` 开头
- manifest 保持精简（≤2KB）：只放路径映射与字段 schema，不放示例数据
- `identity` 声明数组条目的稳定键（通常 `id`），`auto` 声明由系统生成的字段（`uuid`/`nowIso`），不要让调用方传
- dot-path 寻址（`todos`、`stats`），不支持数组下标

模板（todos 看板，可直接改写）：

```json
{
  "$manifest": {
    "version": 1,
    "desc": "任务看板数据",
    "queries": {
      "listTodos": {
        "desc": "待办列表，默认按 createdAt 降序",
        "path": "todos",
        "identity": "id",
        "params": {
          "status": { "type": "enum", "values": ["pending", "done"], "desc": "按状态过滤" },
          "sort": { "type": "field", "desc": "排序字段，默认 createdAt" },
          "dir": { "type": "enum", "values": ["asc", "desc"], "default": "desc" }
        },
        "defaultLimit": 20
      }
    },
    "mutations": {
      "addTodo": {
        "desc": "新增待办",
        "op": "append",
        "path": "todos",
        "fields": {
          "title": { "type": "string", "required": true },
          "priority": { "type": "enum", "values": ["low", "medium", "high"], "default": "medium" }
        },
        "auto": { "id": "uuid", "createdAt": "nowIso" }
      },
      "setTodoStatus": {
        "op": "update", "path": "todos", "match": "id",
        "fields": { "status": { "type": "enum", "values": ["pending", "done"], "required": true } }
      },
      "removeTodo": { "op": "remove", "path": "todos", "match": "id" }
    }
  },
  "todos": []
}
```

要点：`queries` 声明 enum 过滤/排序/`identity` 游标分页；`mutations` 四种 op（`append`/`update`/`remove`/`set`），`match` 字段值由调用方传入（隐式必填），`fields` 做类型/枚举/默认值校验，`auto` 由 server 生成。

**页面代码的写入粒度约定**：声明了 `$manifest` 的数据文件，页面 JS 对集合的**结构性增删改必须走 `spherse.data.mutate({ file, name, args })` 调用同名 mutation 入口**（与 agent 的 `mutate_data` 同一通道，锁内 item 级原子变更，并发互不覆盖）；`data.set` 仅用于单值/标量/低冲突数据，**不要**对数组集合整体 `data.set`——会覆盖 agent 并发写入的条目。

## 跳转到项目内其它文件：openFile

页面中点击跳转/打开项目内的其它文件时，使用 `spherse.openFile`（在 Content Browser 中打开）。不要用 `<a href="...">` 直接链接（iframe 内的链接不会触发 App 导航）。

```javascript
spherse.openFile("world/characters/主角设定.md");
// 直接以浮窗打开（仅 desktop，web 端回退到主面板）
spherse.openFile({ path: "world/characters/主角设定.md", float: true });
```

> `path` 为项目内相对路径。`spherse` 全局对象由 App 自动注入，无需自己引入脚本。完整 API 见 `use-ui-sdk` skill。

## 打开外部链接：openExternalLink

页面中需要打开外部网页（http/https/mailto/tel）时，使用 `spherse.openExternalLink` 在系统默认浏览器中打开。**不要用 `<a href="https://...">` 直接链接**——iframe 中的原生外链只会在 iframe 内原地跳转，无法跳出 App。

```javascript
spherse.openExternalLink("https://example.com");
```

> 仅 http/https/mailto/tel 协议生效，其它协议会被静默忽略。指向项目内文件请用 `spherse.openFile`。完整 API 见 `use-ui-sdk` skill。

## 交互式 HtmlCard：将用户选择回传当前会话

当 HTML 作为**聊天 HtmlCard** 渲染时，可以为用户制作带交互性的卡片——例如让用户在多个选项中勾选，点击「提交」后把选择结果直接作为一条消息发回**当前会话**，驱动后续对话或 agent 行为。

实现要点：

1. App 会自动向每个 HTML 注入 `window.spherse` SDK。
2. 当 HTML 作为聊天 HtmlCard 渲染时，`spherse.runtime` 携带当前会话上下文（`sessionId`/`agentId`/`projectId`）；加载即使用时用 `await spherse.getRuntime()`（内部已处理竞态）。
3. 用户点击提交时，读取 `sessionId`，组装消息文本，通过 `spherse.sendMessage` 发送。
4. `spherse.sendMessage` 是请求型，会话忙碌时会 reject（`session_busy`），消息**不会发出**，应提示用户稍后重试。

> `spherse.sendMessage` / `spherse.getRuntime` 的完整签名见 `use-ui-sdk` skill。

示例：选项卡片，用户勾选后提交，结果回传当前会话。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>选择推进方向</title>
  <style>
    body { font-family: sans-serif; padding: 1rem; }
    label { display: block; margin: 0.4rem 0; cursor: pointer; }
    button { margin-top: 0.8rem; padding: 0.4rem 1rem; }
    #tip { margin-top: 0.5rem; color: #888; min-height: 1.2em; }
  </style>
</head>
<body>
  <h3>请选择接下来要展开的方向</h3>
  <label><input type="checkbox" value="角色背景"> 角色背景</label>
  <label><input type="checkbox" value="势力关系"> 势力关系</label>
  <label><input type="checkbox" value="历史时间线"> 历史时间线</label>
  <button onclick="submit()">提交选择</button>
  <div id="tip"></div>

  <script>
    async function submit() {
      const picks = [...document.querySelectorAll("input:checked")].map((i) => i.value);
      if (picks.length === 0) {
        document.getElementById("tip").textContent = "请至少选择一项";
        return;
      }
      const rt = spherse.runtime;
      if (!rt?.sessionId) {
        document.getElementById("tip").textContent = "未找到当前会话，无法提交";
        return;
      }
      const message = "我选择了展开以下方向：" + picks.join("、");
      try {
        await spherse.sendMessage({ sessionId: rt.sessionId, message });
        document.getElementById("tip").textContent = "已发送";
      } catch (e) {
        document.getElementById("tip").textContent =
          e.message === "session_busy" ? "会话正在生成，请稍后重试" : "发送失败，请重试";
      }
    }
  </script>
</body>
</html>
```

> - 此模式仅适用于**聊天 HtmlCard**（Welcome Page / Content Browser 预览中 `spherse.runtime` 为 `null`）。
> - 提交内容应是有意义的、可被会话/agent 理解的自然语言，而非原始参数。

## 其它 App 能力调用

需要触发 App 内其它能力时，阅读 `use-ui-sdk` skill，通过 `window.spherse.*` 调用。可用方法包括：

- `spherse.createSession(params)` → `Promise<{ sessionId }>` — 创建新会话并导航到聊天页；`open: false` 时只创建不跳转，resolve 返回新会话 ID；可选 `name` 参数为会话命名（显示在会话列表）
- `spherse.openSession(sessionId)` — 打开已有会话并导航，**不发消息**（只跳转用这个）
- `spherse.sendMessage(params)` → `Promise` — 向已有会话发送消息（`message` 必填；会话忙碌时 reject `session_busy`；`open: false` 时静默发送——不跳转，未打开的会话由 server 直接执行）
- `spherse.toast(params)` — 弹一条 toast 提示（`{ variant, message, description? }`）
- `spherse.emitAgentTriggerEvent(params)` — 触发自定义事件，激活匹配的事件触发器
- `spherse.floatSession(id)` / `spherse.unfloatSession()` — 浮窗显示/关闭会话
- `spherse.openFile(path | { path, float })` — 在 Content Browser 打开项目文件；`float:true` 以浮窗打开（desktop）
- `spherse.openExternalLink(url)` — 在系统默认浏览器打开外部链接（http/https/mailto/tel）
- `spherse.data.get/set/delete(params)` → `Promise` — key-value 数据读写
- `spherse.api.*` — 只读查询项目信息（agents / sessions / content / triggers / settings）
- `spherse.events.on("file:update", filter, handler)` — 订阅指定项目文件的变化信号

`spherse` 全局对象由 App 自动注入到每个 HTML，无需自己写 `<script>` 加载或内联 wrapper。

> **向当前会话发消息**：当 HTML 作为聊天 HtmlCard 渲染时，`spherse.runtime`（或 `await spherse.getRuntime()`）携带当前会话上下文（`sessionId`/`agentId`/`projectId`）。详见 `use-ui-sdk` skill 的「运行时上下文」一节。

## 速查：场景 → 方案

| 需求 | 方案 |
|------|------|
| 声明字符编码 | `<head>` 内加 `<meta charset="UTF-8">` |
| 保持卡片内容可滚动 | 切勿设 `body{overflow:hidden}`；保持默认或 `overflow-y:auto`（超长内容需可滚动） |
| 信息量大 / 需长期维护的页面 | 数据与渲染分离：外置 `{页面名}.data.json`，HTML 用 `fetch()` 读取，分两个文件落盘 |
| 文件模式下加载展示数据 | 外置同目录 `.json`，用 `fetch()` |
| 字符串模式下加载展示数据 | 数据内联进 HTML，或用 ui-sdk `data.get` |
| 持久化读写数据 | ui-sdk `data.get` / `data.set` / `data.delete`；结构性集合写入用 `data.mutate` |
| 枚举数据文件 key / 批量读取 | ui-sdk `data.keys` / `data.entries` |
| 列出目录内容 | ui-sdk `api.content.listDir` |
| 获取文件大小/类型/修改时间 | ui-sdk `api.content.stat` |
| 播放音视频 | HTML `<audio src="music.mp3">` / `<video src="clip.mp4">`（相对路径，支持拖动进度条） |
| 点击打开项目内文件 | ui-sdk `openFile` |
| 点击打开外部链接（网页/邮箱） | ui-sdk `openExternalLink`（http/https/mailto/tel），勿用 `<a href>` |
| 打开/发送 chat 会话 | ui-sdk `createSession`（新建，返回 sessionId）/ `openSession`（只打开已有会话，不发消息）/ `sendMessage`（发消息）/ `floatSession` |
| 后台静默创建/驱动会话 | `await createSession({ ..., open: false })` 拿到 `sessionId`，再 `await sendMessage({ sessionId, message, open: false })` 静默执行 |
| 弹 toast 提示 | ui-sdk `toast({ variant, message, description? })` |
| 触发事件驱动 agent 执行 | ui-sdk `emitAgentTriggerEvent`（配合 agent 触发器配置） |
| 交互式卡片 / 向当前会话发消息 | 读 `spherse.runtime.sessionId`，调 `spherse.sendMessage`（如收集用户选择后提交回传，会话忙碌 reject `session_busy`） |
