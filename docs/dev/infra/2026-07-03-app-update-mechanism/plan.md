# 实施计划：App 更新机制

> Design doc: `docs/dev/infra/2026-07-03-app-update-mechanism/design.md`

## IPC 契约（所有 task 的共享契约，先固化）

renderer → main（`ipcRenderer.invoke`，preload 桥接）。所有更新结果通过事件流（下方 main→renderer 表）传给 renderer，invoke 只作为「触发动作」并返回简单 ack，避免 invoke 返回值与事件形成双重真相源：

| channel | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `check-for-updates` | `{ silent: boolean }` | `void` | 触发检查；结果通过 `update-available` / `update-not-available` / `update-error` 事件送达 |
| `download-update` | — | `void` | 触发下载；进度通过 `download-progress`，完成通过 `update-downloaded` |
| `install-update` | — | `void` | 触发 `quitAndInstall()`，app 将退出 |
| `cancel-update` | — | `void` | 取消下载 |
| `get-update-state` | — | `UpdateState` | mount 时拉取当前快照做初始同步 |
| `get-app-version` | — | `string` | 返回 `app.getVersion()`（renderer 无法直接访问 app 模块） |
| `open-external` | `string`（url） | `void` | `shell.openExternal(url)`，用于 macOS 通知模式跳转 GitHub Releases |

main → renderer（`webContents.send`，preload `onUpdateEvent` 注册监听，返回 unsubscribe 函数）。事件是更新状态的唯一真相源：

| event channel | payload |
|---------------|---------|
| `update-available` | `{ version: string; releaseNotes: string; downloadUrl?: string }` |
| `update-not-available` | — |
| `download-progress` | `{ percent: number }` |
| `update-downloaded` | — |
| `update-error` | `{ message: string }` |

`UpdateState`：

```typescript
type UpdateStatus =
  | "idle" | "checking" | "upToDate"
  | "available" | "downloading" | "downloaded" | "error";
interface UpdateState {
  status: UpdateStatus;
  version?: string;
  releaseNotes?: string;
  downloadUrl?: string;
  percent?: number;
  errorMessage?: string;
}
```

`UpdateEvent`（preload `onUpdateEvent` 回调收到的联合）：

```typescript
type UpdateEvent =
  | { type: "update-available"; version: string; releaseNotes: string; downloadUrl?: string }
  | { type: "update-not-available" }
  | { type: "download-progress"; percent: number }
  | { type: "update-downloaded" }
  | { type: "update-error"; message: string };
```

---

## Task 1：IPC 契约类型 + i18n 文案

**文件**：
- `packages/app/shared/electron-api.ts`（修改）— 新增 `UpdateState`、`UpdateStatus`、`UpdateEvent` 类型；`ElectronAPI` 接口新增 `checkForUpdates`、`downloadUpdate`、`installUpdate`、`cancelUpdate`、`getUpdateState`、`getAppVersion`、`openExternal`、`onUpdateEvent`（返回 unsubscribe 函数）方法签名
- `packages/i18n/src/locales/zh-CN.ts`（修改）— 新增 `settings.update.*` 文案（含注释，见下）
- `packages/i18n/src/locales/zh-TW.ts`（修改）— 对应翻译
- `packages/i18n/src/locales/en.ts`（修改）— 对应翻译

**i18n key 清单**（zh-CN 为基准，每条带注释说明出现位置/上下文）：

```
"settings.tabs.about": "关于"                      // 设置弹窗「关于」tab 标签
"settings.about.version": "当前版本"               // 关于 tab → 当前版本号前的标签
"settings.about.checkUpdate": "检查更新"           // 关于 tab → 检查更新按钮（idle 态）
"settings.about.checking": "检查中..."             // 检查更新按钮（checking 态）
"settings.about.upToDate": "已是最新版本"          // 检查更新按钮（upToDate 态，灰色禁用）
"settings.about.checkFailed": "检查更新失败，请稍后重试"  // error 态文案
"settings.about.retry": "重试"                     // error 态重试按钮
"settings.update.newVersion": "发现新版本 v{version}"  // 更新确认弹窗标题
"settings.update.releaseNotes": "更新内容"         // release notes 区域标题
"settings.update.download": "立即更新"             // 更新确认弹窗 → 同意下载按钮
"settings.update.later": "稍后"                    // 更新确认弹窗 → 稍后按钮
"settings.update.downloading": "下载中 {percent}%"  // 下载进度文案
"settings.update.cancel": "取消"                   // 下载中取消按钮
"settings.update.downloadError": "下载失败"        // 下载失败文案
"settings.update.downloaded": "更新已下载完成"     // 下载完成弹窗标题
"settings.update.restartNow": "立即重启"           // 下载完成弹窗 → 立即重启按钮
"settings.update.restartLater": "稍后重启"         // 下载完成弹窗 → 稍后重启按钮
"settings.update.gotoDownload": "前往下载"         // macOS 通知模式 → 打开 GitHub Releases 按钮
```

**验证**：`npm run check -w @spherse/i18n` 通过；`npm run build -w @spherse/i18n` 通过。

**依赖**：无。所有后续 task 的基础。

---

## Task 2：Electron main — updater 封装 + IPC handler

**依赖**：Task 1 的类型已存在。

**文件**：
- `packages/app/package.json`（修改）— `dependencies` 新增 `"electron-updater": "^6.3.9"`（与 electron 41 / electron-builder 26 兼容的最新 6.x）
- `packages/app/electron/updater.ts`（新增）— 核心封装
- `packages/app/electron/ipc/updater.ts`（新增）— IPC handler 注册
- `packages/app/electron/ipc/index.ts`（修改）— `registerAllIpc` 增加 `registerUpdaterIpc(getWindow)`
- `packages/app/electron/main.ts`（修改）— `app.whenReady` 后延迟 5s 调 `checkForUpdates({ silent: true })`

**`updater.ts` 实现要点**：
1. 工厂函数 `createUpdater(getWindow: () => BrowserWindow | null)`，返回 `{ checkForUpdates, downloadUpdate, installUpdate, cancelUpdate, getState }`。原因：需要 `getWindow` 来 `webContents.send` 事件，且需要持有当前 `UpdateState`。
2. `autoUpdater.autoDownload = false`；`autoUpdater.autoInstallOnAppQuit = false`。
3. dev 模式（`!app.isPackaged`）：`checkForUpdates` 直接返回 `{ status: "upToDate", reason: "dev" }`，不调用 autoUpdater。
4. macOS（`process.platform === "darwin"` 且未签名阶段）：走 `checkForUpdatesMacFallback()` — `fetch("https://api.github.com/repos/mengrru/Spherse/releases/latest")`，解析 `tag_name`（去 `v`）与 `app.getVersion()` 做 semver 比较（用 `electron-updater` 导出的比较或简单 split 比较），有新版则发 `update-available` 事件 + `downloadUrl` 指向 `html_url`；无则发 `update-not-available`。`downloadUpdate`/`installUpdate`/`cancelUpdate` 在 macOS 通知模式下为 no-op。
5. Windows：`autoUpdater.checkForUpdates()`；监听 `update-available`（发事件 + 存 version/releaseNotes）、`update-not-available`、`download-progress`（发 `{ percent }`）、`update-downloaded`、`error`（发 `{ message }`）。
6. 内部维护 `currentState: UpdateState`，事件触发时更新；`getState()` 返回快照。
7. `sendEvent(channel, payload?)` 辅助：`getWindow()?.webContents.send(channel, payload)`，window 为 null 时静默跳过。
8. 导出单例：`export const updater = createUpdater(getMainWindow)`（注意 main.ts 中 `getMainWindow` 在 `createWindow` 后才可用；用 lazy getter 包一层 `() => getMainWindow()`）。

**`ipc/updater.ts` 实现要点**：
- `registerUpdaterIpc(getWindow)`：注册 7 个 `ipcMain.handle`（`check-for-updates` / `download-update` / `install-update` / `cancel-update` / `get-update-state` / `get-app-version` / `open-external`），前 5 个转发给 `updater` 单例，`get-app-version` 返回 `app.getVersion()`，`open-external` 调 `shell.openExternal(url)`。
- 注意：`updater` 单例需要在模块导入时不立即创建（因为 `getMainWindow` 尚未定义），改为 `createUpdater(() => getMainWindow())`，getMainWindow 在 window.ts 中定义且导出。

**main.ts 修改**：
```typescript
import { checkForUpdatesSilently } from "./updater.js";
// 在 createWindow() 之后：
setTimeout(() => { void checkForUpdatesSilently(); }, 5000);
```
（`checkForUpdatesSilently` 即 `updater.checkForUpdates({ silent: true })`，silent 时 error 静默；为简洁可直接复用 updater 方法，silent 语义在 main 侧不再特殊处理，由 renderer 判断 — 实际上 silent 标记仅用于 renderer 决定是否弹 error，main 侧统一发事件，renderer 收到 silent 触发的 error 时不弹。**简化决策**：main 不区分 silent，renderer 的 useUpdateChecker 在「非用户主动触发」的场景忽略 error 事件。）

**验证**：`npm run build -w @spherse/app` 通过；dev 模式启动后 console 不报错；`npm test --workspace=packages/app` 通过。

---

## Task 3：preload 桥接

**依赖**：Task 1（类型）、Task 2（channel 名确认）。

**文件**：
- `packages/app/electron/preload.ts`（修改）

**新增 preload API**：
```typescript
checkForUpdates: (opts: { silent: boolean }) =>
  ipcRenderer.invoke("check-for-updates", opts),
downloadUpdate: () => ipcRenderer.invoke("download-update"),
installUpdate: () => ipcRenderer.invoke("install-update"),
cancelUpdate: () => ipcRenderer.invoke("cancel-update"),
getUpdateState: () => ipcRenderer.invoke("get-update-state"),
getAppVersion: () => ipcRenderer.invoke("get-app-version"),
openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
onUpdateEvent: (callback: (event: UpdateEvent) => void) => {
  const handler = (_e: unknown, payload: UpdateEvent) => callback(payload);
  UPDATE_EVENT_CHANNELS.forEach((ch) => ipcRenderer.on(ch, handler));
  return () => UPDATE_EVENT_CHANNELS.forEach((ch) => ipcRenderer.removeListener(ch, handler));
},
```

其中 `UPDATE_EVENT_CHANNELS = ["update-available", "update-not-available", "download-progress", "update-downloaded", "update-error"]`。

`onUpdateEvent` 返回一个 unsubscribe 函数（renderer 在 effect cleanup 时调用），符合 React effect 模式。

**验证**：`npm run build -w @spherse/app` 通过。

---

## Task 4：Renderer — useUpdateChecker hook

**依赖**：Task 1（类型/i18n）、Task 3（preload API）。

**文件**：
- `packages/app/src/features/settings/use-update-checker.ts`（新增）

**实现要点**：
1. 内部 `useReducer` 管理状态机（status: idle/checking/upToDate/available/downloading/downloaded/error + version/releaseNotes/downloadUrl/percent/errorMessage）。actions：`CHECK`、`SET_AVAILABLE`、`SET_UPTODATE`、`SET_DOWNLOADING`、`SET_PROGRESS`、`SET_DOWNLOADED`、`SET_ERROR`、`RESET`、`CANCEL`。
2. mount 时 `useEffect` 调 `electronAPI.onUpdateEvent(dispatch 对应 action)`，cleanup 调返回的 unsubscribe。
3. 暴露：
   - `state`（含 status 与字段）
   - `check()` — 调 `getUpdateState()`（若已是 downloaded 维持）否则 `checkForUpdates({ silent: false })`；手动检查。
   - `acceptDownload()` — `downloadUpdate()`，dispatch SET_DOWNLOADING。
   - `dismissUpdate()` — dispatch RESET 回 idle。
   - `cancelDownload()` — `cancelUpdate()`，dispatch RESET。
   - `acceptRestart()` — `installUpdate()`。
   - `dismissRestart()` — dispatch RESET（保留 downloaded 状态可供后续重启？**决策**：dismiss 后回 idle，下次启动或再次检查不重复下载 — 简化为回 idle）。
4. `check()` 在 checking 期间防重入（status 非 idle/upToDate/error 时忽略）。

**验证**：`npm test --workspace=packages/app` 通过（可补 reducer 纯函数测试）。

---

## Task 5：Renderer — UpdateChecker 组件 + Settings 集成

**依赖**：Task 4（hook）、Task 1（i18n）。

**文件**：
- `packages/app/src/features/settings/UpdateChecker.tsx`（新增）
- `packages/app/src/features/settings/index.tsx`（修改）— TabsList 增加「关于」trigger，新增 TabsContent 渲染 `<UpdateChecker />`

**UpdateChecker.tsx 实现要点**：
1. 调 `useUpdateChecker()` 取 state + actions。
2. 顶部显示 `当前版本 v{appVersion}`：mount 时调 `electronAPI.getAppVersion()` 取版本号存 local state。
3. 按 status 渲染：
   - idle：Button「检查更新」→ `check()`
   - checking：Button「检查中...」disabled + loading
   - upToDate：Button「已是最新版本」disabled（灰色）
   - error：文案「检查更新失败」+ Button「重试」→ `check()`
   - downloading：进度文案 + Progress bar + Button「取消」→ `cancelDownload()`
   - available / downloaded：由下方 Dialog 处理（Dialog open 条件 = status === available 或 downloaded）
4. `available` Dialog：标题「发现新版本 v{version}」+ releaseNotes（markdown 渲染，复用项目现有 MarkdownContent 组件）+ [稍后][立即更新]。macOS 通知模式（`state.downloadUrl` 存在）：按钮改为「前往下载」→ `electronAPI.openExternal(downloadUrl)`。dismiss → `dismissUpdate()`。
5. `downloaded` Dialog：标题「更新已下载完成」+ [稍后重启][立即重启]。dismiss → `dismissRestart()`，accept → `acceptRestart()`。

**Settings 集成**：
- `TabsList` 增加 `<TabsTrigger value="about">{t("settings.tabs.about")}</TabsTrigger>`
- 新增 `<TabsContent value="about"><UpdateChecker /></TabsContent>`
- import `UpdateChecker`

**验证**：`npm run build -w @spherse/app` 通过；`npm test --workspace=packages/app` 通过；dev 启动后打开设置 → 关于 tab → 点检查更新显示「已是最新版本」。

---

## Task 6：Config + CI

**依赖**：无（可与 Task 2-5 并行，但建议最后做以便确认 publish 配置与实际构建产物一致）。

**文件**：
- `packages/app/electron-builder.yml`（修改）— 新增 `publish` 配置
- `.github/workflows/build-and-release.yml`（新增）— CI workflow
- `docs/dev/backlog.md`（修改）— 基础设施区新增 `[x] app 更新机制` 条目

**electron-builder.yml**：
```yaml
publish:
  provider: github
  owner: mengrru
  repo: Spherse
```

**CI workflow 要点**：
- `on.push.tags: ["v*"]`
- `permissions: contents: write`
- matrix: `macos-latest`, `windows-latest`
- steps: checkout → setup-node 20 → npm ci → `npm run build` → `npx electron-builder --publish always`（workdir `packages/app`）
- env: `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`（GITHUB_TOKEN 自动提供，需 contents:write 权限）
- macOS 构建产物 .dmg 上传到 Release 供手动下载；由于 electron-builder.yml 的 publish 配置，mac 也会尝试发 latest-mac.yml。**为符合未签名阶段只让 Windows 走 electron-updater**：在 mac job 中用 `--publish never` 然后手动 `gh release upload` 只传 .dmg；windows job 用 `--publish always`。这样 latest.yml/latest-mac.yml 都不会被 mac 生成，只有 windows 生成 latest.yml。**简化决策**：第一阶段 mac 用 `--publish never` + `gh release upload` 只放 dmg；windows `--publish always`。

**验证**：workflow YAML lint 通过（可用 `actionlint` 或人工检查）；打一个 `v0.1.1-test` tag 验证 CI 触发（可选，正式验证在合并后）。

---

## Task 依赖图

```
Task 1 (types + i18n)
  ├─→ Task 2 (main: updater + ipc + main.ts + get-app-version)
  │     └─→ Task 3 (preload)
  │           └─→ Task 4 (useUpdateChecker hook)
  │                 └─→ Task 5 (UpdateChecker + settings)
  └─→ Task 6 (config + CI)  [独立]
```

Task 2 必须先于 Task 3/4/5（preload 与 renderer 依赖 main 的 channel 与行为）。Task 6 独立。**建议执行顺序**：1 → 2 → 3 → 4 → 5 → 6（串行，每步可独立验证）。或 6 与 2-5 并行。

## 验收标准

1. `npm run verify` 全绿（lint + build + tests + i18n check）
2. dev 模式：设置 → 关于 → 检查更新 → 显示「已是最新版本」
3. electron-updater 依赖安装成功，打包不报错（`npm run pack -w @spherse/app`）
4. electron-builder.yml 含 publish 配置
5. CI workflow 文件存在且语法正确
6. backlog.md 已更新

## 风险与备注

- **electron-updater 在 dev 模式不可用**：Task 2 已处理（直接返回 upToDate），但开发时无法测试真实更新流程。真实验证需打 tag 走 CI 发布后，用旧版本 app 测试。
- **GITHUB_TOKEN vs GH_TOKEN**：electron-builder 用 `GH_TOKEN` 环境变量；GitHub Actions 自动提供 `GITHUB_TOKEN`，需在 step env 中映射 `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`。
- **macOS 通知模式的 release notes 渲染**：GitHub API 返回 markdown body，UpdateChecker 复用项目现有 MarkdownContent 组件渲染。
