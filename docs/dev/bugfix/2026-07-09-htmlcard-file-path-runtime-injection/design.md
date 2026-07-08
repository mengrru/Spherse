# HtmlCard file_path 模式运行时上下文注入失效

## 问题现象

UI SDK 运行时上下文 `window.__SPHERSE__`（含 `sessionId`/`agentId`/`projectId`，供卡片向「当前会话」调用 `sendMessage` 等 action）只在 inline `content` 渲染的卡片上生效；通过 `file_path` 渲染的卡片拿不到运行时上下文，skill 文档推荐的「直接读 `window.__SPHERSE__`」简易写法返回 `undefined`。

## 根因分析

### 渲染路径分叉

`HtmlCardRenderer` 原先用文件类型二选一渲染 iframe（`features/chat/HtmlCard.tsx`）：

```tsx
{card.file_path && client ? (
  <iframe src={client.getPreviewUrl(card.file_path)} onLoad={...} />
) : (
  <iframe srcDoc={card.html} sandbox="allow-scripts allow-same-origin" onLoad={...} />
)}
```

两条路径的 origin 不同：

| 渲染路径 | iframe origin | 与父窗口是否同源 |
|---------|--------------|----------------|
| `srcDoc`（inline content） | 继承父窗口 | ✅ 同源 |
| `src`（preview URL） | `http://localhost:{port}`（Fastify） | ❌ 跨源 |

### 同源策略阻断全局变量注入

`injectRuntime` 同时用两种方式写入运行时上下文：

```ts
win.__SPHERSE__ = payload;        // 同源才允许
win.postMessage({ type: "spherse:runtime", ...payload }, "*");  // 跨源可用
```

跨源的 `src` iframe 上，`win.__SPHERSE__ = payload` 抛 `SecurityError`，被 `catch` 静默吞掉。只剩 `postMessage` 通知有效——而那要求卡片 HTML 主动注册 `message` 监听器才能读到值。skill 文档里推荐的「直接读 `window.__SPHERSE__`」简易写法（用户点击按钮才触发交互式卡片最常用）在 file 模式下完全失效。

### 为何 file_path 模式必然走跨源 src

`render_card` 工具（`core/src/tools/render-card.ts`）在 `file_path` 模式下的最终返回 result **不带 `html` 字段**（只保留 `file_path`）。前端 `parseHistoryMessages`（`chat-session-reducer.ts`）据此重建 `_card`，`html` 字段为 `undefined`，于是「`file_path` 存在」的判定成立，走跨源 `src` 分支。

## 方案对比

| 方案 | 思路 | 评价 |
|---|---|---|
| A. 服务端注入 | preview 路由按 query 注入 `<script>window.__SPHERSE__=...</script>` | sessionId/agentId 是 renderer chat 状态，服务端无感知；走 query 会把会话 ID 写进 server 日志/历史；preview 路由还服务 Welcome Page/Content Browser，需另开路由隔离。改动面大、有泄漏风险 |
| B. 客户端 fetch + `srcDoc` + `<base>`（**采用**） | file 模式下前端 fetch 文件内容，加 `<base href="{previewDirUrl}/">` 保相对资源解析，统一走 `srcDoc` 同源渲染 | 只改 renderer；无 server/schema/contract 变更；注入路径与 content 模式完全统一；skill 文档的简易写法对两种模式都继续生效 |
| C. Blob URL | fetch 后造 blob URL 装载 | 同样需要 `<base>` 修相对路径，比 B 更绕，无额外收益 |
| D. 自定义协议代理 | 注册 `spherse://` 协议代理 preview | 触及 main 进程协议注册与安全模型，过重 |

## 修复方案

### 1. file_path 模式统一经 `srcDoc` 同源渲染

`features/chat/HtmlCard.tsx` 的 `renderIframe()`：当 `card.file_path` 存在时，优先取 `card.html ?? fetchedHtml` 作为有效 HTML，经 `buildFileSrcDoc(effectiveHtml, previewUrl)` 包一层 `<base>` 后以 `srcDoc` 渲染。fetch 失败时降级为原跨源 `src`（保守兜底，至少能渲染，代价是丢失运行时注入）。

### 2. 纯函数模块 `html-card-src.ts`

新增 `features/chat/html-card-src.ts`，导出：

- `ensureCharset(html)`：缺 `<meta charset>` 时补上（从原 `handleSave` 逻辑中提取复用）
- `buildFileSrcDoc(html, previewUrl)`：从 previewUrl 推导目录 URL，在 `<head>` 后注入 `<base href="{dirUrl}/">`；无 `<head>` 标签时前置

`<base>` 的作用：srcDoc 渲染的 iframe 没有真实 URL，相对资源（`<img src="logo.png">`、`<link href="style.css">`）默认解析失败。`<base>` 把 base URL 指向 preview 服务器对应目录，相对资源得以正确加载。

### 3. 流式与历史恢复路径统一

render_card 工具在流式 `onUpdate` 时**总是**把文件内容放进 `details.html`（即使来源是 `file_path`）。reducer 直接 `updated._card = details` 复制。因此：

- **流式期间**：`card.html` 有值，无需 fetch，直接用它 `buildFileSrcDoc` 包装
- **历史恢复**：持久化的 tool result 不含 `html`，`card.html` 为 `undefined`，useEffect 触发 fetch 拉取文件内容

两条路径都收敛到「经 `buildFileSrcDoc` 包 `<base>` + 同源 `srcDoc`」，行为一致。

useEffect guard：`if (!previewUrl || card.html) return`——html 已在手就不 fetch，避免无谓请求。

### 4. i18n

新增 `chat.loading` 文案（zh-CN / zh-TW / en），用于 file 模式 fetch 期间的占位提示。

## 边界与安全性

- **CORS**：srcDoc iframe 继承父窗口 origin，卡片内的 `fetch()` 到 preview 服务器是跨源请求；Fastify 已注册 `@fastify/cors` 且 `origin: true`（`server/src/index.ts`），反射 Origin header，跨源 fetch（含 preflight）能通过。与 content 模式一直以来的行为一致
- **sandbox**：所有 srcDoc 分支统一 `sandbox="allow-scripts allow-same-origin"`；fetch 失败的降级 `src` 分支也补上同一 sandbox（收紧原先无 sandbox 的状态）
- **竞态**：useEffect 用 `cancelled` 标志防止快速切换卡片时的 stale 响应

## 影响面

- 渲染进程：`features/chat/HtmlCard.tsx`、新增 `features/chat/html-card-src.ts`、新增 `features/chat/HtmlCard.test.ts`、`e2e/ui-sdk-html-card.spec.ts`
- i18n：`chat.loading`（三语）
- 服务端 / core：无改动
- 无 schema / API / contract 变更
