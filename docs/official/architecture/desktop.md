# Desktop（Electron）层架构

> 覆盖：main 进程结构与启动、IPC 面、settings 持久化与模型/采样配置传播、mobile access / tunnel、app 更新与 debug 工具。
> server 生命周期（ensureServer / registry）见 [server.md](server.md)；HostBridge 抽象与 renderer 消费见 [frontend.md](frontend.md)。
> 打包与 CI 细节见 `.github/workflows/build-and-release.yml` 与 `electron-builder.yml`，本文只述要点。

## 进程结构与启动

- 入口 `electron/bootstrap.ts`：dev（`!app.isPackaged` 且非 test）将 userData 重定向 `Spherse-Dev/`
  - dev 与 prod 的 electron-store / localStorage 完全隔离，可同时运行
  - E2E 由 Playwright 传 `--user-data-dir` + `NODE_ENV=test` 跳过重定向
- `app.whenReady` 顺序：`fixPath` → `restoreEnvFromSettings` → manual 模式无 token 则生成 → `ensureServer()` → 创建窗口与右键菜单 → 注册全部 IPC → quick 模式启动 tunnel；更新检查另以 `setTimeout` 5s 调度，与 tunnel 无先后依赖
- BrowserWindow：1200×800、`contextIsolation: true`、`nodeIntegration: false`、preload 白名单桥
- `fixPath` 仅 packaged + darwin/linux：spawn 登录 shell 取 `$PATH` 去重合并，保证 GUI 启动拿到 CLI 环境
- 优雅退出：`window-all-closed` / `before-quit`（幂等标记）→ tunnel stop → `stopServer()` → quit

## IPC 面

`electron/ipc/` 六域全为 `ipcMain.handle` invoke 模式；事件流仅两条（updater 五事件、`mobile-access:event`）；context-menu 不走 IPC，是 main 监听 `webContents` 的 context-menu 事件后在可编辑目标弹 `Menu.popup`：

| 域 | channel 概要 |
|---|---|
| project | 目录选择、项目打开/关闭/恢复（`restore-projects` 重注册已打开项目）、lastActive、`get-server-port`、`open-project-folder`、`open-file`（校验在已打开项目内）、`open-external`（仅 http/https/mailto/tel）、save dialog、示例项目 |
| settings | get/save、文本与图片 provider 目录 |
| debug | is-dev、DevTools 开关、electron-store 查看、reload renderer、reset app data |
| skill | zip 文件选择（本地安装用） |
| updater | check / download / install / cancel / get-state / get-version |
| mobile | mobile-access 的 get-state / enable / disable / regenerate-token / restart-tunnel / set-mode / set-public-domain |

- preload 经 `contextBridge` 暴露 `window.electronAPI`（类型即 `ElectronAPI`），renderer 由 `createElectronHostBridge()` 包装为 HostBridge
- mobile 域变更经 `mutationChain` 串行化防并发

## settings 持久化

- electron-store 落 userData 下 `settings.json`；`AppSettings` schema：
  - `locale` + `models: { text, image }`——每 group 含 `defaultModel`、per-provider `apiKey`，text 另含可选 `sampling`
  - 可选 `customProviders` / `debugToolsEnabled` / `theme` / `mobileAccess`
- **API key 掩码与合并**：显示前 4 + `****` + 后 4；保存时空串跳过、含 `****` 保留旧值
  - `saveSettings` 强制保留 `mobileAccess` 旧值，防 renderer 覆写
- `applySettingsToEnv`（保存后立即执行）：
  - `applyThemeSource` → 文本 provider key 按 `PROVIDER_ENV_KEYS` 映射 env → 图片写 `SPHERSE_IMAGE_MODEL` / `SPHERSE_IMAGE_API_KEY`
  - 末尾 `syncCustomProviders`（core 删除消失项 + `setProvider` 重建，原样使用 def.id；`custom-` 前缀由 renderer 创建供应商时生成）
- 启动时 `restoreEnvFromSettings` 在 `ensureServer` 之前——custom provider 注册先于 server 捕获同一 catalog 单例

## 模型与采样配置传播

- save-settings 链：`if (defaultModel)` 才 `updateDefaultModel()`；`updateSampling()` 无条件（undefined 即「恢复 provider 默认」需要传播）→ registry fan-out 各项目并缓存供后续 register → `SessionManager`
- 热替换：`setDefaultModel` 遍历活跃会话，仅在解析结果变化时重赋 `agent.state.model`（下一轮生效）；未配置的 agent 跳过不抛错；profile 显式指定 `model` 者不受全局默认影响
- `setSampling` 重赋各 agent 的 `streamFn`；注入点 `getChatStreamFn`：
  - `temperature` 走 pi-ai typed 字段直接进 options
  - `topP` 经 `onPayload` 按 `model.api` 分支——openai 系 / anthropic 根级 `top_p`，google 走 `config.topP`，未知 no-op
- 模型解析延迟到 send 路径：无模型时可打开会话存活，`sendMessage` 前 `ensureModel` 抛 `ModelNotConfiguredError`
  - 转为 `MODEL_NOT_CONFIGURED` error 事件，不关连接；`resolveEffectiveModelId` 用 `||` 语义（空串视为未配置）
- 已知边界：清空 defaultModel 后运行时旧默认保留至重启（`if` 守卫 + registry 缓存）
- **provider catalog**：core `ModelCatalog` 类实例由 desktop `getAppModelCatalog()` 持有单例，经 `CreateServerOptions` 注入 server；文本 17 个内置 provider，图片 3 家（openrouter / zhipu / openai）

## 外观模式

`AppSettings.theme`（light / dark / system，默认 system）：启动 `restoreEnvFromSettings` 与每次保存时设 `nativeTheme.themeSource`——renderer 的 `prefers-color-scheme` 媒体查询与 `dark:` 工具类据此跟随应用选择。

## mobile access / tunnel

- 两模式：`quick`（Cloudflare Quick Tunnel，免域名）/ `manual`（自建公网域名，不做隧道只提供 URL）
- `CloudflareTunnelProvider`：spawn `cloudflared tunnel --no-autoupdate --url ...`，stdout / stderr 正则抓 `*.trycloudflare.com`，30s 启动超时；stop 为 SIGTERM → 3s → SIGKILL；`TunnelManager` 以 promise 防重入
- 二进制解析三级：packaged 先找 `resources/cloudflared/<platform-arch>/`，再各平台常见安装位置，最后 PATH 裸命令（spawn env 附带常见 PATH 目录）——**安装包未内置 cloudflared**，缺失时给安装引导
- token：`randomBytes(32)` hex；生成于启动（manual 无 token）、enable、regenerate、set-mode 切 manual 且无 token；换 token 必 `restartServerWithAuth` 重建 server 并重放项目
- renderer 侧 MobileAccessPanel 提供 deeplink + 二维码（`.../web/#/?base=<url>&token=<t>`）

## App 更新机制

- **检测源统一为 OSS 清单**（mac/win 同路径）：`latest.json` 的 `compareVersions` 版本比较，downloadUrl 随事件下发、经 `openExternal` 引导浏览器下载；release notes 恒空由 UI 隐藏
- `autoDownload` / `autoInstallOnAppQuit` 均关闭，全程用户主动；`startAutoUpdateChecks` 调度自动检测：启动 5s 后首查，之后每小时 tick、距上次 ≥24h 且系统空闲 <5min（用户活动期间）才静默检测；silent 检测不改写主进程交互状态（不污染 settings 挂载恢复），`update-available` 事件携带 `silent` 标志且不被抑制，`update-not-available` / `error` 静默吞掉
- in-app 下载/安装仅 Windows 保留（CancellationToken 完整流程），darwin 直接 no-op；dev 模式直接 upToDate
- IPC 契约以事件流为唯一真相源：invoke 返回 void / state，`webContents.send` 推 5 个事件
  - renderer `useUpdateChecker` 用 `useReducer` 状态机：idle / checking / upToDate / available / downloading / downloaded / error（`errorPhase` 区分检查与下载失败）；挂载恢复只保留 available/downloading/downloaded，终态归位 idle（重开 settings 按钮恢复可点击）；忽略 silent `update-available`（避免与 toast 双弹）
  - 全局 `UpdateNoticeBridge`（App 根挂载）消费 silent `update-available`：右下角 toast「去更新」→ `openExternal` 平台下载链接（缺失回退官网），至多每天一条
- CI：git tag 触发，mac（arm64/x64）与 win（x64/arm64 交叉）并行 `--publish never` 构建，`gh release upload` 后 `publish-oss` 汇总上传并生成 `latest.json`，末尾联动部署 web 版

## debug 工具

- 入口门控 `isDev || debugToolsEnabled`（activity bar Bug 图标，生产用户在设置开启）
- 菜单项：DevTools / Reload / App Data（store JSON 弹窗）/ Streaming Log / Turn Context 下载 / Reset
- Streaming Log 经统一 bus 的 `debug` 通道订阅（1000 行环形缓冲，支持暂停/清空/自动滚动）
- Turn Context 导出的是 **LLM 投影后的真实请求上下文**（`convertToLlm` + `previewTransforms`），非原始消息 buffer
