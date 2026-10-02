# Windows 应用内自动更新

## 范围

Windows 恢复 electron-updater in-app 更新链路（backlog #149，即 2026-08-17 更新源改造中否决的方案 B 的落地）：检测仍三平台统一走 OSS `latest.json`；Windows 发现新版本后，更新提醒 toast 与「关于」页提供「后台下载」，下载完成后 toast 与「关于」页提供「安装并重启」（NSIS 静默安装 + 自动重启）。CI 在所有安装包上传 OSS 后再上传 `latest.yml` / `latest-arm64.yml`，最后上传 `latest.json`。macOS/Linux 行为不变（toast「去更新」/ 弹窗「前往下载」引导浏览器下载）。替代并覆盖未合入的 PR #125。

用户确认的决策：

- 安装方式：`quitAndInstall(isSilent=true, isForceRunAfter=true)`——退出后 NSIS 静默覆盖安装到原目录（`/S`，注册表 `InstallLocation`），装完自动启动新版本（`--force-run`），全程无感。
- arm64：双 feed 文件（`latest.yml` x64 + `latest-arm64.yml` arm64），各自更新到同架构构建。
- 增量更新：一并上传 `.exe.blockmap`，后续版本间支持差异下载（首次因无本地缓存仍全量）。增量链条已核实可用：NSIS 安装器安装时会把自身复制到 `%LOCALAPPDATA%\{updaterCacheDirName}\installer.exe`（恰为 electron-updater 的差分 oldFile 缓存），旧 blockmap 命中缓存或按版本串从 `releases/{oldver}/` 拉取，OSS generic object 支持 Range，差分失败自动回退全量。
- 错过「下载完成」toast 的兜底：仅「关于」页常驻「安装并重启」按钮；不开启 `autoInstallOnAppQuit`。重启应用后需重新「后台下载」，electron-updater 本地缓存命中会快速完成（注意：跨重启的缓存校验会对整个 exe 重算 sha512，百 MB 级为数秒磁盘 IO，属可接受成本）。
- Windows 的 About 更新弹窗也展示 release notes（与 mac/linux 对齐）。

评审后补充的决策：

- **更新退行走快路径**（评审 I-2）：`quitAndInstall` 的 `app.quit()` 会命中 main.ts `before-quit` 的 preventDefault + gracefulShutdown（隧道 ≤5s + server 分阶段关闭，最长 30s 看门狗），而 NSIS `--updated` 安装器约 1s 后即开始杀进程、约 3.3s 强杀，慢路径必然被截断。处理：监听 electron-updater 专有的 `before-quit-for-update` 事件，置 lifecycle 退出标记并走快路径——隧道停止收敛到 1s 内、跳过 server 优雅关闭（better-sqlite3 WAL 崩溃安全，靠下次打开恢复）、不启动 30s 看门狗，随后立即退出。被 taskkill 截断的残余风险（隧道子进程偶发残留）接受。
- **per-machine 安装的 UAC**（评审 I-1）：assisted 安装器允许用户选「所有用户」（HKLM）。构建为 per-user 默认，`latest.yml` 不含 `isAdminRightsRequired`，electron-updater 不会预提权；对 per-machine 安装执行静默更新时 NSIS 运行时会弹 UAC，用户拒绝则安装器退出而应用已被关闭（无错误反馈，重新打开仍旧版）。接受该边界（默认安装路径为 per-user，触发面小），列入发版真机验证清单。
- **downloadUpdate 内部拉 manifest 不派发事件**（评审 I-3）：不复用 silent 检测路径（会发 `update-available` 事件造成「点了后台下载又弹一条发现新版本 toast」），改用裸 fetch helper；且**每次** downloadUpdate 都现拉最新 manifest（而非仅缓存缺失时）——点击离检测间隔数小时时manifest 可能已指向更新版本，现拉语义更正确。

## 已验证的关键技术事实（electron-updater 6.3.9 / app-builder-lib 26 源码）

- `downloadUpdate()` 前必须先 `checkForUpdates()`（`AppUpdater.js:437` 对 `updateInfoAndProvider` 判空，否则 reject「Please check update first」并 dispatch error）。
- Windows 端 channel 文件名恒为 `${channel}.yml`，无 arch 后缀（`util.js getChannelFilename`；`updateInfoBuilder.js getArchPrefixForUpdateFile` 仅 Linux 加前缀）。arm64 应用通过 `autoUpdater.channel = "latest-arm64"` 取 arm64 feed；channel setter 会强制 `allowDowngrade = true`（`AppUpdater.js:44`），需显式复位为 `false`。
- `--publish never` 下 electron-builder 仍在 `release/` 本地生成 `latest.yml`（含 sha512、files 列表）与 `*.exe.blockmap`（`PublishManager.js:218` 注释明示「file should be generated regardless of publish state」，task 创建于 `PublishManager.js:158-164` 不看 isPublish）。CI 直接上传生成物，不手工构造。
- `setFeedURL` 只替换 clientPromise，此后 feed 请求不再读盘；但打包内置的 `app-update.yml` 仍被两处隐式依赖：`updaterCacheDirName`（缺失则 downloadUpdate reject，`AppUpdater.js:545`）与 `publisherName`（无签名时跳过校验）。因此 electron-builder.yml 的 `publish` 配置**必须保留**（评审 M-1，加回归测试钉住）。
- yml 内文件名为 basename，GenericProvider 以 feed 基址做相对解析（`new URL(pathname, baseUrl)`）；yml 与 exe 同目录（`releases/{ver}/`）即无需改写内容。
- 取消下载：`CancellationError` 不 dispatch error 事件（`AppUpdater.js downloadUpdate` 的 errorHandler），取消后无残留错误态。
- `quitAndInstall(isSilent, isForceRunAfter)` → NsisUpdater `doInstall` 追加 `/S` 与 `--force-run` 参数。

## 实现

### 主进程 `packages/desktop/electron/updater.ts`

- `downloadUpdate()`（win32，dev 下 no-op）：
  1. 裸拉最新 manifest（不发任何事件的 fetch helper），解析 version + 本平台/架构 downloadUrl；拉取失败或解析为空按下载阶段错误处理。
  2. feed 基址 = downloadUrl 的 dirname；arm64 进程设 `channel = "latest-arm64"` 并复位 `allowDowngrade = false`；`setFeedURL({ provider: "generic", url: 基址 })`。
  3. `await autoUpdater.checkForUpdates()`（autoDownload 已为 false，不会自动开始下载）；校验 feed 版本 === manifest 版本，不一致（半上传/陈旧 yml）与「feed 无更新」分别给出可读的下载阶段错误，避免落到 "Please check update first" 之类的库内部文案。
  4. `autoUpdater.downloadUpdate(new CancellationToken())`。
- `installUpdate()`（win32）：status 非 `downloaded` 时 no-op（评审 m-1，防止 dispatchError "No update filepath provided"）；否则 `autoUpdater.quitAndInstall(true, true)`。
- 守卫：status 已 `downloading`/`downloaded` 时 `downloadUpdate` no-op；silent 检测在 status 为 `downloading`/`downloaded` 时跳过发送 `update-available`（下载中不再弹提醒 toast）。
- 事件转发裁剪：electron-updater 的 `update-available` / `update-not-available`（内部 feed check 的产物）不再转发也不写 currentState——版本发现权归 OSS 检测，避免与弹窗/toast 冲突；仅转发 `download-progress` / `update-downloaded` / `error`，error 一律视为下载阶段（`errorPhase: "download"`），`update-error` 事件增加 `phase: "check" | "download"` 字段。
- `update-available` 事件与 `UpdateState` 增加 `inAppUpdate: boolean`（win32 且 packaged 时 true），renderer 据此分支；`getState()` 恢复时携带。
- Windows 拉取 release notes：`checkForUpdatesViaOss` 的非 silent 检测对 win32 同样 `fetchReleaseNotes`（去掉 darwin/linux 限定）。
- 状态机补充：`downloading`/`downloaded` 状态保留 `version` / `releaseNotes` / `downloadUrl` / `inAppUpdate`；取消下载后状态回到 `available`（保留上述字段），用户可再次发起。
- 保持 electron-updater 默认 console logger 不置 null（评审 m-5 不采纳）：dev 与终端启动时可诊断更新问题，GUI 启动的打包版 stdout 本就不落盘，无噪声成本。

### 主进程 `packages/desktop/electron/main.ts`

- 监听 `before-quit-for-update`（electron-updater 在 `quitAndInstall` 前发出）：置 lifecycle 退出标记 + 走快路径退出（见「评审后补充的决策」）——隧道停止收敛 1s 内，跳过 server 优雅关闭与 30s 看门狗。

### renderer `packages/app`

- `lib/host-bridge.ts`：`UpdateState` 与 `update-available` 事件加 `inAppUpdate?: boolean`；`update-error` 事件加 `phase?: "check" | "download"`。`packages/desktop/electron/types.ts` re-export 同步。
- `use-update-checker.ts`：`UPDATE_AVAILABLE` 透传 `inAppUpdate`；`ERROR` 按 `event.phase`（缺省按现有 downloading 推断）设置 `errorPhase`；`cancelDownload` 改为 `await cancelUpdate()` 后用 `getUpdateState()` + `SET_STATE` 回填（评审 M-3：主进程取消后回 `available`，renderer 不能本地 RESET 回 `idle` 造成两边不一致）。
- `UpdateChecker.tsx`（About）：
  - `available + inAppUpdate`：弹窗主按钮「后台下载」（`acceptDownload`），不再按 `downloadUrl` 分支；`available` 非 in-app：维持「前往下载」`openExternal`。
  - `downloading`：现状（进度条 + 取消），toast 触发的下载同样实时反映。
  - `downloaded`：弹窗主按钮文案改用 `settings.update.installAndRestart`（`acceptRestart` 语义不变，保留「稍后重启」）。
- `UpdateNoticeBridge.tsx`（toast）：
  - silent `update-available + inAppUpdate`：「发现新版本 vX」+ action「后台下载」→ `updater.downloadUpdate()`；非 in-app：维持「去更新」`openExternal`。
  - `update-downloaded`：「更新已下载完成」+ action「安装并重启」→ `updater.installUpdate()`。
  - `update-error + phase=download`：「下载失败」提示 toast（无 action，详情见关于页重试入口）。
  - 时长沿用 10s。

### CI `.github/workflows/build-and-release.yml`

- win build job「Upload Windows installer」：追加上传本 arch 的 `release/*-{arch}.exe.blockmap`；x64 job 上传 `release/latest.yml`，arm64 job 先 `mv` 为 `latest-arm64.yml` 再上传（避免同名 `--clobber` 互踩，与 exe 的 arch 限定同一防回归原则）。
- `publish-oss`：
  - 「Download release assets」增加 pattern：`latest.yml`、`latest-arm64.yml`、`*.blockmap`。
  - 上传改为三段顺序：① 安装包 + blockmap（versioned path，现有循环拆出）→ ② `latest.yml` / `latest-arm64.yml` 到 `releases/{ver}/`（缺失则跳过）→ ③ 生成并上传 `latest.json`。满足「yml 与 json 在所有安装包上传完毕后再上传」，且 json（版本发现闸门）最后翻转。
  - workflow_dispatch 重发旧 tag 无 yml 资产时跳过 yml 上传不硬失败（与 linux 资产可选语义一致）。

### i18n（zh-CN / zh-TW / en）

- `settings.update.backgroundDownload`：后台下载 / Download in Background / 背景下載。
- `settings.update.installAndRestart`：安装并重启 / Install and Restart / 安裝並重新啟動。
- 下载完成 toast 标题复用 `settings.update.downloaded`；下载失败 toast 复用 `settings.update.downloadError`。

### 两套元数据的分工（不变项）

`latest.json` 仍是「发现新版本」的唯一闸门（三平台检测、版本比较、平台 URL 解析、landing 下载页）；`latest.yml` 仅服务 Windows 下载/安装机械层，feed 基址由 manifest 下载 URL 派生。OSS 对象均在 `spherse/releases/` 公有读前缀下，权限模型不变。

## 风险与边界

- **部分上传窗口**：`latest.json` 最后上传，客户端不会被引导去拉尚未就绪的 yml；yml 与 exe 同批 versioned 目录天然一致。feed 版本与 manifest 版本一致性校验兜底。
- **旧版本升级到首个支持版**：本地无 updater 缓存 → 全量下载；此后版本间走 blockmap 增量。
- **arm64 feed 缺失**（manifest 无 `win.arm64` 回退到 x64 URL 的旧清单）：arm64 应用 fetch `latest-arm64.yml` 404 → 下载阶段错误，UI 走「前往官网下载」兜底；现 CI 每版必产 arm64 exe，概率≈0。
- **mac/linux 不回归**：`downloadUpdate`/`installUpdate`/`cancelUpdate` 维持非 win32 no-op；toast/弹窗按钮分支由 `inAppUpdate` 驱动，web 壳无 updater API 不受影响。
- **dev 模式**：检测已短路 upToDate；`downloadUpdate` 增加 `!app.isPackaged` no-op，避免 electron-updater 在 dev 下找 `dev-app-update.yml` 报错。

## 验证

- `packages/desktop/electron/updater.test.ts`：feed 基址派生（x64/arm64/回退矩阵）、`setFeedURL` generic 参数、arm64 channel 切换与 `allowDowngrade` 复位、feed 版本不一致/无更新分别报可读下载错误、electron-updater `update-available`/`update-not-available` 不转发、progress/downloaded/error 转发及 phase 标记、重复 `downloadUpdate` no-op、非 downloaded 状态 `installUpdate` no-op、`installUpdate` → `quitAndInstall(true, true)`、mac/linux no-op 维持、silent 检测在 downloading/downloaded 下抑制、win32 非 silent 检查拉 releaseNotes（**翻转现有「windows checks 不拉 changelog」用例**，评审 m-2）、取消后回到 available、「never calls electron-updater's GitHub feed」守卫改为「下载前显式 setFeedURL generic OSS」语义。
- `packages/desktop/electron/main 退出快路径`：`before-quit-for-update` 置退出标记且 `before-quit` 不再走慢路径（跳过 tunnel/server 优雅关闭）。
- `packages/desktop/release-pipeline.test.ts`：assets download pattern、三段上传顺序（安装包+blockmap → yml → latest.json）、arm64 yml 重命名上传、旧 tag 无 yml 容错。
- `packages/desktop/electron-builder.config.test.ts`：win 上传步骤 blockmap/yml 的 arch 限定断言；`publish` 配置存在性断言（app-update.yml 的 updaterCacheDirName 隐式依赖，评审 M-1）。
- `packages/app`：`UpdateChecker.test.tsx`（in-app 分支按钮与 downloaded 文案、非 in-app 维持）、`UpdateNoticeBridge.test.tsx`（后台下载/安装并重启/下载失败 toast、mac 去更新维持）、`use-update-checker` 透传与取消回填。
- 全量 `npm run verify`；不运行真实升级 E2E（无 Windows CI 环境），发版后首个版本真机验证清单：后台下载→静默安装链路、**一个 per-machine（所有用户）安装实例的更新（UAC 弹窗行为）**、更新退出时隧道子进程收敛情况。

## 文档同步

- `docs/official/architecture/desktop.md`：更新机制段落改写（Windows in-app 恢复、feed 布局、上传顺序）。
- `docs/dev/backlog.md`：删除「恢复 Windows 自动更新 feed（latest.yml，双 arch）」条目（历史文档中的 backlog #149 即指此条）。
- `.agents/skills/release-new-version/SKILL.md`：CI 步骤描述补 latest.yml/blockmap 上传。
