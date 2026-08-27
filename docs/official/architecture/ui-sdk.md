# UI SDK

> 覆盖：`@spherse/sdk` 注入运行时、host 侧 action / event 桥、运行时上下文注入与 HtmlCard 渲染机制。
> preview 路由与 SDK 保留文件名短路见 [server.md](server.md)；data 路由与 DataStore 见 [server.md](server.md)。
> 面向 LLM 的 `window.spherse` API 手册以 `packages/presets/skills/spherse-use-ui-sdk/SKILL.md` 为权威，本文只讲机制。

## 全局图

SDK 由两半组成，仅以 postMessage 协议耦合：

- **`@spherse/sdk`**（`packages/sdk/`）：被注入 iframe 的客户端运行时，暴露 `window.spherse.*`
- **`src/ui-sdk/`**（app 内）：host 桥——接收 action、定向分发事件；`UiSdkBridge` 挂 ProjectScope，自治获取 projectId 与 client

## @spherse/sdk

- esbuild 打包为单文件 IIFE（`dist/browser.js`，target es2019，**不压缩**——注入的 HTML 可直接人读调试）；`dist/source.js` 把 bundle 全文转义为 `SDK_SOURCE` 字符串常量
- 三个子入口：`.`（`SDK_FILENAME` / `SDK_MARK` / `SDK_VERSION` 常量 + `injectHeadScript` 工具，零依赖）、`./source`（`SDK_SOURCE`）、`./browser`（原始 bundle）
- 常量：文件名 `__spherse-sdk.js`、幂等标记 `data-spherse-sdk`；双载守卫 + 别名 `window.Spherse`
- 两种调用模式：`call(action, params)` 携 requestId 走请求-响应（默认 10s 超时）；`fire(action, params)` 单向触发
- `window.spherse` API 面：
  - 触发型：openFile / openExternalLink / openSession / floatSession / unfloatSession / floatContent / unfloatContent / emitAgentTriggerEvent / toast
  - 请求型：createSession（resolve `{sessionId}`）/ sendMessage
  - 数据：`data.get / set / delete / keys / entries / mutate`
  - 只读 HTTP bridge：`api.call(op, args)` 及 agents / sessions / content / fileTree 快捷方法
  - 订阅：`events.on("file:update", { path }, handler)` 返回取消函数
  - 上下文：`runtime` 同步 getter 与 `getRuntime()` Promise
  - 其它：`version`

## 注入路径（两条，共享同一 bundle）

- **server preview 注入**：HTML 响应注入 `<script src="__spherse-sdk.js">`；该保留文件名在任意目录层级**先于访问策略**短路返回 `SDK_SOURCE`（`__auth/:token/` 前缀同样匹配）——保证注入的 script 永远可达
- **renderer 内联注入**：HtmlCard srcDoc 场景由 `ensureSdk()` 内联 `<script>SDK_SOURCE</script>`（srcDoc 无可靠外部加载）
- 幂等：`injectHeadScript` 以 `SDK_MARK` 子串命中即跳过，两条路径互不重复注入
- srcDoc 注入顺序：`ensureCharset → ensureScrollable → ensureSdk → injectBase`；`<base href>` 置于 `<head>` 最前，使相对资源与 SDK script 解析到 preview 目录

## host 侧 action 桥

- 入站校验：`type === "spherse:action"` 且 origin 在白名单——renderer origin、server origin，以及 `"null"`（防御性放行，当前无实际产生场景）
- **rate limit**：外部调用 30 次 / 60s，超限静默丢弃；白名单 `{ data.get, data.keys, data.entries, data.mutate }` 不计数（`data.set` / `data.delete` / `api.call` 不在白名单）
  - 配额为模块级单数组，跨全部 iframe 共享——高频写页面会耗尽配额
  - 对 call 型 action，静默丢弃在 SDK 侧表现为 10s 超时而非错误返回；参数校验失败的早退路径同样不 respond
- `registry` 是 `Map<action, handler>`，handlers 文件以 import 副作用注册；新增 action = `handlers/` 新文件 + `registerAction` + 在 `ui-sdk/index.ts` barrel 补 import（无自动发现）
- handler 一览（经 `ActionContext` 获得 navigate / projectId / client / hostKind / requestId / source / openExternal）：

| 族 | action 与语义 |
|---|---|
| 导航 | openFile（可 float 浮窗）、openExternalLink（loopback 且 browser feature 开启时走内置浏览器，否则 openExternal）、floatContent / unfloatContent |
| 会话 | createSession、sendMessage、openSession（仅打开不发消息）、floatSession / unfloatSession |
| 数据 | data.get / set / delete / keys / entries / mutate（见下节） |
| 其它 | showToast（sonner variant 分派）、api.call（只读白名单）、emitAgentTriggerEvent（经 bus WS） |

- 请求-响应：`respond` 仅在 ctx 带 requestId 与 source 时回 `spherse:response`；触发型 action 无 requestId，respond 短路为 no-op

## api.call 白名单

- 9 个只读 op：agents.list / agents.get、sessions.list / sessions.messages / sessions.status、content.get / content.listDir / content.stat、fileTree
- 错误码：缺 client 或 op 非法 → `bad_request`；白名单外 → `unknown_op`；handler 异常 → `request_failed`
- 设计约束：无写 / 管理端点——变更一律走专用 action（createSession / sendMessage / data.mutate）

## data handler 与 `$manifest`

- 入参校验：`file` 必须以 `.data.json` 结尾且不在 `.spherse/` 下
- **`$` 前缀保留键**双层拒绝：host 侧 `data.get / set / delete` 直接拒绝；core 侧 `keys / entries` 读取剔除全部 `$` 键、`writeRaw` 抛 ForbiddenKey
- **页面与 agent 共用入口**：`$manifest` 声明业务命名的 queries / mutations（含 auto 字段 uuid / nowIso、幂等 key）；页面 `data.mutate`（origin `"sdk"`）与 agent 的 `mutate_data` 工具打同一 DataStore——锁内原子 RMW、schema 校验、幂等缓存一致生效

## event 桥（host → iframe）

- 订阅协议：iframe post `spherse:event-subscribe / unsubscribe`（携 subscriptionId、event、filter）
- SDK 侧 `resolveEventPath` 基于 `document.baseURI` 解析 `./`、`../` 相对路径（跳过 `__auth/<token>` 段）；非相对输入透传，由 host 侧归一化兜底拒绝绝对路径
- host 侧：bus fs-watch change 事件经 300ms 按 path 去抖后，按 `MessageEvent.source` 定向 postMessage（精确 path 相等匹配，非前缀）
- 每 iframe 订阅上限 100；SDK 在 `pagehide` 批量 unsubscribe

## 运行时上下文注入

- `ChatRuntimeProvider` 向 chat 子树注入 `{ sessionId, agentId }`；`HtmlCardRenderer` 在 iframe `onLoad` 双通道注入 `{ sessionId, agentId, projectId }`：
  - 直写 `window.__SPHERSE__`（cross-origin SecurityError 吞掉）
  - postMessage `spherse:runtime` 通知
- SDK 启动序：response listener → runtime listener → event listener → 同步种子（读 `__SPHERSE__`）；异步路径 resolve 后回写镜像全局，`getRuntime()` 内部处理竞态
- **注入场景矩阵**：HtmlCard 两种模式（content / file_path）注入；Welcome Page 与 Content Browser 预览不注入——只有聊天卡片有会话上下文

## HtmlCard 渲染（SDK 相关）

- `content` 模式：内联 HTML 经 `buildInlineSrcDoc` 同源 srcDoc 渲染（SDK 全文内联）
- `file_path` 模式：fetch preview 拉取文件文本（流式期优先用 tool 回传的 `html`），经 `buildFileSrcDoc` 注入 `<base>` 后同源 srcDoc 渲染
  - 同源 srcDoc 是运行时注入的前提——跨源 `src` 直挂会令 `__SPHERSE__` 直写失败
  - 同源 srcDoc 时双通道注入都可用；fetch 失败降级为跨源 `src` iframe 时丢同步直写通道，postMessage 异步通道仍可送达（前提是页面与 server 注入的 SDK 正常加载）
- `file_path` 指向图片文件时不经 iframe，直接 `<img src={previewUrl}>`
- 去重折叠：`computeSupersededToolCallIds` 对同 `file_path` 的卡片仅保留消息流最后一张展开，其余折叠为占位条（不挂载 iframe，点击懒加载）；用户手动展开过的卡片标记 `userTouched`，不再被自动收回

## 会话 action 语义

- **createSession**：agentId 或 agentSlug 解析 agent；可选 `name` 作为会话标题；resolve `{ sessionId }`，失败 `agent_not_found` / `create_failed`；`open: false` 只创建不跳转
- **sendMessage**：目标会话 streaming 中 → `session_busy`；已 attach WS 走快路径，否则 HTTP fallback（409 映射 `session_busy`）；`open: false` 发完不跳转；`open: false` 与 `float` 同给时前者优先
- **float 降级**：float 类 action 在不支持浮窗的宿主（web / 移动端，经 feature-registry 判定）自动降级为跳转对应主面板页面
