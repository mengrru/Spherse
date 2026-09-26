# 实现计划：系统通知（approval / trigger）

对照 [design.md](./design.md) 拆分，自上而下按依赖序实现。

## 1. core

- [ ] `SessionManager.onSessionEvent(listener)`：sessions Map 写点挂/卸单 runner 订阅（create/restore 挂，destroy/release/evict/closeAll 卸，注册时 backfill 已有 runner），listener 附 `{agentId, sessionId}` ctx
- [ ] `trigger/executor.ts` failed emit 补 `sessionId: logEntry.sessionId`
- [ ] `packages/contracts/src/bus.ts` `trigger_failed` schema 加 optional `sessionId`
- [ ] server `ws-bus.ts` `buildTriggerPayload()` failed 分支透传 `sessionId`
- [ ] `AppSettings` 加 `systemNotifications?: boolean`
- [ ] `@spherse/core` index 导出 `onSessionEvent` 相关签名
- [ ] 测试：onSessionEvent 聚合生命周期；executor failed 带 sessionId

## 2. contracts

- [ ] 新 `packages/contracts/src/push.ts`：subscribe/unsubscribe request schema + parser、`PushPayload`（server↔SW 共享词汇）
- [ ] `connection/info` 响应 schema 加 optional `push: { publicKey }`
- [ ] 导出面镜像契约（index.ts）
- [ ] 测试：schema 校验与拒绝用例

## 3. server

- [ ] `dependencies` 加 `web-push`、`@spherse/i18n`（运行时依赖，勿放 devDeps——electron-builder 生产依赖收集会漏）；devDeps 加 `@types/web-push`
- [ ] 新 `src/push/push-store.ts`：`push-storage.json` 读写（vapid 惰性生成、订阅 upsert/remove、tmp+rename 原子写、0600）
- [ ] 新 `src/push/push-notifier.ts`：attachProject/detachProject；approval/question（经 `onSessionEvent`）与 trigger_completed/trigger_failed（经 `TriggerManager` 事件 + entry notify 判定，entry 被删不推）→ `web-push` 发送（vapidDetails 含 subject 常量）→ 404/410 清理；i18n 文案渲染（订阅 locale）
- [ ] `ProjectRegistry` 构造选项加 `onRuntimeAdded`（异常 try/catch 不阻断注册），`doRegister` 注册成功后触发
- [ ] 新 `src/routes/push.ts`：subscribe/unsubscribe；`routes/connection.ts` 扩展 push 字段
- [ ] `CreateServerOptions` 加 `pushStoragePath`；`index.ts` 装配（未配置则整体禁用）
- [ ] 测试：push-store、PushNotifier（经真实 registry + core，mock web-push 传输层）、routes contract（401/400/幂等）、connection/info

## 4. i18n

- [ ] 三 locale 同步新增 key（settings.systemNotifications*、push.*、web.enableNotifications*，清单见 design D8）

## 5. app（共享 renderer）

- [ ] `HostBridge` 加 optional `notifications` API 组；`HostCapabilities` 加 `systemNotifications` + structure test 同步
- [ ] settings 持久化链四必改点：`HostSettings`（host-bridge.ts）、`settings-store` persist/load 白名单；settings general tab 加「系统通知」Switch（capabilities 门控）+ round-trip 测试
- [ ] `ApprovalNoticeBridge`：现有 toast 逻辑处并行调 `bridge.notifications?.show()`（条件：`systemNotifications !== false` && `!document.hasFocus()`）
- [ ] `TriggerEventBridge`：failed 补 `toast.error` + 系统通知；completed 补系统通知（均受 `entry.notify` + 同上条件；failed 无 sessionId 时无导航 action）
- [ ] 新 `lib/notification-push.ts`：ensureSubscription 决策纯函数（供 web 壳消费）
- [ ] 测试：两个 Bridge 通知条件矩阵；settings 门控与 round-trip；ensureSubscription 决策矩阵

## 6. desktop

- [ ] 主进程 `electron/settings.ts`：`saveSettings` 合并与 `getMaskedSettings` 补 `systemNotifications` 字段
- [ ] 主进程 `electron/ipc/notifications.ts`（`notifications:show` → isSupported guard → `new Notification`，click → `showMainWindow()`）；注册进 `ipc/index.ts`；preload 暴露
- [ ] `host-bridge-electron.ts` 实现 `notifications.show` + `capabilities.systemNotifications: true`
- [ ] `ensureServer()` 传 `pushStoragePath: path.join(userData, "push-storage.json")`
- [ ] 测试：ipc handler（isSupported false 静默）；ensureServer 参数；settings round-trip

## 7. web

- [ ] `vite.config.ts` 切 `injectManifest` + `srcDir`；devDeps 加 `workbox-precaching`、`workbox-routing`、`workbox-core`
- [ ] 新 `src/sw.ts`：**顶层 `self.skipWaiting()` + `clientsClaim()`**、`/// <reference lib="webworker" />` + `__WB_MANIFEST` 声明、precache + NavigationRoute（denylist 保持）、push handler（showNotification + tag 去重）、notificationclick（focus/openWindow）
- [ ] 新 `src/notification-setup.tsx`：connection 存在性 gate → 能力探测 → push 可用性 → permission 状态机（granted→ensureSubscription / default→banner / denied→无 UI）；决策逻辑复用 app 的 `notification-push.ts`
- [ ] `main.tsx` 挂载

## 8. 收尾

- [ ] `npm run lint` + `npm run typecheck` + 相关 workspace 测试
- [ ] `npm run verify`
- [ ] doc-sync（data-conventions / architecture / project-structure / backlog）
