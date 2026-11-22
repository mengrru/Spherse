# PWA Service Worker 手动触发更新（清除 static 缓存）

## 背景

`packages/web`（移动端 PWA）通过 `vite-plugin-pwa` generateSW 预缓存全部 static 文件（`registerType: autoUpdate` + `injectRegister: inline`）。存在两个问题：

1. 用户没有任何手动触发更新的入口：浏览器对 `sw.js` 的更新检查最长滞后 24h，期间 reload 仍命中旧 precache，拿不到新部署的静态资源。
2. 版本不兼容拦截层（`version-block-overlay.tsx`）的「刷新页面」按钮是普通 `location.reload()`，precache 命中时刷新后仍是旧 bundle，提示无法自愈。

用户需求：能从 service worker 触发 PWA 更新，即清除本地 static 文件缓存并拉取最新资源。

## 方案

### 深度刷新流程（`packages/app/src/lib/pwa-update.ts` 的 `clearStaticCacheAndReload`）

1. `registration.update()`：立刻向服务器检查新 `sw.js`（失败忽略）。
2. 向 `waiting ?? active` SW 发 `{ type: "SPHERSE_CLEAR_STATIC_CACHE" }`（MessageChannel 等待 ack，3s 超时容忍旧 SW 无 handler）。
3. `registration.unregister()`：注销当前 SW。这是关键——只删缓存不注销时，同字节 SW 不会重装、precache 不会重建；注销后 reload 时 inline 注册脚本会重新安装 SW 并全量重建 precache。
4. `location.reload()`：新页面无 SW 控制，index.html 与 hashed assets 全部走网络，随后新 SW 安装、precache 重建。

无 SW / 无注册时直接 reload 降级。整个流程任何一步失败都保证走到 reload（`finally`）。

### SW 侧（`packages/web/public/sw-update-handler.js`）

generateSW 模式下经 `workbox.importScripts` 引入的自定义消息处理脚本：收到 `SPHERSE_CLEAR_STATIC_CACHE` 后删除全部 `workbox-*` 缓存（precache + runtime），`skipWaiting()` 并经 MessagePort 回 ack。同时启用 `cleanupOutdatedCaches` 清理旧版本 precache。

消息类型字符串 `SPHERSE_CLEAR_STATIC_CACHE` 是 public JS 与 app lib 之间的跨边界协议串，无法共享 import（public 文件不做 TS 编译），在两处各出现一次，改其一必须同步另一处。

### UI 入口

- **Settings → 关于/版本区块**（`UpdateChecker.tsx`）：web host（`bridge.kind === "web"`）显示「清除缓存并更新」按钮，点击进入 busy 态（「正在清除缓存...」），完成后页面 reload。桌面端不显示。
- **VersionBlockOverlay**：「刷新页面」按钮升级为同一深度刷新流程（busy 态「正在清除缓存并更新...」），修复旧 precache 刷不掉的问题。

helper 放 `packages/app`（app 无法反向依赖 web；helper 本身是纯 DOM API，任何 host 可用），经 package exports 子路径 `@spherse/app/pwa-update` 供 web 壳复用。

## 行为边界

- ack 超时 / SW 无 handler（旧版本已部署的 SW）：仍走 unregister + reload，行为等价（unregistered 后 reload 必然重建缓存），SW 侧清缓存是加速与兜底的交集。
- `registration.update()` 若拉到新 SW，autoUpdate 的 skipWaiting 会让新 SW 先接管；随后本流程照样清缓存、注销、reload，仅多一次 precache 下载，结果确定性不受影响。
- 桌面 Electron renderer 无 `navigator.serviceWorker`：helper 直接 reload；按钮不渲染。

## 变更

- 新增 `packages/web/public/sw-update-handler.js`：SW 消息处理（清 `workbox-*` 缓存 + skipWaiting + ack）。
- 新增 `packages/app/src/lib/pwa-update.ts`：`clearStaticCacheAndReload` 及测试。
- `packages/web/vite.config.ts`：workbox 增加 `cleanupOutdatedCaches: true`、`importScripts: ["sw-update-handler.js"]`。
- `packages/app/package.json`：新增 exports 子路径 `./pwa-update`。
- `packages/app/src/features/settings/UpdateChecker.tsx`：web host「清除缓存并更新」按钮。
- `packages/web/src/version-block-overlay.tsx`：刷新按钮升级为深度刷新。
- `packages/i18n` 三语 locale：`settings.about.clearCacheUpdate` / `settings.about.clearingCache` / `web-version.clearing`。
- `eslint.config.js`：为 SW 脚本声明 `globals.serviceworker` 作用域。
