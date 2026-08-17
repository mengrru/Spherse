# App 新版本检测切换 OSS 镜像源

- 日期：2026-08-17
- 状态：Proposed
- 关联：`docs/dev/infra/2026-07-27-release-oss-mirror/design.md`（OSS 镜像与 latest.json 清单）、backlog #149（恢复 Windows 自动更新 feed，本设计不解决、继续保留为 follow-up）、`docs/dev/infra/2026-07-03-app-update-mechanism/design.md`（原始更新机制）

## 背景

用户反馈「app 内检查更新总是失败」。代码级根因：

| 平台 | 当前检测链路 | 失败原因 |
|---|---|---|
| macOS | `updater.ts` `checkForUpdatesMacFallback()`：fetch `https://api.github.com/repos/mengrru/Spherse/releases/latest` | GitHub API 在国内网络不可达，检测必然失败 |
| Windows | `autoUpdater.checkForUpdates()`（electron-updater，GitHub provider） | ① GitHub 国内不可达；② 自 ba8c049 起 CI 统一 `--publish never` + `gh release upload`，GitHub Release 上不存在 `latest.yml`，feed 请求必然 404（backlog #149 已记录） |

两平台检测都硬依赖 GitHub，而目标用户主要在国内网络环境。

**Windows in-app 自动更新从未实际生效**（作者确认）。考古 CI 历史：初版 pipeline（3d659a6）Windows 曾 `--publish always`（会上传 latest.yml），但随后的 pipeline 重构（fd86e0e/edbd11b「infra(release): update release pipeline」）起两平台统一改为 `--publish never` + `gh release upload`，`latest.yml` 不再上传至今；叠加 GitHub 国内不可达，electron-updater 的 in-app 下载/安装链路（`downloading`/`downloaded` 状态）从未对用户产生过实际价值。

同时仓库已有现成资产：CI `publish-oss` job（`build-and-release.yml`）每次发版自动将安装包上传至 Aliyun OSS 并生成稳定清单 `https://mengru-open-source.oss-cn-beijing.aliyuncs.com/spherse/latest.json`：

```json
{
  "version": "0.1.19",
  "mac": { "arm64": "<dmg url>", "intel": "<dmg url>" },
  "win": { "x64": "<exe url>", "arm64": "<exe url>" }
}
```

（`win.arm64` 为可选键；更早版本清单曾用 `win.setup` 表示 x64 包。）landing page 已通过 `resolveDownloadUrl` 消费该清单，脱离 GitHub API。

UI 侧（`UpdateChecker.tsx`）已天然支持 `downloadUrl` 模式：`available` 状态携带 `downloadUrl` 时弹窗显示「前往下载」按钮 → `bridge.openExternal(url)` 引导浏览器下载；`releaseNotes` 为空时 notes 区块自动隐藏。**切换检测源到 OSS 后 UI 侧零改动。**

## 方案

### 方案选型

**方案 A（采纳）：统一轻量自研检测，全部平台走 OSS 清单 + 引导浏览器下载。**

- `updater.ts` 新增统一检测函数 `checkForUpdatesViaOss()`，macOS 与 Windows 的 `checkForUpdates` 都走它。
- 删除 `checkForUpdatesMacFallback()`（GitHub API）与 Windows 的 `autoUpdater.checkForUpdates()` 调用。
- 检测到新版本时按平台 + `process.arch` 从清单选取安装包 OSS 直链，作为 `downloadUrl` 下发，UI 复用现有「前往下载」流程（openExternal → 浏览器下载 dmg/exe → 用户手动安装）。
- 不删除 electron-updater 依赖与 in-app 下载链路（`downloadUpdate`/`installUpdate`/`cancelUpdate` 及 UI 的 `downloading`/`downloaded` 状态保留）：方案 A 下这些路径不再被触发（available 总是带 `downloadUrl`，UI 只渲染「前往下载」按钮），但保留代码可为未来恢复 electron-updater feed（backlog #149）低门槛起死回生。

否决 **方案 B**（CI 生成 electron-updater 兼容 `latest.yml`/`latest-arm64.yml` + `setFeedURL` 指向 OSS，保留 Windows 全自动更新）：需处理双 arch channel 文件语义、sha512、文件名映射，且 OSS 清单格式与 electron-updater 元数据是两套体系，改动面大；NSIS 本就 `oneClick: false` 需用户交互，in-app 下载收益有限。该课题与 backlog #149 合并留作后续演进。

### 核心逻辑

```
OSS_UPDATE_MANIFEST_URL = "https://mengru-open-source.oss-cn-beijing.aliyuncs.com/spherse/latest.json"

checkForUpdates(opts):
  if (!app.isPackaged) → upToDate（dev 行为不变）
  silent = opts.silent
  fetch(OSS_UPDATE_MANIFEST_URL)          # Electron 主进程 Node fetch，无 CORS 限制
  if (!res.ok) → error
  manifest = json 解析（version/mac/win）
  if (compareVersions(manifest.version, app.getVersion()) <= 0) → upToDate（silent 吞掉事件，行为不变）
  → available：
    version = manifest.version
    releaseNotes = ""（清单无 notes，UI 自动隐藏）
    downloadUrl =
      darwin: process.arch === "arm64" ? mac.arm64 : mac.intel
              # 缺键时互为回退（Rosetta 2 可跑 intel 包）；全缺 → undefined → UI 回退 in-app 分支
      win32:  process.arch === "arm64" ? (win.arm64 ?? win.x64 ?? win.setup)
                                       : (win.x64 ?? win.setup)
              # 旧清单 win.setup 兼容回退；x64 包在 ARM64 Windows 可模拟运行（与 landing 语义一致）
    sendEvent("update-available", …)
  catch → error（silent 吞掉）
```

### 附带修正

- `UpdateChecker.tsx` error 状态的「前往 Releases」兜底按钮当前指向 GitHub Releases（国内同样难打开），改为 landing page（`https://spherse.mengru.work/`，自定义域名，`github.io` 会 301 过去）——landing 有按平台/架构选包的下载按钮且自身带 GitHub 回退。

## 接口与数据

### OSS 清单类型（updater.ts 内新增，与 landing Manifest 对齐）

```ts
interface OssUpdateManifest {
  version: string;
  mac: { arm64?: string; intel?: string };
  win: { x64?: string; arm64?: string; setup?: string };
}
```

### 变更面

| 文件 | 变更 |
|---|---|
| `packages/desktop/electron/updater.ts` | 新增 `OSS_UPDATE_MANIFEST_URL` 常量、`OssUpdateManifest` 类型、`checkForUpdatesViaOss()`；`checkForUpdates` 两平台统一走之；删除 `checkForUpdatesMacFallback`；`compareVersions` 不变 |
| `packages/app/src/features/settings/UpdateChecker.tsx` | error 兜底链接 GitHub Releases → landing page |
| `packages/desktop/electron/updater.test.ts` | 重写检测用例（见测试策略） |

不改动：`host-bridge.ts` 契约（`UpdateState`/`UpdateEvent` 已有 `downloadUrl?` 字段）、`preload.ts`、`main.ts`（启动静默检查调用不变）、electron-builder.yml publish 配置（未来恢复 feed 用）、CI（`publish-oss` 已自动维护清单）。

## 测试策略

`updater.test.ts`（vitest，mock `electron`、`electron-updater`、global fetch、`app.getVersion`）：

1. macOS arm64：清单 version 更高 → `update-available` 事件携带 `mac.arm64` URL。
2. macOS x64：同上 → 携带 `mac.intel` URL。
3. Windows x64：清单 version 更高 → 携带 `win.x64` URL。
4. Windows arm64 且清单含 arm64 → 携带 `win.arm64`；清单缺 arm64 → 回退 `win.x64`；旧清单仅 `win.setup` → 回退 `win.setup`。
5. 版本相等 / 清单版本更低 → `update-not-available`。
6. fetch 非 200 / JSON 非法 → `update-error`。
7. dev 模式（`app.isPackaged=false`）→ upToDate 且不发 fetch。
8. silent=true：available 分支仍通知（启动静默检查的目的就是发现新版本弹窗，与原实现语义一致），not-available / error 分支不 sendEvent。
9. `compareVersions` 既有用例保留。

`UpdateChecker.structure.test.ts`：error 兜底链接断言更新为 landing page（且断言不再含 GitHub releases 链接）。

回归：`npm run verify`（desktop 测试 + app 测试 + i18n + lint）。

## 风险

- **OSS 单点依赖**：清单不可用/欠费时检测失败，与现状（GitHub 失败）等价，但 OSS 由作者自控、可观测性更好；landing 已同源依赖，风险已存在且被接受。
- **存量旧版 app**：仍指向 GitHub 的旧版本用户无法收到引导——当前版本 0.1.19、用户量极小（早期阶段），可接受。
- **Windows in-app 全自动更新事实下线**：由「前往下载」引导替代——**无回归**：如背景所述该功能从未实际生效（latest.yml 极早期即不再上传 + GitHub 不可达），方案 A 不损失任何实际可用功能；恢复路径已在 backlog #149 记录。
- **in-app 死代码保留的说明**：electron-updater 依赖与 `downloadUpdate`/`installUpdate`/`cancelUpdate` 链路保留不删，仅为 #149 未来复活留低门槛；因从未生效，保留与删除对用户行为均无差异，选保留以缩小本次 diff。
- **Mac x64 机器缺 intel 键**（极旧清单）：`downloadUrl` 为 undefined → UI 回退渲染「下载」按钮，点击后进入不可用的 in-app 路径（electron-updater 报 error）——UI 已有 error 展示与重试，不静默失败；实际清单始终含 intel 键（CI 必需资产校验），触发概率≈0。
- **清单 version 非法**（如空串）：`compareVersions` NaN 分支返回 0 → 视为无更新，安全侧退化。
