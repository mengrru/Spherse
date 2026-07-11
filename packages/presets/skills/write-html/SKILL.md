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
    fetch("./atlas.data.json")
      .then((r) => r.json())
      .then((data) => {
        document.getElementById("list").innerHTML = data.regions
          .map((r) => `<li>${r.name}（${r.climate}）</li>`)
          .join("");
      });
  </script>
</body>
</html>
```

> - **字符串模式**下 `fetch` 相对路径会解析到 `about:srcdoc` 而失败。此时把数据直接内联进 HTML（如 `<script>` 中的 JS 对象），或改用 ui-sdk 的 data action（见下文）。
> - preview 路由支持 `json`、`css`、`js`、图片、字体等常见静态资源类型，同目录的 CSS / JS / 图片同样可用相对路径引用。

## 持久化读写：使用 ui-sdk data action

页面需要**写入/持久化**数据（如表单、进度、勾选状态）时，使用 Spherse 提供的基于 `postMessage` 的 key-value 数据接口（ui-sdk data action）。请读取 `use-ui-sdk` skill 获取完整 API。

要点速览（详情见 `use-ui-sdk`）：

- `data.get` / `data.set` / `data.delete`：对 key-value 数据的读写删
- 数据文件路径通过 action 的 `file` 参数显式指定，约定命名为 `{HTML文件名}.data.json` 并与 HTML 同级（如 `world/atlas.html` → `world/atlas.data.json`）；**字符串模式**下 HTML 不是文件，需自行指定一个项目内的 `.data.json` 路径
- 数据文件**不能**放在 `.spherse/` 目录下
- 两种渲染模式都可用（基于 `postMessage`，不依赖 `fetch`）

## 跳转到项目内其它文件：openFile

页面中点击跳转/打开项目内的其它文件时，使用 ui-sdk 的 `openFile` action（在 Content Browser 中打开）。不要用 `<a href="...">` 直接链接（iframe 内的链接不会触发 App 导航）。

```javascript
window.parent.postMessage({
  type: "spherse:action",
  action: "openFile",
  params: { path: "world/characters/主角设定.md" }
}, "*");
```

> `path` 为项目内相对路径。

## 交互式 HtmlCard：将用户选择回传当前会话

当 HTML 作为**聊天 HtmlCard** 渲染时，可以为用户制作带交互性的卡片——例如让用户在多个选项中勾选，点击「提交」后把选择结果直接作为一条消息发回**当前会话**，驱动后续对话或 agent 行为。

实现要点：

1. App 在卡片 iframe 加载时注入运行时上下文 `window.__SPHERSE__`（含 `sessionId`/`agentId`/`projectId`）。
2. 用户点击提交时，读取 `window.__SPHERSE__.sessionId`，组装消息文本，通过 `sendMessage` action 发送。
3. `sendMessage` 支持 request-response，会话忙碌时返回 `{ ok: false, data: { error: "session_busy" } }`，消息**不会发出**，应提示用户稍后重试。

> 完整的 `spherseCall` Promise wrapper 与 `sendMessage` 签名见 `use-ui-sdk` skill。本示例内联了 wrapper 以便自包含。

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

    async function submit() {
      const picks = [...document.querySelectorAll("input:checked")].map((i) => i.value);
      if (picks.length === 0) {
        document.getElementById("tip").textContent = "请至少选择一项";
        return;
      }
      const rt = window.__SPHERSE__;
      if (!rt?.sessionId) {
        document.getElementById("tip").textContent = "未找到当前会话，无法提交";
        return;
      }
      const message = "我选择了展开以下方向：" + picks.join("、");
      try {
        await spherseCall("sendMessage", { sessionId: rt.sessionId, message });
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

> - 此模式仅适用于**聊天 HtmlCard**（Welcome Page / Content Browser 预览不注入 `window.__SPHERSE__`）。
> - 提交内容应是有意义的、可被会话/agent 理解的自然语言，而非原始参数。

## 其它 App 能力调用

需要触发 App 内其它能力（如创建/打开 chat session、向会话发消息、浮窗会话等）时，阅读 `use-ui-sdk` skill，按其中定义的 action 名称与参数调用。可用 action 包括：

- `createSession` — 创建新会话并导航到聊天页
- `sendMessage` — 向已有会话发送消息（支持 request-response，会话忙碌时返回 `session_busy`）
- `emitAgentTriggerEvent` — 触发自定义事件，激活匹配的事件触发器
- `floatSession` / `unfloatSession` — 浮窗显示/关闭会话
- `openFile` — 在 Content Browser 打开项目文件
- `data.get` / `data.set` / `data.delete` — key-value 数据读写

所有 action 均通过 `window.parent.postMessage({ type: "spherse:action", action, params }, "*")` 触发，无需引入任何外部脚本。

> **向当前会话发消息**：当 HTML 作为聊天 HtmlCard 渲染时，App 会注入运行时上下文 `window.__SPHERSE__`（含 `sessionId`/`agentId`/`projectId`），卡片可直接用它向当前会话发消息。详见 `use-ui-sdk` skill 的「运行时上下文」一节。

## 速查：场景 → 方案

| 需求 | 方案 |
|------|------|
| 声明字符编码 | `<head>` 内加 `<meta charset="UTF-8">` |
| 保持卡片内容可滚动 | 切勿设 `body{overflow:hidden}`；保持默认或 `overflow-y:auto`（超长内容需可滚动） |
| 信息量大 / 需长期维护的页面 | 数据与渲染分离：外置 `{页面名}.data.json`，HTML 用 `fetch()` 读取，分两个文件落盘 |
| 文件模式下加载展示数据 | 外置同目录 `.json`，用 `fetch()` |
| 字符串模式下加载展示数据 | 数据内联进 HTML，或用 ui-sdk `data.get` |
| 持久化读写数据 | ui-sdk `data.get` / `data.set` / `data.delete` |
| 点击打开项目内文件 | ui-sdk `openFile` |
| 打开/发送 chat 会话 | ui-sdk `createSession` / `sendMessage` / `floatSession` |
| 触发事件驱动 agent 执行 | ui-sdk `emitAgentTriggerEvent`（配合 agent 触发器配置） |
| 交互式卡片 / 向当前会话发消息 | 读 `window.__SPHERSE__.sessionId`，调 `sendMessage`（如收集用户选择后提交回传，会话忙碌返回 `session_busy`） |
