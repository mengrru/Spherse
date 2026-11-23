# PWA Service Worker 手动触发更新（清除 static 缓存）

## 背景

`packages/web`（移动端 PWA）通过 `vite-plugin-pwa` generateSW 预缓存全部 static 文件（`registerType: autoUpdate` + `injectRegister: inline`）。存在两个问题：

1. 用户没有任何手动触发更新的入口：浏览器对 `sw.js` 的更新检查最长滞后 24h，期间 reload 仍命中旧 precache，拿不到新部署的静态资源。
2. 版本不兼容拦截层（`version-block-overlay.tsx`）的「刷新页面」按钮是普通 `location.reload()`，precache 命中时刷新后仍是旧 bundle，提示无法自愈。

用户需求：能从 service worker 触发 PWA 更新，即清除本地 static 文件缓存并拉取最新资源。

## 方案

### 深度刷新流程（`packages/app/src/lib/pwa-update.ts` 的 `clearStaticCacheAndReload`）

1. 离线守卫：`navigator.onLine === false` 时直接普通 reload（precache 完好时离线可用；断网时清缓存只会白屏，无法回源拉取）。
2. `registration.update()`：立刻向服务器检查新 `sw.js`，5s 竞速超时（失败或挂起忽略）。
3. 向 `waiting ?? active ?? controller` SW 发 `{ type: "SPHERSE_CLEAR_STATIC_CACHE" }`（MessageChannel 等待 ack，8s 超时容忍旧 SW 无 handler）。
4. `registration.unregister()`：注销当前 SW。这是关键——只删缓存不注销时，同字节 SW 不会重装、precache 不会重建；注销后 reload 时 inline 注册脚本会重新安装 SW 并全量重建 precache。
5. `location.reload()`：新页面无 SW 控制，index.html 与 hashed assets 全部走网络，随后新 SW 安装、precache 重建。

无 SW / 无注册时直接 reload 降级。整个流程任何一步失败都保证走到 reload（`try/catch/finally`），`getRegistration()` 抛错也不会泄漏 unhandled rejection。

注意：`injectRegister: "inline"` 时 vite-plugin-pwa **不会**给 generateSW 强制 `skipWaiting/clientsClaim`（仅 `injectRegister: auto/null` 时强制），生成的 sw.js 只有 `SKIP_WAITING` 消息监听。因此普通更新周期里新 SW 只会进入 waiting，不会自动接管；本流程的接管由 sw-update-handler.js 在收到清缓存消息后主动 `skipWaiting()` 完成，reload 完成控制权交接。

### SW 侧（`packages/web/public/sw-update-handler.js`）

generateSW 模式下经 `workbox.importScripts` 引入的自定义消息处理脚本：收到 `SPHERSE_CLEAR_STATIC_CACHE` 后删除与本 SW scope 精确匹配（`workbox-` 前缀且 cache 名以完整 scope URL 结尾）的缓存（precache + runtime），`skipWaiting()` 并经 MessagePort 回 ack。scope 匹配避免误删同 origin 下其他应用的 workbox 缓存（github.io 共享 origin，也隔离 `/web/` 与 `/dev/web/` 两套部署）。同时显式启用 `cleanupOutdatedCaches` 清理旧版本 precache。

消息类型字符串 `SPHERSE_CLEAR_STATIC_CACHE` 是 public JS 与 app lib 之间的跨边界协议串，无法共享 import（public 文件不做 TS 编译），在两处各出现一次，改其一必须同步另一处。

### UI 入口

- **Settings → 关于/版本区块**（`UpdateChecker.tsx`）：web host（`bridge.kind === "web"`）显示「清除缓存并更新」按钮，点击进入 busy 态（「正在清除缓存...」），完成后页面 reload。桌面端不显示。
- **VersionBlockOverlay**：「刷新页面」按钮升级为同一深度刷新流程（busy 态「正在清除缓存并更新...」，其余按钮 busy 中禁用），修复旧 precache 刷不掉的问题。
- **patch-mismatch toast**（`version-guard.tsx`）：web 版本落后于桌面端（`isWebOutdated`，新增于 `version-compat.ts`）时，toast 附「立即更新」action（10s 展示），点击走同一深度刷新；web 更新时维持原「升级桌面端」提示不加按钮（清缓存无助）。incompatible overlay 与 unknown toast 不另加入口（前者已有深度刷新按钮，后者清缓存无法解决服务端版本未知）。

helper 放 `packages/app`（app 无法反向依赖 web；helper 本身是纯 DOM API，任何 host 可用），经 package exports 子路径 `@spherse/app/pwa-update` 供 web 壳复用。

## 行为边界

- ack 超时 / SW 无 handler（旧版本已部署的 SW）：仍走 unregister + reload，行为等价（unregistered 后 reload 必然重建缓存），SW 侧清缓存是加速与兜底的交集。
- `registration.update()` 若拉到新 SW：inline 注册模式下新 SW 只进入 waiting（不自动接管）；本流程向 waiting SW 发消息，其 handler 清缓存并 `skipWaiting()` 接管，随后照样注销、reload，仅多一次 precache 下载，结果确定性不受影响。
- 不向 `installing` 状态的 worker 发消息：其 handler 删除缓存会与自己仍在写入的 install precache 产生同 SW 内丢写竞态；waiting/active/controller 已覆盖目标场景。
- 残余竞态（接受）：SW 侧缓存删除超过 ack 8s 超时的极端场景下，页面超时后 unregister+reload，重新安装的 SW 可能与仍在进行的删除并发写同名 cache，理论上出现空 precache（下次更新检查自愈）；概率极低，接受。
- 断网时清缓存会把 offline 能力破坏到恢复联网为止，故离线守卫直接普通 reload、不动缓存。
- 桌面 Electron renderer 无 `navigator.serviceWorker`：helper 直接 reload；按钮不渲染。

## 变更

- 新增 `packages/web/public/sw-update-handler.js`：SW 消息处理（清 `workbox-*` 缓存 + skipWaiting + ack）。
- 新增 `packages/app/src/lib/pwa-update.ts`：`clearStaticCacheAndReload` 及测试。
- `packages/web/vite.config.ts`：workbox 增加 `cleanupOutdatedCaches: true`、`importScripts: ["sw-update-handler.js"]`。
- `packages/app/package.json`：新增 exports 子路径 `./pwa-update`。
- `packages/app/src/features/settings/UpdateChecker.tsx`：web host「清除缓存并更新」按钮。
- `packages/app/src/lib/version-compat.ts`：新增 `isWebOutdated`（app 版本严格新于 web 即 web 缓存可更新）及测试。
- `packages/web/src/version-guard.tsx`：patch-mismatch 且 web 落后时 toast 附「立即更新」action 走深度刷新。
- `packages/web/src/version-block-overlay.tsx`：刷新按钮升级为深度刷新。
- `packages/i18n` 三语 locale：`settings.about.clearCacheUpdate` / `settings.about.clearingCache` / `web-version.clearing` / `web-version.updateNow`。
- `eslint.config.js`：为 SW 脚本声明 `globals.serviceworker` 作用域。
