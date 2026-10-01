# Desktop（Electron）层架构

> 覆盖：main 进程结构与启动、关闭至托盘、IPC 面、settings 持久化与模型/采样配置传播、mobile access / tunnel、app 更新与 debug 工具。
> server 生命周期（ensureServer / registry）见 [server.md](server.md)；HostBridge 抽象与 renderer 消费见 [frontend.md](frontend.md)。
> 打包与 CI 细节见 `.github/workflows/build-and-release.yml` 与 `electron-builder.yml`，本文只述要点。

## 进程结构与启动

- 入口 `electron/bootstrap.ts`：dev（`!app.isPackaged` 且非 test）将 userData 重定向 `Spherse-Dev/`
  - dev 与 prod 的 electron-store / localStorage 完全隔离，可同时运行
  - E2E 由 Playwright 传 `--user-data-dir` + `NODE_ENV=test` 跳过重定向
  - 随后 `requestSingleInstanceLock()`（按 userData 区分，须在重定向之后）：未拿到锁 `app.exit(0)` 且不加载 main；主实例 `second-instance` 唤回主窗口
- `app.whenReady` 顺序：`fixPath` → `restoreEnvFromSettings` → `ensureServer()`（恒带 server token）→ 创建窗口与右键菜单、挂关闭至托盘拦截 → 注册全部 IPC → `syncTray()` → quick 模式启动 tunnel；更新检查另以 `setTimeout` 5s 调度，与 tunnel 无先后依赖
- BrowserWindow：1200×800、`contextIsolation: true`、`nodeIntegration: false`、preload 白名单桥
- `fixPath` 仅 packaged + darwin/linux：spawn 登录 shell 取 `$PATH` 去重合并，保证 GUI 启动拿到 CLI 环境
- 优雅退出：`electron/lifecycle.ts` 协调普通退出与更新安装，首个请求独占终结动作，其余请求共享清理 Promise；tunnel stop → `stopServer()` 完成前 `before-quit` 始终阻止退出，窗口关闭与唤回用 `isQuitting()` 判断。清理后普通退出调用 quit，安装路径先检查缓存安装包可读，再启动安装器；清理或可检测的交接失败走普通重启恢复。30s watchdog 兜底，`will-quit` 销毁托盘；`stopServer` / `restartServer` 委托 `MultiProjectServer.close()`（注入 10s 阶段超时与日志回调）

## 关闭至托盘

`electron/tray.ts`，由 `AppSettings.closeToTray`（缺省 true；未打包且非 `NODE_ENV=test` 的 dev 运行缺省 false）控制：

- 托盘在开关启用期间常驻，启动与每次 `save-settings` 后 `syncTray()` 创建 / 销毁并按 locale 重建菜单（「打开 Spherse」「退出」）；左键 `click` 唤回窗口；macOS 用 `right-click` → `popUpContextMenu`（避免左键也弹菜单），Windows / Linux 用 `setContextMenu`
- 主窗口 `close`：`isQuitting()` 放行；已收至托盘的窗口再收到 close（安装器 `taskkill` 等非用户操作）→ `app.quit()` 优雅退出；开关启用 → 阻止并隐藏（全屏先退出全屏），macOS 同时 `app.dock.hide()`；开关关闭 → 放行，走 `window-all-closed` 退出（含 macOS）
- 唤回（托盘 / macOS `activate` / `second-instance`）：macOS 先 `await app.dock.show()`，再 restore / show / focus；退出中或窗口已销毁时 no-op
- 图标 `resources/tray/`（macOS `trayTemplate*.png` 模板图，其余 `tray*.png`），打包经 `extraResources` 落 `process.resourcesPath/tray`

## IPC 面

`electron/ipc/` 六域全为 `ipcMain.handle` invoke 模式；事件流为 updater（含 `update-state` 快照）与 `mobile-access:event`；context-menu 不走 IPC，是 main 监听 `webContents` 的 context-menu 事件后在可编辑目标弹 `Menu.popup`：

| 域 | channel 概要 |
|---|---|
| project | 目录选择、项目打开/关闭/恢复（`restore-projects` 重注册已打开项目）、lastActive、`get-server-port`、`open-project-folder`、`open-file`（校验在已打开项目内）、`open-external`（仅 http/https/mailto/tel）、save dialog |
| settings | get/save（save 后 `syncTray()`）、文本与图片 provider 目录 |
| debug | is-dev、DevTools 开关、electron-store 查看、reload renderer、reset app data |
| skill | zip 文件选择（本地安装用） |
| updater | check / download / install / cancel / get-state / get-version |
| mobile | mobile-access 的 get-state / enable / disable / regenerate-token / restart-tunnel / set-mode / set-public-domain |

- preload 经 `contextBridge` 暴露 `window.electronAPI`（类型即 `ElectronAPI`），renderer 由 `createElectronHostBridge()` 包装为 HostBridge
- mobile 域变更经 `mutationChain` 串行化防并发

## settings 持久化

- electron-store 落 userData 下 `settings.json`；`AppSettings` schema：
  - `locale` + `models: { text, image }`——每 group 含 `defaultModel`、per-provider `apiKey`，text 另含可选 `sampling` 与 `thinkingLevel`（off/low/medium/high，缺省 medium）
  - 可选 `customProviders` / `debugToolsEnabled` / `tabsEnabled`（缺省 true） / `closeToTray`（缺省 true，dev 运行 false） / `theme` / `mobileAccess`
- **serverToken 是 settingsStore 顶层 key，不是 AppSettings 字段**（`saveSettings` 会从零重建 AppSettings）。`getServerToken()` 迁移链：`serverToken` → legacy `mobileAccess.token` → 生成并持久化；它是 server 鉴权唯一凭据来源（见 [server.md](server.md)「鉴权模型」）
- **API key 掩码与合并**：显示前 4 + `****` + 后 4；保存时空串跳过、含 `****` 保留旧值
  - `saveSettings` 强制保留 `mobileAccess` 旧值，防 renderer 覆写
- `applySettingsToEnv`（保存后立即执行）：
  - `applyThemeSource` → 文本 provider key 按 `PROVIDER_ENV_KEYS` 映射 env（记录首次覆写前的原值；key 从设置中移除后恢复原值或删除 env，共享 env 名的 provider 仍有 key 时保留）→ 图片写 `SPHERSE_IMAGE_MODEL` / `SPHERSE_IMAGE_API_KEY`
  - 末尾 `syncCustomProviders`（core 删除消失项 + `setProvider` 重建，原样使用 def.id；`custom-` 前缀由 renderer 创建供应商时生成）
- 启动时 `restoreEnvFromSettings` 在 `ensureServer` 之前——custom provider 注册先于 server 捕获同一 catalog 单例

## 模型与采样配置传播

- save-settings 链：`if (defaultModel)` 才 `updateDefaultModel()`；`updateSampling()` / `updateThinkingLevel()` 无条件（undefined 即「恢复默认」需要传播）→ registry fan-out 各项目并缓存供后续 register → `SessionManager`
- 热替换：`setDefaultModel` 遍历活跃会话，仅在解析结果变化时重赋 `agent.state.model`（下一轮生效）；未配置的 agent 跳过不抛错；profile 显式指定 `model` 者优先，但所选模型已不可解析（过期）时回退全局默认（`model-resolver` 按候选序尝试）
- `setThinkingLevel` 重赋各 agent 的 `state.thinkingLevel`（下一轮生效），profile `thinkingLevel` 覆盖全局值（见 [`../data-conventions.md`](../data-conventions.md)「Agent 定义」）；`off` 即关闭思考，实际档位由 pi-ai 按模型 `clampThinkingLevel` 就近取档（不支持推理的模型忽略）
- `setSampling` 重赋各 agent 的 `streamFn`；注入点 `getChatStreamFn`：
  - `temperature` 走 pi-ai typed 字段直接进 options
  - `topP` 经 `onPayload` 按 `model.api` 分支——openai 系 / anthropic 根级 `top_p`，google 走 `config.topP`，未知 no-op
- 模型解析延迟到 send 路径：无模型时可打开会话存活，`sendMessage` 前 `ensureModel` 抛 `ModelNotConfiguredError`
  - 转为 `MODEL_NOT_CONFIGURED` error 事件，不关连接；空串 model 在 profile 解析层即归一为未配置
- 已知边界：清空 defaultModel 后运行时旧默认保留至重启（`if` 守卫 + registry 缓存）
- **provider catalog**：core `ModelCatalog` 类实例由 desktop `getAppModelCatalog()` 持有单例，经 `CreateServerOptions` 注入 server；文本 17 个内置 provider，图片 3 家（openrouter / zhipu / openai）

## 外观模式

`AppSettings.theme`（light / dark / system，默认 system）：启动 `restoreEnvFromSettings` 与每次保存时设 `nativeTheme.themeSource`——renderer 的 `prefers-color-scheme` 媒体查询与 `dark:` 工具类据此跟随应用选择。

## mobile access / tunnel

- 两模式：`quick`（Cloudflare Quick Tunnel，免域名）/ `manual`（自建公网域名，不做隧道只提供 URL）
- `CloudflareTunnelProvider`：spawn `cloudflared tunnel --no-autoupdate --url ...`，stdout / stderr 正则抓 `*.trycloudflare.com`，30s 启动超时；stop 为 SIGTERM → 3s → SIGKILL；`TunnelManager` 以 promise 防重入
- 二进制解析三级：packaged 先找 `resources/cloudflared/<platform-arch>/`，再各平台常见安装位置，最后 PATH 裸命令（spawn env 附带常见 PATH 目录）——**安装包未内置 cloudflared**，缺失时给安装引导
- token：`randomBytes(32)` hex，即 server 鉴权的 always-on token（存 settingsStore 顶层 `serverToken`）；仅 regenerate 轮换（`setServerToken` → `restartServer` 重建 server 并重放项目与动态 host）；enable / set-mode 不生成或轮换 token
- 动态 host：`syncAllowedHosts()` 按当前 mobileAccess 状态计算期望集（enabled + quick → tunnel publicUrl；manual → publicDomain）重放到 server 实例；每次 `ensureServer()` 后必重放，tunnel `onStateChange` 与 mobile 各 handler 增量同步
- renderer 侧 MobileAccessPanel 提供 deeplink + 二维码（`.../web/#/?base=<url>&token=<t>`）；本地 dev 客户端（electron-vite dev，`import.meta.env.MODE === "development"`）指向 dev 环境 `.../dev/web/#/?...`，打包构建恒指 prod

## App 更新机制

- **Windows** 使用 electron-updater generic provider，按应用 `process.arch` 读取 OSS `spherse/win/x64/latest.yml` 或 `spherse/win/arm64/latest.yml`。`autoDownload` / `autoInstallOnAppQuit` 关闭，禁用差量下载；用户点击「后台下载」才下载全量 NSIS 包，完成后点击「安装并重启」执行 `quitAndInstall(true, true)`。选择与取舍见 [ADR-0015](../../dev/decisions/0015-windows-oss-updates.md)。
- **macOS/Linux** 保留 OSS `latest.json` + `compareVersions` 检测，事件携带 `downloadUrl`，经 `openExternal` 浏览器下载；没有链接时回退官网，不使用应用内安装。手动检查发现新版后读取同源 `changelog.json`，精确匹配目标版本（trim 与可选 v 前缀归一），将 notes.text 转义为列表并同时写入状态与事件的 releaseNotes；3 秒超时覆盖请求和响应体，失败/无匹配/空日志隐藏日志区，不影响下载。静默、Windows、无新版不请求日志；过期手动结果不得覆盖较新的手动检查。日志链接通过 host bridge 在系统浏览器打开。
- 自动检测：启动 5s 后首查，之后每小时 tick、距上次 ≥24h 且系统空闲 ≤5min 时检查。静默检查无新版/失败不通知；Windows 发现新版保存 available 状态并发通知，非 Windows 静默检测不改交互状态。Windows 并发检查合并，手动请求提升通知优先级；外部更新保留独立请求及手动请求序号保护，静默检查不使待完成的手动日志失效。下载、已下载与安装期间不再检查覆盖状态；dev 模式手动检查直接 upToDate。
- Windows `update-state` 是主进程权威状态快照，广播到窗口；`update-available` 只表达发现新版通知。状态为 idle / checking / upToDate / available / downloading / downloaded / installing / error，`updateMode` 区分 inApp/external，`errorPhase` 区分 check/download/install。下载单飞，取消等待任务结束后恢复 available；失败保留重试信息；安装只接受 downloaded。
- 全局 `UpdateNoticeBridge` 的 Windows 自动提醒操作为「后台下载」，下载完成 toast 为「下载成功」+「安装并重启」；关于页提供同一下载/进度/取消/安装操作，不弹下载完成模态框。状态属于主进程，关设置页不取消下载；重新挂载恢复状态，迟到快照不得覆盖新事件。非 Windows 保留发现新版弹窗与外链 toast。
- CI 并行构建 mac（arm64/x64）、win（x64/arm64）与 Linux（x64 AppImage + deb），统一 `--publish never`，三平台可执行文件名固定为 `Spherse`。所有 GitHub 安装包上传结束后，`publish-oss` 调用 `scripts/publish-release.mjs` 上传全部安装包，随后才统一生成两份 YAML 与 JSON；先发布 YAML，最后 JSON。存储格式见 [数据约定](../data-conventions.md#发布更新清单)。多个清单对象不承诺原子切换，但引用的包必须已上传成功。
- stable 发布任务共用 concurrency 队列（最多 100 个等待任务），检查三份线上元数据拒绝版本倒退；同版本重试不得改变已有 feed 引用的 EXE 哈希/大小。正常 tag 与手动重发均要求完整产物；只有历史 release 可显式启用 `historical_assets`，省略缺失 ARM64/Linux，且不发布缺失架构的 feed。不得用历史模式绕过仍在构建的新 release 完整性检查。
- `publish-changelog` 在 OSS 清单更新成功后全量重建 `changelog.json`，末尾联动 web 部署。旧版客户端需先手动安装一次支持此协议的版本；真实 Windows NSIS 升级验收要求见 [测试体系](../testing.md)。

## debug 工具

- 入口门控 `isDev || debugToolsEnabled`（activity bar Bug 图标，生产用户在设置开启）
- 菜单项：DevTools / Reload / App Data（store JSON 弹窗）/ Streaming Log / Turn Context（弹窗查看器）/ Reset
- Streaming Log 经统一 bus 的 `debug` 通道订阅（1000 行环形缓冲，支持暂停/清空/自动滚动）
- Turn Context 弹窗展示完整 session 事件日志（每条标注类型、可展开完整 JSON、一键复制、按类型搜索、可刷新），头部按钮下载**当前 turn 的 context**
- Turn Context 导出的是 **LLM 投影后的真实请求上下文**（`convertToLlm` + `previewTransforms`，即 fold 之后下次会喂给模型的内容），非原始消息 buffer
