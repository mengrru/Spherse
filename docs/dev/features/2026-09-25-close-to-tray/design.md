# 关闭至托盘（Close to Tray）设计

- 日期：2026-09-25
- 状态：已实施

## 背景与目标

桌面端当前关闭主窗口即退出进程（`window-all-closed` → `gracefulShutdown`），本地 server、移动端隧道、正在运行的 Agent 与自动化随之停止。新增「关闭至托盘」：

- 设置 > 通用 新增开关「关闭至托盘」，**默认启用**；仅桌面端显示（web 无此能力）
- 启用时：关闭主窗口 = 隐藏窗口，进程继续运行；系统托盘（macOS 为菜单栏）常驻 Spherse 图标
- 左键点击托盘图标 → 显示并聚焦主窗口
- 右键托盘图标 → 菜单「打开 Spherse」「退出」
- 关闭开关时：移除托盘图标，关闭窗口恢复为退出应用（与现状一致，含 macOS）

## 已确认的产品决策

1. 默认启用
2. 托盘图标在开关启用期间常驻（不论窗口是否可见），关闭开关立即移除
3. 菜单全平台两项：「打开 Spherse」+「退出」（部分 Linux 桌面环境不派发托盘左键点击，菜单项保证可达）
4. macOS 收至托盘时隐藏 Dock 图标（`app.dock.hide()`），窗口再次显示时恢复（`app.dock.show()`）

## 决策

| 决策点 | 结论 |
|---|---|
| 设置字段 | `AppSettings.closeToTray?: boolean`（core types）/ `HostSettings.closeToTray?: boolean`（app host-bridge），缺省视为 `true`；desktop `getMaskedSettings` / `saveSettings` 按 `tabsEnabled` 同模式补默认与合并；app `settings-store` 纳入 `UiSettings` 并随 `persist` 读改写，防止其他 setter 覆盖丢失 |
| UI 可见性 | `HostCapabilities` 新增 `tray: boolean`（electron `true`，web `false`）；设置 > 通用 仅 `capabilities.tray` 时渲染开关，Switch 模式同「多标签页」 |
| 生效时机 | 主进程在 `close` 事件时实时读 `getSettings()?.closeToTray ?? true`，无需缓存；托盘的创建/销毁在启动时与每次 `save-settings` 后调用 `syncTray()` 同步（同时重建菜单，使 locale 变化生效） |
| 关闭拦截 | `electron/tray.ts` 的 `attachCloseToTray(win)` 仅挂在主窗口 `close` 上：`isQuitting()` → 放行；窗口**已收至托盘**时收到 `close`（非用户操作，典型为 NSIS 安装覆盖时 `taskkill` 发 `WM_CLOSE`）→ `preventDefault()` + `app.quit()` 走优雅退出。「已收至托盘」用模块级显式标志 `hiddenToTray`（`hideToTray` 置位、窗口 `show` 事件清除），不从 `isVisible()` / `isMinimized()` 推断（Windows 最小化窗口 `isVisible()` 为 true、macOS 遮挡可能影响可见性判断）；`closeToTray` 启用 → `preventDefault()` 并隐藏（macOS 全屏时先 `setFullScreen(false)`，等 `leave-full-screen` 再隐藏，避免残留黑色 Space），macOS 额外 `app.dock?.hide()`；否则放行 |
| 退出判定 | 新增 `electron/lifecycle.ts` 持有**唯一**的 `quitting` 标志：`beginQuit(): boolean`（首次调用置位并返回 true，重复调用返回 false）/ `isQuitting()`。`main.ts` 原局部 `quitting` 迁入该模块，`gracefulShutdown` 首行 `if (!beginQuit()) return`（同步置位，先于任何 `await`），`before-quit` 仍为 `if (!isQuitting()) { preventDefault(); gracefulShutdown(); }`。于是 Cmd+Q、托盘「退出」、Playwright `app.close()`（内部 `app.quit()`）、Windows `autoUpdater.quitAndInstall`（electron-updater 以 `setImmediate(app.quit)` 触发，先派发 `before-quit`）都先置位，`gracefulShutdown` 末尾 `app.quit()` 关闭窗口时不被拦截。macOS 原生 updater 会先关窗再派发 `before-quit`，但本项目 `installUpdate` 仅 win32 生效，不受影响 |
| 托盘交互 | `electron/tray.ts`：`click` → `showMainWindow()`；Windows / Linux 用 `setContextMenu(menu)`（Windows 左键仍派发 `click`、右键弹菜单；Linux AppIndicator 仅支持该方式）；macOS 不用 `setContextMenu`（否则左键也弹菜单），改为 `right-click` → `tray.popUpContextMenu(menu)`。tooltip `Spherse`。`Tray` 实例存模块级变量防 GC |
| 菜单 | 纯函数 `buildTrayMenuTemplate(locale, { onShow, onQuit })`（同 `buildEditMenuTemplate` 可单测）；「退出」→ `app.quit()`，走既有 `before-quit` → `gracefulShutdown` |
| 显示窗口 | `async showMainWindow()`：`isQuitting()` 或窗口不存在 / `isDestroyed()` → no-op（窗口仅在退出流程中销毁，不做重建）；macOS 先 `await app.dock?.show()`；最小化则 `restore()`；`show()` + `focus()`，macOS 再 `app.focus({ steal: true })` |
| 重新激活 | macOS `app.on("activate")` → `showMainWindow()`（Dock / Finder / Launchpad 再次打开）；单实例锁放在 `bootstrap.ts`：`setPath("userData", …)` 之后、`import("./main.js")` 之前 `app.requestSingleInstanceLock()`，未拿到锁 `app.exit(0)` 且不加载 main（否则 main 已注册的 `whenReady` 可能先起第二个 server）；主实例在 main 中监听 `second-instance` → `showMainWindow()`。锁按 userData 目录区分：dev（`Spherse-Dev`）与正式版互不影响，E2E / packaged-smoke 每次传独立 `--user-data-dir` 互不冲突。托盘常驻后用户更容易「以为已退出」再次启动，且 GNOME 等默认无托盘的 Linux 桌面上再次启动是找回窗口的唯一途径，因此一并处理 |
| 关闭开关时 | 托盘销毁；若此时窗口被隐藏不可能发生（设置只能在窗口可见时修改），无需特殊处理；`window-all-closed` 行为不变 |
| 托盘图标资源 | 新增 `packages/desktop/resources/tray/`：macOS 模板图 `trayTemplate.png`（16px）/ `trayTemplate@2x.png`（32px），由 `spherse-icon.svg` 去白底、纯黑透明渲染，系统随明暗自动反色；Windows/Linux 用 `tray.png`（16px）/ `tray@2x.png`（32px），源 `tray.svg`（白色圆角底 + 加粗深色图形，深浅任务栏均可辨）。源 SVG 与 PNG 同目录，打包只取 `*.png`。`nativeImage.createFromPath` 自动拾取 `@2x`。`electron-builder.yml` `extraResources` 增 `resources/tray → tray`；运行时打包版取 `process.resourcesPath/tray`；非打包从模块 `__dirname` 向上查找首个含 `resources/tray` 的目录（main 被 electron-vite 拆到 `dist/main/chunks/`，且 E2E 以 `electron dist/main/index.js` 启动时 `app.getAppPath()` 为 `dist/main`，二者都不能用固定相对路径）。图标为空时 `console.error`；`syncTray` 整体 try/catch，失败只记日志不影响启动，且在 `registerAllIpc` 之后调用 |
| 退出清理 | `will-quit` 中 `destroyTray()`，避免 Windows 残留幽灵图标 |
| i18n | `settings.closeToTray` / `settings.closeToTrayDesc`、`tray.show` / `tray.quit`（zh-CN / zh-TW / en） |

## 契约

```ts
// @spherse/core AppSettings、@spherse/app HostSettings
closeToTray?: boolean; // 缺省视为 true

// @spherse/app HostCapabilities
tray: boolean;
```

无新增 IPC 通道：读写复用 `get-settings` / `save-settings`，托盘同步挂在 `save-settings` handler 内。

## 影响面

- `packages/core/src/types.ts`：`AppSettings.closeToTray`
- `packages/app`：`host-bridge.ts`（`HostSettings`、`HostCapabilities.tray`）、`stores/settings-store.ts`、`features/settings/index.tsx`、测试 mock（`src/test/host-bridge.ts`、`app-store.test.ts`、`bus-store.test.ts`）
- `packages/desktop`：`electron/{bootstrap,lifecycle,tray,main,settings}.ts`、`electron/ipc/settings.ts`、`src/host-bridge-electron.ts`、`resources/tray/*`、`electron-builder.yml`
- `packages/web`：`WEB_CAPABILITIES.tray = false`
- `packages/i18n`：新增 4 个 key

## 测试

- desktop `settings.test.ts`：`closeToTray` 缺省 true、保存缺省 true、保留旧值
- desktop `ipc/settings.test.ts`：`save-settings` 后调用 `syncTray`
- desktop `tray.test.ts`：`buildTrayMenuTemplate` 标签与回调；`syncTray` 启用创建/禁用销毁/重复调用幂等；平台分支（Linux `setContextMenu`，其他 `right-click` 弹出）
- desktop `tray.test.ts` 关闭拦截：启用 + 未退出 → 阻止并隐藏；禁用或 quitting → 放行；已隐藏窗口收到 close → `app.quit()`；macOS 全屏先退全屏
- desktop `lifecycle.test.ts`：`beginQuit` 仅首次返回 true
- app `settings-store.test.ts`：默认 true、setter 持久化、其他 setter 保留 `closeToTray`
- app 设置 UI 的 `capabilities.tray` 门控沿用 `mobileAccess` 同模式，未单独写组件测试（设置弹窗目前无组件级测试基座）；capability 字段登记由 `host-capabilities.structure.test.ts` 守护
- E2E `close-to-tray.spec.ts`：默认关闭窗口 → 隐藏且进程存活、无 `[tray]` 错误日志（图标可加载）；以同一 `--user-data-dir` 再启动第二个进程 → 其以 0 退出且主窗口重新可见（覆盖单实例锁）；关闭开关后关闭窗口 → 进程退出
- E2E 回归：现有 `app-launch` / `project-close` 依赖 `app.close()` 退出，确认不被拦截

## 已知限制

- GNOME 等默认无系统托盘的 Linux 桌面：关闭窗口后无托盘图标可点，需再次启动应用（`second-instance` 唤回窗口）或在设置中关闭该开关
- Windows 关机 / 注销：系统发 `WM_QUERYENDSESSION` 而非 `WM_CLOSE`，隐藏窗口不阻塞关机，但进程被系统终止，不经 `gracefulShutdown`（与现状一致）
- 窗口隐藏期间 Chromium 对 renderer 定时器节流；server 与 Agent 运行在主进程不受影响
