# [infra] App 更新机制

## 背景

当前 Spherse 桌面应用（Electron）没有自动更新能力。用户安装新版本的唯一途径是手动从 GitHub Releases 下载安装包并重新安装。本方案为应用引入「检查更新 + 用户确认 + 自动升级」机制，让用户在设置界面点击「检查更新」即可获得更新推送，同意后自动升级。

### 需求

| 需求 | 优先级 |
|------|--------|
| 用户可在设置界面点击「检查更新」手动触发更新检查 | P0 |
| 检测到新版本时，展示版本号与 release notes，经用户同意后才下载 | P0 |
| 下载完成后，经用户确认重启后才安装 | P0 |
| 全程不自动更新、不静默升级，每个关键步骤都需要用户主动同意 | P0 |
| 应用启动时静默检查一次，仅在发现新版本时才通知用户 | P1 |
| Windows 完整自动更新（下载 → 安装 → 重启） | P0 |
| macOS 检测到新版本并提供下载入口（未签名阶段为通知模式） | P0 |

### 关键决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 分发渠道 | GitHub Releases | 复用现有仓库，零额外基础设施成本，electron-updater 原生支持 |
| 更新库 | electron-updater | electron-builder 官方配套，成熟稳定，与现有打包产物无缝对接 |
| 代码签名 | 暂不签名，先跑通流程 | 当前无证书；Windows 自动更新机制本身不受影响，macOS 降级为通知模式 |
| 检查触发 | 启动静默检查 + 手动按钮 | 兼顾及时性与用户控制感 |
| 发版规则 | Git tag + semver | 与 npm 生态一致，规则简单清晰 |

## 方案选型

对比了三种技术路线：

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. electron-updater（选定）** | electron-builder 官方配套，原生支持 GitHub Releases，delta 增量更新，社区成熟 | 引入 ~150KB runtime 依赖；macOS 未签名时体验受限 |
| B. 自研轻量更新检查器 | 零第三方依赖，全平台行为一致 | 需自研版本比较、下载进度、安装/重启逻辑，维护成本高 |
| C. 纯通知模式 | 最简单，无平台差异 | 体验差，用户每次手动下载安装，违背「自动升级」需求 |

选定 **方案 A（electron-updater）**：与现有 electron-builder 工作流天然契合。Windows 立即获得完整自动更新体验；macOS 在未签名阶段用通知模式兜底，接入签名后同一套代码零改动升级为完整自动更新。

## 更新交互流程

```
应用启动（延迟 5s 静默检查）/ 用户点击「检查更新」
   ↓
autoUpdater.checkForUpdates()（Windows）
GitHub Releases API 版本检查（macOS 通知模式）
   ↓
┌──────────────┬───────────────────┐
│ 已是最新版本  │ 发现新版本         │
│ → 按钮原地    │ → 弹 Dialog：      │
│   显示「已是  │   新版本号         │
│   最新版本」  │   Release notes    │
│              │   [稍后] [立即更新] │
└──────────────┴──────┬────────────┘
                       │ 用户同意
                       ↓
            downloadUpdate() 开始下载
            进度条显示百分比
                       ↓
                 下载完成
                       ↓
        弹窗：「重启以完成安装」
           [稍后重启] [立即重启]
                       ↓ 用户确认
            quitAndInstall()
```

**关键约束**：
- `autoUpdater.autoDownload = false` — 禁止自动下载，必须用户同意
- `autoUpdater.autoInstallOnAppQuit = false` — 禁止退出时自动安装，必须用户确认
- 全程三处用户确认点：同意下载、下载完成通知、同意重启

## 架构

```
┌─────────────────────────────────────────────────────┐
│ Renderer (React)                                    │
│  features/settings/UpdateChecker.tsx                │
│    ├─ useUpdateChecker hook（本地状态 + 调 IPC）     │
│    └─ UI：按钮 / 进度条 / 更新确认弹窗               │
├──── IPC boundary (preload.ts 桥接) ─────────────────┤
│  renderer → main:                                   │
│  app:check-for-updates                              │
│  app:download-update                                │
│  app:install-update                                 │
│  app:cancel-update                                  │
│  app:get-update-state                               │
│                                                     │
│  main → renderer:                                   │
│  app:update-available    { version, releaseNotes }  │
│  app:update-not-available                          │
│  app:download-progress   { percent }                │
│  app:update-downloaded                            │
│  app:update-error        { message }                │
├─────────────────────────────────────────────────────┤
│ Main (Electron)                                     │
│  electron/updater.ts                                │
│    ├─ autoUpdater 配置（autoDownload/autoInstall）   │
│    ├─ checkForUpdates()  → fireUpdateEvent()         │
│    ├─ downloadUpdate()                               │
│    ├─ installUpdate() → quitAndInstall()             │
│    ├─ macOS 通知模式：GitHub Releases API 版本检查   │
│    └─ EventEmitter 转发 autoUpdater 事件给 renderer  │
└─────────────────────────────────────────────────────┘
```

### 组件职责

| 组件 | 位置 | 职责 |
|------|------|------|
| `updater.ts` | `electron/updater.ts` | 封装 `electron-updater`：配置 `autoDownload:false`；把 autoUpdater 原生事件（`update-available`/`download-progress`/`update-downloaded`/`error`/`update-not-available`）转发为 IPC 事件给 renderer；macOS 通知模式下用 GitHub Releases API 检查版本 |
| IPC handlers | `electron/ipc/updater.ts` | 注册 5 个 `ipcMain.handle`：检查/下载/安装/取消/查状态。注册到 `registerAllIpc` |
| preload.ts | `electron/preload.ts` | 新增 5 个 IPC 方法 + 1 个 `onUpdateEvent` 事件监听器注册，桥接 renderer 与 main |
| `useUpdateChecker` | `features/settings/use-update-checker.ts` | hook 管理状态机（idle/checking/upToDate/available/downloading/downloaded/error），调用 IPC，订阅事件 |
| `UpdateChecker.tsx` | `features/settings/UpdateChecker.tsx` | 设置界面「关于/更新」区：检查按钮 + 原地状态文本 + 进度条 + 更新确认弹窗 |
| `electron-api.ts` | `shared/electron-api.ts` | 新增更新相关 IPC 方法与事件类型定义 |

### 状态机

```
idle ──check──→ checking ──no update──→ upToDate（按钮显示「已是最新版本」）
                    │
                    ├──error──→ error ──retry──→ checking
                    │
                    └──found──→ available ──user accept──→ downloading
                                    │                          │
                                    └──user dismiss→ idle      ├──cancel──→ idle
                                                               │
                                                               ├──error──→ error
                                                               │
                                                               └──done──→ downloaded ──user accept──→ installing
                                                                                           → app 重启
```

| 状态 | 按钮显示 | 说明 |
|------|---------|------|
| `idle` | 「检查更新」 | 初始/空闲态 |
| `checking` | 「检查中…」（loading） | 正在请求版本信息 |
| `upToDate` | 「已是最新版本」（灰色禁用） | 无可用更新，原地显示不弹 toast |
| `available` | 弹更新确认窗 | 检测到新版本，展示版本号 + release notes |
| `downloading` | 进度条 + 「取消」按钮 | 下载中，可取消 |
| `downloaded` | 「重启以完成安装」窗 | 下载完成，等待用户确认重启 |
| `error` | 「检查更新失败，请稍后重试」+ 重试按钮 | 网络/下载错误 |

## 平台差异处理

未签名阶段，Windows 与 macOS 采用不同路径：

| 平台 | 未签名阶段行为 | 实现方式 | 签名后 |
|------|---------------|---------|--------|
| **Windows** | 完整自动更新（下载 .exe → 静默安装 → 重启） | CI 上传 `latest.yml` + `.exe` 到 Release，electron-updater 完整流程 | 不变（SmartScreen 警告消失） |
| **macOS** | **通知模式**：检测到更新 → 弹窗展示版本 + release notes + GitHub Releases 链接，用户手动下载安装 | CI 只为 Windows 上传 `latest.yml`；macOS 端 `updater.ts` 走 GitHub Releases API 轻量检查版本，检测到新版本后通过 IPC 让 renderer 弹「发现新版本」窗 | CI 增加 mac zip + `latest-mac.yml` 上传，移除通知模式分支，同一套 renderer UI 自动切换为完整流程 |

**macOS 通知模式设计**：
- `updater.ts` 封装 `checkForUpdatesMacFallback()`：调用 `GET https://api.github.com/repos/mengrru/Spherse/releases/latest`，解析 `tag_name`（去 `v` 前缀）与当前 `app.getVersion()` 比较
- 检测到新版本后，通过 IPC `app:update-available` 发送 `{ version, releaseNotes, downloadUrl }`，其中 `downloadUrl` 指向 GitHub Release 页面
- renderer 弹窗展示 release notes + 「前往下载」按钮（`shell.openExternal` 打开 releases 页面），不出现下载进度/重启流程
- 签名后：CI 增加 macOS artifact 上传，`updater.ts` 移除 mac fallback 分支，统一走 `autoUpdater.checkForUpdates()`

## 配置

### electron-builder.yml

新增 `publish` 配置，electron-builder 打包时据此生成 `app-update.yml`（内含 GitHub repo 信息）：

```yaml
publish:
  provider: github
  owner: mengrru
  repo: Spherse
```

### updater.ts 运行时配置

```typescript
import { autoUpdater } from "electron-updater";

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
```

GitHub provider 信息由 electron-builder 打包时生成的 `resources/app-update.yml` 注入，运行时无需额外配置。

## 发版流程（Git tag + semver）

```
开发者本地：
  1. 更新 packages/app/package.json 的 version（如 0.1.0 → 0.1.1）
  2. git tag v0.1.1 && git push origin v0.1.1

CI（GitHub Actions）：
  3. tag push 触发 .github/workflows/build-and-release.yml
  4. setup-node → npm ci → npm run build
  5. electron-builder --publish always
     ├─ 构建 .dmg / .exe
     ├─ Windows：上传 latest.yml + .exe 到 GitHub Release（electron-updater 读）
     └─ macOS：.dmg 归档到 Release（供手动下载，不上传 latest-mac.yml）
  6. GH_TOKEN secret 认证上传

用户端：
  7. 下次启动 app / 手动检查 → 发现新版本 → 用户确认 → 下载安装
```

### CI workflow 要点（`.github/workflows/build-and-release.yml`）

- 触发：`on.push.tags: ['v*']`
- Secrets：`GH_TOKEN`（GitHub Personal Access Token，需 `repo` 权限以创建 Release 和上传 assets）
- 构建矩阵：`macos-latest` + `windows-latest`（并行）
- 核心步骤：`electron-builder --publish always`（electron-builder 自动根据 `electron-builder.yml` 的 `publish` 配置上传到 GitHub Releases）

### 版本号规则

遵循 [semver](https://semver.org/lang/zh-CN/)：
- `MAJOR.MINOR.PATCH`（如 `0.1.0`）
- git tag 格式：`v{version}`（如 `v0.1.1`）
- electron-updater 自动按 semver 比较版本号判断是否有更新

## 启动时自动检查

`main.ts` 在 `app.whenReady()` 完成后延迟 ~5s 静默检查：

```typescript
app.whenReady().then(async () => {
  // ...现有初始化...
  setTimeout(() => { void checkForUpdates({ silent: true }); }, 5000);
});
```

- 静默检查仅在发现新版本时才通过 IPC 事件触发 renderer 弹窗（复用手动检查的 `available` 状态流程）
- 静默检查的网络错误不弹窗，静默忽略
- dev 模式（`!app.isPackaged`）跳过自动检查

## 错误处理

| 场景 | 处理 |
|------|------|
| 网络不可达 / GitHub 超时 | `error` 事件 → 手动检查时 UI 原地显示「检查更新失败，请稍后重试」+ 重试按钮；静默检查时静默忽略 |
| 下载中断 | `error` 事件 → UI 显示「下载失败」+ 重试按钮 |
| 用户拒绝下载/重启 | 回到 `idle` 状态，不强制 |
| 版本相同 | `update-not-available` 事件 → 按钮原地显示「已是最新版本」（不弹 toast） |
| dev 模式 | `updater.ts` 直接返回 `{ status: 'upToDate', reason: 'dev' }`，不调用 autoUpdater，UI 显示「已是最新版本」兜底 |

## 文件变更清单

### 新增

| 文件 | 说明 |
|------|------|
| `packages/app/electron/updater.ts` | electron-updater 封装，事件转发，macOS 通知模式 fallback |
| `packages/app/electron/ipc/updater.ts` | 更新相关 IPC handler 注册 |
| `packages/app/src/features/settings/UpdateChecker.tsx` | 设置界面「关于/更新」区组件 |
| `packages/app/src/features/settings/use-update-checker.ts` | 更新状态管理 hook |
| `.github/workflows/build-and-release.yml` | tag 触发的构建+发布 CI |

### 修改

| 文件 | 变更 |
|------|------|
| `packages/app/package.json` | 新增 `electron-updater` 依赖 |
| `packages/app/electron-builder.yml` | 新增 `publish` 配置 |
| `packages/app/electron/main.ts` | 启动后延迟自动检查 |
| `packages/app/electron/ipc/index.ts` | `registerAllIpc` 注册 updater IPC |
| `packages/app/electron/preload.ts` | 新增更新相关 IPC 方法 + 事件监听 |
| `packages/app/shared/electron-api.ts` | 新增更新相关类型定义 |
| `packages/app/src/features/settings/index.tsx` | 设置 dialog 新增「关于」tab，嵌入 `UpdateChecker` |

### 无需修改

- `packages/core` / `packages/server` / `packages/presets` / `packages/i18n` — 更新机制完全在 app 层，不涉及核心逻辑

## 后续演进

- **接入代码签名后**：CI 增加 macOS artifact（zip + `latest-mac.yml`）上传；`updater.ts` 移除 macOS fallback 分支，统一走 `autoUpdater`；renderer UI 无需改动
- **多渠道分发（beta/stable）**：GitHub Releases 支持 prerelease 标记，未来可扩展设置项让用户选择更新通道
- **强制更新**：在 release notes 中标记 `breaking` 等关键字时，未来可支持「必须更新才能继续使用」的强制流程

## 验证方式

1. dev 模式下点击「检查更新」，确认按钮原地显示「已是最新版本」
2. 发布一个测试版本到 GitHub Releases，运行旧版本 app，确认手动检查能检测到新版本
3. 确认新版本弹窗展示版本号 + release notes
4. Windows 上确认：同意下载 → 进度条 → 下载完成 → 同意重启 → 升级到新版本
5. macOS 上确认：检测到新版本 → 弹窗展示 GitHub Releases 链接 → 点击跳转下载页
6. 确认网络断开时手动检查显示「检查更新失败，请稍后重试」
