---
name: write-html
description: 指导在 Spherse 中编写 HTML 页面时的数据读写与 App 能力调用方式（charset、数据外置、ui-sdk postMessage 交互），不约束页面风格或代码风格
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

## 区分两种渲染模式

Spherse 中的 HTML 有两种加载方式，决定了数据能否通过 `fetch` 访问同目录文件：

| 模式 | 加载方式 | 能否 `fetch` 同目录文件 | 典型场景 |
|------|----------|------------------------|----------|
| **文件模式** | HTML 落在项目目录，经 preview 路由以 `src` 加载（真实 origin） | ✅ 可以 | Welcome Page、Content Browser 预览、HtmlCard 带 `file_path` |
| **字符串模式** | 纯 HTML 字符串经 `srcDoc` 加载（无真实 origin） | ❌ 不可以 | Chat HtmlCard 无 `file_path` |

判断方法：如果页面是作为**文件**写入用户项目目录（而非内联字符串），按「文件模式」处理。

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

## 其它 App 能力调用

需要触发 App 内其它能力（如创建/打开 chat session、向会话发消息、浮窗会话等）时，阅读 `use-ui-sdk` skill，按其中定义的 action 名称与参数调用。可用 action 包括：

- `createSession` — 创建新会话并导航到聊天页
- `sendMessage` — 向已有会话发送消息
- `floatSession` / `unfloatSession` — 浮窗显示/关闭会话
- `openFile` — 在 Content Browser 打开项目文件
- `data.get` / `data.set` / `data.delete` — key-value 数据读写

所有 action 均通过 `window.parent.postMessage({ type: "spherse:action", action, params }, "*")` 触发，无需引入任何外部脚本。

## 速查：场景 → 方案

| 需求 | 方案 |
|------|------|
| 声明字符编码 | `<head>` 内加 `<meta charset="UTF-8">` |
| 文件模式下加载展示数据 | 外置同目录 `.json`，用 `fetch()` |
| 字符串模式下加载展示数据 | 数据内联进 HTML，或用 ui-sdk `data.get` |
| 持久化读写数据 | ui-sdk `data.get` / `data.set` / `data.delete` |
| 点击打开项目内文件 | ui-sdk `openFile` |
| 打开/发送 chat 会话 | ui-sdk `createSession` / `sendMessage` / `floatSession` |
