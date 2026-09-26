# 系统通知：approval / trigger 接入系统通知通道

## 背景

approval（permission request）与 trigger 完成目前只有 renderer 内 in-app toast（sonner）：

- approval：`ApprovalNoticeBridge`（`packages/app/src/features/chat/ApprovalNoticeBridge.tsx`）对非活跃 session 的 pending approval/question 弹 toast。窗口失焦 / 最小化 / PWA 关闭时用户错过——approval gate 5 分钟超时默认拒绝（`approval-gate.ts:4`），错过的代价是任务直接失败
- trigger：`TriggerEventBridge`（`packages/app/src/features/agent-trigger/TriggerEventBridge.tsx:43-46`）仅在 `trigger_completed` 且 `entry.notify` 时 toast；`trigger_failed` 完全无通知

用户决策（已确认）：

1. **一步到位做完整 Web Push**：PWA 离线也能收到通知（server 端推送设施一并落地）
2. **单一总开关**：settings 加一个「系统通知」开关；trigger 侧保留已有 per-trigger `notify` 粒度
3. **trigger 完成 + 失败都通知**（均受总开关 / per-trigger notify 控制）
4. **PWA 端无 UI 开关**：通知与否完全跟随浏览器通知权限

## 总体架构：双通道模型

```
desktop (Electron)：renderer 事件（现有两个 Bridge）
  → bridge.notifications.show() → IPC → 主进程 new Notification() → click 聚焦主窗
  条件：总开关 on + approval 非活跃 session + document.hasFocus() === false

web PWA：server 端 PushNotifier（不依赖任何 WS attach）
  → web-push 加密 POST → 厂商 push service（Apple/Google）
  → SW push handler → showNotification（tag 去重）→ click 聚焦/openWindow
  条件：存在订阅即推；SW 侧不做前台抑制（见 D7 决策）
```

两通道互补而非重叠：desktop 不订阅 web push；PWA 前台时 in-app toast 照旧，系统通知由 SW push 提供（多设备场景：desktop 上看 approval，手机 PWA 同时收到系统通知，正是产品价值）。

文案在 **server 端渲染**（订阅携带 locale，`@spherse/i18n` 的 `translate`），SW 保持极薄（只展示 `{title, body, tag}`），避免 SW 内依赖 i18n 与 locale 存储。

## 设计

### D1. core：`SessionManager` 聚合事件接口

approval 推送需要**不依赖 chat WS attach** 的服务端挂点。现有 `subscribeSessionEvents(sessionId, cb)`（`session-manager.ts:136`）是 per-session 且要求 runner 已存在；`ChatSessionHub` 的 channel 更是 WS attach 时才创建。

给 `SessionManager` 加跨 session 聚合订阅：

```ts
onSessionEvent(
  listener: (event: SessionEvent, ctx: { agentId: string; sessionId: string }) => void,
): () => void
```

实现：在 `sessions` Map 的所有写点挂/卸单 runner 的 `subscribeEvents`：

- 挂：`createSession`（:48）、`restoreSession`（:67）set 之后
- 卸：`destroySession`（:189）、`releaseSession`（:193）、`evictAgent`（:210）、`closeAll`（:218）delete 之前
- 注册 listener 时对 map 中已存在的 runner 做一次 backfill 订阅（当前装配时序不需要，但语义自洽、防未来装配顺序变化）

聚合 listener 只消费 `type === "control_request"`（`SessionControlEvent`，`session/types.ts:15-42`，含 `kind: approval|question`、`requestId`、`toolName`），其余事件透传忽略。Push 是即时唤起语义，**不做历史回放**（replay 走既有 WS handshake）。

导出：`@spherse/core` index 补 `onSessionEvent` 签名（server 消费，属外部实际使用）。

### D2. server：PushNotifier 服务

新模块 `packages/server/src/push/`：

**挂点**——`ProjectRegistry` 构造选项加 `onRuntimeAdded?: (ctx: ProjectContextCompat) => void`（对称于现有 `onRuntimeRemoved`，`registry.ts:52`；在 `doRegister` 的 `projects.set` 后触发，**observer 异常 try/catch 吞掉不阻断项目注册**——与 `doRemove` 对 `onRuntimeRemoved` 的保护对称，`registry.ts:193-197`）。装配处（`index.ts:117`）：

```ts
const pushNotifier = pushStoragePath
  ? new PushNotifier({ store, logger, i18n })
  : undefined; // 未配置存储 → push 功能整体禁用
const registry = new ProjectRegistry(logger, {
  ...,
  onRuntimeAdded: (ctx) => pushNotifier?.attachProject(ctx),
  onRuntimeRemoved: (runtime) => { chatHub.closeRuntime(runtime); pushNotifier?.detachProject(runtime); },
});
```

`attachProject(ctx)` 挂两个 listener：

- `ctx.sessionRuntime.onSessionEvent`：`control_request` → 构造 approval/question 通知
- `ctx.triggerManager.on("trigger_completed" | "trigger_failed")`：entry 取 `payload.trigger ?? ctx.triggerManager.get(agentId, triggerId)`（`TriggerEventPayload.trigger?` 已预留，`trigger-manager.ts:18`；executor emit 未带时 fallback 查询，**查询为 null（trigger 已被删除）→ 不推，预期行为**），`entry?.notify === true` 才推

**agentName**：approval 通知 title 需要发起 agent 的名字——`ctx.projectManager.getAgentProfile(agentId)`（同步，与 agents 路由同源）。

**文案**（i18n key 见 D8）：approval title 复用 `chat.approvalToastMessage(WithName)` 语义新增 push 专用 key（含 toolName 的 body：`push.approvalBody`）；trigger title 用 trigger name（`entry.name || cron/eventName`，同 executor 取名逻辑）。

**发送**：`web-push`（`^3.6.7`）`sendNotification(sub, JSON.stringify(payload), { vapidDetails })`；逐订阅 fire-and-forget，失败记日志不抛；响应 404/410 删除该订阅（权限被撤/订阅过期）。日志只记 endpoint 的 origin，不记完整 URL（含 subscription id）。

**payload（≤4KB）**：

```ts
interface PushPayload {
  title: string;   // 已渲染文案
  body: string;
  tag: string;     // approval:{requestId} | trigger:{triggerId}:{Date.now()}
  data: { kind: "approval" | "trigger_completed" | "trigger_failed"; projectId: string; sessionId?: string };
}
```

tag 的时间戳用通知构造时刻 `Date.now()`（executor 的 completed/failed emit 不携带时间戳）。

### D3. 存储：`push-storage.json`（server 级）

- `CreateServerOptions` 加 `pushStoragePath?: string`；未传 → push 禁用（`connection/info` 不带 push 字段、subscribe 路由 404）
- 文件内容：`{ vapid: { publicKey, privateKey }, subscriptions: [{ endpoint, keys: { p256dh, auth }, locale, createdAt }] }`
- VAPID 首次生成（`web-push` 的 `generateVAPIDKeys`）后持久化；写入 tmp+rename 原子落盘，权限 0600
- `sendNotification` 的 `vapidDetails` 需含 `subject`（mailto: 或 https URL，`generateVAPIDKeys` 只产 keys）——用固定常量占位（项目官网 URL）
- **server 级数据、跨项目、不属于任何项目 `.spherse/` 树**；desktop 装配传 `path.join(userData, "push-storage.json")`；未来 CLI 壳传自己的路径
- 私钥永不进日志、永不经 API 返回；`connection/info` 只暴露 `publicKey`（公钥本公开）

### D4. REST API + `connection/info` 扩展（contracts）

新 `packages/contracts/src/push.ts`（schema + parser，复用既有模式）：

- `POST /api/push/subscribe`：body `{ endpoint: url, keys: { p256dh, auth }, locale }` → `{ ok: true }`；同 endpoint 幂等 upsert（更新 locale/keys）
- `POST /api/push/unsubscribe`：body `{ endpoint }` → `{ ok: true }`；不存在也 ok
- 认证：与其它 `/api/*` 相同的 Bearer token（`registerAuthHook` 全局覆盖）
- `GET /api/connection/info`（`routes/connection.ts`，公开路由）响应加 **optional** `push: { publicKey: string }`——schema additive，旧客户端无感；PWA 据此探测 push 可用性

contracts 导出面镜像契约（README 规则）。

### D5. `trigger_failed` 补 `sessionId` + app 层通知条件

- executor 的 failed emit（`executor.ts:159-163`）补 `sessionId: logEntry.sessionId`（mode 错误等早期失败可能为 `""`）
- `contracts/src/bus.ts` 的 `trigger_failed` schema 加 optional `sessionId`
- server 中转层 `ws-bus.ts` 的 `buildTriggerPayload()`（:38-43）failed 分支透传 `sessionId`——漏此层则事件到不了 renderer
- `TriggerEventBridge`：`trigger_failed` 新增 `toast.error` + 系统通知（与 completed 同受 `entry.notify` 控制；toast 的「打开会话」action 仅 `sessionId` 非空时提供）

### D6. desktop 通道

- `HostBridge` 加 optional `notifications?: { show(req: { title: string; body: string }): void }`（`host-bridge.ts`，与 `updater?`/`mobile?` 同类的可选 API 组——先例：`UpdateNoticeBridge` 对不存在的可选组 no-op）
- `HostCapabilities` 加 `systemNotifications: boolean`（electron: `true`，web: `false`）；同步 `host-capabilities.structure.test.ts` 字段清单；消费方为 settings 开关门控（满足「声明即消费」）
- 主进程 `ipc/notifications.ts`：`notifications:show` invoke → `Notification.isSupported()` guard → `new Notification({ title, body })`，click → 复用 tray 的 `showMainWindow()`；注册进 `ipc/index.ts`
- preload 暴露 `notifications: { show }`
- `AppSettings` 加 `systemNotifications?: boolean`（`core/src/types.ts:121`；undefined = 默认开）。**持久化链是字段白名单式的，四个必改点缺一则字段被静默丢弃**：
  1. core `AppSettings`（类型源头）
  2. app `HostSettings`（`host-bridge.ts:58`，renderer 真正消费的类型）
  3. desktop 主进程 `saveSettings()` 逐字段合并（`settings.ts:93-110`）与 `getMaskedSettings()` 逐字段构造（`:53-68`）
  4. app `settings-store` 的 persist/load 白名单（`settings-store.ts:25-38`）
- settings general tab 加 Switch（`capabilities.systemNotifications` 门控渲染，紧邻 `closeToTray` 模式，`settings/index.tsx:290-304`）；补 round-trip 测试（`settings.test.ts` 已有 per-field 先例）
- **弹出条件**（`ApprovalNoticeBridge` / `TriggerEventBridge` 内，与 toast 并行）：
  - approval：沿用现有 toast 条件（非活跃 session）+ `systemNotifications !== false` + `document.hasFocus() === false`（窗口聚焦时 UI 内已有卡片/toast，系统通知冗余）
  - trigger：`entry.notify` + 同上后两个条件

### D7. web 壳：SW + 订阅引导

**构建**：`vite.config.ts` 的 VitePWA 切 `strategies: "injectManifest"`，自写 `packages/web/src/sw.ts`（vite-plugin-pwa 编译到 `dist/sw.js`；devDeps 补 `workbox-precaching`、`workbox-routing`、`workbox-core`）：

- **`self.skipWaiting()` + `clientsClaim()`（workbox-core）必须手写**——generateSW 在 `registerType: "autoUpdate"` 下自动注入这两行，切 injectManifest 后缺失会导致新 SW 永久 waiting、安装型 PWA 吃不到更新（对现有 web 用户是回归）
- `precacheAndRoute(self.__WB_MANIFEST)` + `createHandlerBoundToURL("index.html")` 的 `NavigationRoute`（denylist `/api/ /ws/ /preview/` 保持）
- 类型方案：sw.ts 顶部 `/// <reference lib="webworker" />` + `__WB_MANIFEST` 全局声明，否则 `npm run typecheck` 挂（web tsconfig include src、lib DOM）
- `push`：解析 payload → `registration.showNotification(title, { body, tag, data })`；tag 去重由 SW 保证（Chrome 同 tag 覆盖、iOS 通知中心按 tag 折叠）
- `notificationclick`：`clients.matchAll({ type: "window" })` 有 → focus 第一个；无 → `openWindow(registration.scope)`
- **决策：不做前台抑制**（不检查 visible client）。理由：SW 无法得知 renderer 内哪个 session 活跃（approval 所在 session 是否正被查看）；approval 时效性（5 分钟超时）优先于免打扰；前台时 OS 自身大多将通知静默收入通知中心。后续可经 SW ↔ page postMessage 协调优化（记 backlog）
- `pushsubscriptionchange` 不处理（SW 内无 token 可上报）；endpoint 轮换由下次启动的 ensureSubscription 兜底（见下）

**订阅引导（web-only）**：纯决策逻辑放 `@spherse/app`（`lib/notification-push.ts`，jsdom 可测——沿用 `web-resume-probe` 先例：纯逻辑在 app、web 壳只挂载）；`packages/web/src/notification-setup.tsx` 只做挂载与 UI。

```
已保存 connection？（无 → 无 UI，不请求 connection/info；fetch 走 baseUrl+Bearer，
  先例 version-guard.tsx:51-59）
能力探测（'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window）
  └ 失败 → 无 UI（国产 Android 浏览器等，天然落空）
connection/info 有 push.publicKey？
  └ 无 → 无 UI（server 未启用 push）
Notification.permission:
  - granted → ensureSubscription()：getSubscription() 缺失或 applicationServerKey 不匹配
      → subscribe({ userVisibleOnly, applicationServerKey }) → POST /api/push/subscribe（带当前 locale）
  - default → 顶部 dismissible 小 banner「开启系统通知」（localStorage 记住 dismiss）；
      点击（用户手势内）requestPermission → granted → ensureSubscription()
  - denied → 无 UI（iOS 浏览器标签页恒为 denied，天然隐藏 banner；installed PWA 为 default，banner 正常显示）
```

每次 PWA 启动都会跑 granted 分支的 ensureSubscription，覆盖订阅过期/密钥轮换/VAPID 更换场景（`applicationServerKey` 不匹配 → 退订重订）。

### D8. i18n（三 locale 同步，zh-CN 为 key 源）

新增 key：

- `settings.systemNotifications` / `settings.systemNotificationsDesc`
- `push.approvalTitle` / `push.approvalTitleWithName` `{name}` / `push.approvalBody` `{tool}`
- `push.questionTitle` / `push.questionTitleWithName` `{name}` / `push.questionBody` `{tool}`
- `push.triggerCompletedTitle` `{name}` / `push.triggerCompletedBody`
- `push.triggerFailedTitle` `{name}` / `push.triggerFailedBody`
- `web.enableNotifications` / `web.enableNotificationsHint`

server 侧 PushNotifier 用裸 `translate(locale, key, params)`（同主进程 tray 先例）；renderer toast 复用现有 `chat.approvalToast*` / `agent-trigger.notificationDefault`。

## 平台约束与已知限制

- **iOS 16.4+ 且需「添加到主屏幕」**；Safari 标签页内 `Notification.permission === "denied"` 自然过滤 banner（无需特判 iOS/standalone）
- **国产 Android 浏览器无 push service**：能力探测直接隐藏入口，预期落空（已在调研向用户说明）
- 通知点击不做 session deep link（MVP 仅聚焦窗口 / openWindow scope 根）；记 backlog 后续优化
- SW 不做前台抑制（见 D7 决策）
- Windows 下 `Notification.isSupported()` guard 兜底（dev 模式无 appUserModelId 时可能 false）
- web push 依赖 server 可出站访问厂商 push service 域名（`fcm.googleapis.com` / `push.apple.com` 等）

## 测试计划

- **core**：`onSessionEvent` 聚合生命周期（create/restore 后收到事件、destroy/release 后不再收到、unsubscribe 幂等）；executor failed emit 带 sessionId
- **server**：push-store（vapid 惰性生成与持久化、订阅 upsert/删除、原子写）；PushNotifier（mock `web-push`：approval/question 推送文案渲染、`notify=false` 不推、failed 推送、404/410 清理订阅、无订阅 no-op）；routes/push contract 测试（无 token 401、schema 400、upsert 幂等）；connection/info 带/不带 push 字段。**契约测试红线**：PushNotifier 测试经真实 `ProjectRegistry` + core 运行时驱动（不 mock `onSessionEvent` 本身）
- **app**：两个 Bridge 的通知条件矩阵（开关 off / 窗口聚焦 / 非活跃 session / notify flag）；settings 开关门控（capabilities）
- **web**：ensureSubscription 决策纯函数放 `@spherse/app`（web 无测试设施，沿用 web-resume-probe 模式），决策矩阵（permission × publicKey × 现有订阅状态 × connection 存在性）
- **desktop**：ipc notifications:show（isSupported false 时静默）；ensureServer 传 pushStoragePath
- `npm run verify`（含 i18n check）全绿；按影响面补 E2E（settings 交互），push 链路属外部依赖，不做 E2E

## 文档同步（doc-sync 执行）

- `docs/official/data-conventions.md`：`push-storage.json`（server 级数据文件，宿主注入路径，格式与不变量）
- `docs/official/architecture/server.md`：PushNotifier / push 域；`frontend.md`：notifications 可力与双通道模型
- `docs/official/project-structure.md`：新增文件
- `docs/dev/backlog.md`：新增后续优化条目（通知点击 deep link、SW 前台抑制协调、pushsubscriptionchange 处理）
