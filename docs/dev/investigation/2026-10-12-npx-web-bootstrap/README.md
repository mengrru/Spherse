# `npx spherse server`：终端一键启动 Server 调研

## 背景与目标场景

用户在终端执行 `npx spherse server`（可选 `--port`），拉起 Spherse server；CLI 启动后回显**线上已托管的前端 URL（含登录信息深链）**，用户点击 / 复制到浏览器即可直接登录使用。核心场景：**安卓手机通过 Termux 等工具在本地自行部署**——server 与浏览器同机（127.0.0.1），不需要 tunnel。connection page 不要求 auth，用于输入凭据登录；项目文件夹固定放在 user data 下的 spherse 目录。

范围说明（简化决策）：**第一期不带自托管前端**——server 不服务 web 静态资源，直接复用 GitHub Pages 上的 PWA（`https://spherse.mengru.work/web/`）。自托管静态资源作为二期增强保留在文末（G1'，已验证成本低）。

## 现状：两条既有启动链路

### 1. Desktop 链路（Electron 承担了全部 host 职责）

```
app.whenReady
  → fixPath()                          # shell PATH 修复（packaged 才需要）
  → migrateLegacySettings()            # settings 迁移
  → ensureServer()                     # createMultiProjectServer({ auth.accessToken = getServerToken(),
                                       #   modelSettingsPath = userData/model-settings.json, appVersion })
  → createWindow() → loadFile/loadURL  # renderer 内嵌分发
  → registerAllIpc(...)                # 30+ IPC 通道
  → renderer 启动后经 IPC restore-projects 重放项目注册
```

- token：`getServerToken()`（`packages/desktop/electron/settings.ts:167-178`）惰性生成 64 hex，持久化在 electron-store `settings.json` 顶层 `serverToken`
- 项目列表：settings.json `openProjects`，由 renderer 驱动经 IPC `restore-projects` 重放（`packages/desktop/electron/ipc/project.ts:139-152`）

### 2. Web PWA 链路（静态站 + 远程连接）

- web 构建产物部署在 **GitHub Pages**（`spherse.mengru.work/web/`），与 server 完全解耦；PWA（SW precache + manifest）
- 手机打开 PWA → `MobileConnectPage`（扫码 / 手动输入 base+token）→ `localStorage["spherse:connection"] = { baseUrl, token }` → 跨域直连 server（Bearer header / WS `?token=` / preview 路径 token）
- 连接页深链格式 `#/?base=<baseUrl>&token=<token>` 已支持（`packages/app/src/lib/connect-payload.ts`），进入即自动登录并清除 URL 中的 token——**CLI 回显此格式即可免手输 64 hex**

### 鉴权模型要点（对本需求有利的事实）

- server 默认端口 53972、**只绑 127.0.0.1**（`packages/server/src/index.ts:34,149`），`EADDRINUSE` 回退随机端口——与「手机本机访问 127.0.0.1」的模型完全一致
- Host 校验静态白名单 `localhost / 127.0.0.1 / [::1]`（任意端口）——本机访问天然放行
- auth hook（`packages/server/src/middlewares/auth.ts:58-69`）只管 `/api/*` 与 `/ws/*`，公开路径 `/health`、`/api/connection/info`
- **线上 PWA → 本机 loopback server 的跨域链路已有现成机制**：认证制 CORS（带有效 token 的 actual response 反射请求 Origin，`packages/server/src/middlewares/cors.ts`）正是现有移动端连接（tunnel URL）的工作方式；`http://127.0.0.1` 被浏览器视为 potentially trustworthy origin，HTTPS 页面发起的 `http://127.0.0.1` 请求不受 mixed content 拦截；WS 侧无 Origin 校验（身份防线是 token）
- `@spherse/server` 全部（含 core/contracts/presets/i18n/sdk）不依赖 Electron，可纯 Node 自起（server README 已有直连用法）

### 回显 URL 的具体形态

```
https://spherse.mengru.work/web/#/?base=http://127.0.0.1:<实际端口>&token=<serverToken>
```

与 `buildConnectUrl` / `parseConnectPayload` 现有格式完全一致（`packages/app/src/lib/connect-payload.ts`、`lib/urls.ts:9-13`），web 端零改动。CLI 从 `fastify.server.address()` 读实际监听端口（端口冲突回退随机后必须回显真实值）。

## Gap 清单总览

| # | Gap | 层 | 量级 |
|---|---|---|---|
| G2 | ProjectRegistry 纯内存、无持久化，且 server 没有任何「注册项目」的 HTTP API；独立启动的 server 永远是空项目列表 | server / 新 CLI | **大（架构性）** |
| G3 | host 层职责需要 Node 重建：token 生成与持久化、modelSettingsPath、userData 目录、appVersion 注入 | 新 CLI | 中 |
| G4 | web 端「新建/打开项目」能力为空（`openProject` 抛错、`selectDirectory` 返回 null），npx 场景无项目创建入口 | server / web | 中 |
| G5 | npm 发布链不存在：workspace 包均未发布、依赖写 `"*"`、`@spherse/server` 无 bin | 发布 | **大（工程性）** |
| G6 | better-sqlite3 无 android prebuild（已实证），Termux 首装走源码编译 | 依赖 | **大（风险性）** |
| G7 | 零散小项：`serverVersion` 硬编码、版本配对、离线可用性 | server / CLI | 小 |
| G1' | （二期）server 自托管 web 静态资源 | server | 小（后置） |

## 逐项分析

### G2 项目注册的持久化与重放（大，架构性核心 gap）

现状三层事实：

1. `ProjectRegistry` 全内存（`packages/server/src/registry.ts:28-37`），进程重启即丢；`GET /api/projects` 只是内存快照（`routes/connection.ts:31-36`）
2. server **没有任何**「注册项目」HTTP API；`registry.register` 在 server 包内只有测试调用。注册唯一入口是 Electron 主进程 IPC（`ipc/project.ts:126-129`）
3. web renderer 的 `restoreProjects` 只读（`GET /api/projects` + 逐项 info），不触发注册（`packages/web/src/host-bridge-web.tsx:120-151`）

即：**独立启动的 server 永远返回空项目列表，web 端无法自愈**。desktop 之所以能工作，是因为 renderer 启动时经 IPC 把 settings.json 里的 `openProjects` 重放注册。

可选方案：

| 方案 | 说明 | 评价 |
|---|---|---|
| A. CLI 承担 host 职责 | CLI 读自己的 settings.json（openProjects 等价物），启动后循环 `registry.register(root)`；重启 CLI 重放 | 复刻 desktop 模式，改动最小、职责清晰（host 持久化本就是 desktop 的职责，CLI 是新 host）；registry 不动 |
| B. server 自带持久化 | registry 启动时读盘恢复 | 改变「server 无 host 状态」的现有边界，desktop 场景出现双写（desktop settings.json 与 server 侧文件不一致），侵入大 |
| C. 新增注册 HTTP API（如 `POST /api/projects`） | web 端可直接打开/新建项目 | 需要鉴权与路径安全设计（任意目录注册 = 服务端文件系统枚举面），且单独不解决重启恢复问题 |

倾向：**A 为主**（CLI = 新 host，对齐 desktop 先例），C 作为后续增强（限定「固定 projects 目录内」的注册/创建，与 G4 合并解决）。方案 A 下项目文件夹约定固定为 user data 下的 `projects/<name>/`（见 G3 布局），CLI 首次启动可自动创建一个默认项目（空目录首开由 core `assembleProject` 自动初始化 `.spherse/` + 默认 agent「小助手」，`packages/core/src/factory.ts:62-77`——零额外种子逻辑）。

### G3 Host 层职责的 Node 重建（中）

CLI 需要复刻 desktop host 的最小职责集（均为纯 Node 可实现）：

| 职责 | desktop 现状 | CLI 方案 |
|---|---|---|
| userData 目录 | Electron `app.getPath("userData")` | 自定：`~/.spherse/`（支持 `--home` / `SPHERSE_HOME` 覆盖；Termux home 即 `/data/data/com.termux/files/home`） |
| serverToken | electron-store settings.json | `~/.spherse/settings.json`，复用 `generateAccessToken()` 语义（`crypto.randomBytes(32).toString("hex")`，desktop 实现 `settings.ts:163-165` 可提炼复用） |
| modelSettingsPath | `userData/model-settings.json` | `~/.spherse/model-settings.json`（`CreateServerOptions.modelSettingsPath` 已支持注入；用户在 web 设置页配置 API key 即可，`PUT /api/settings/models` 在 web 可用，无 gap） |
| appVersion | `app.getVersion()` | CLI 包自身 version（版本配对见 G7） |
| 项目重放 | IPC restore-projects | 见 G2 方案 A |
| 端口 | desktop 从 `fastify.server.address()` 读实际端口 | CLI 同样读实际端口回显（`EADDRINUSE` 自动回退随机端口后必须回显真实值） |
| fixPath / 托盘 / updater / tunnel / 单实例锁 | Electron 专属 | 全部不需要（shell 直跑 PATH 天然继承；本机访问不需要 tunnel） |
| 回显 | desktop 用 QR | CLI 打印线上前端深链 URL（见上）＋ 纯 token（供手输场景） |

建议磁盘布局（对齐 data-conventions 的分区持久化决策 ADR-0015）：

```
~/.spherse/
├── settings.json          # serverToken、openProjects（结构可复刻 desktop schema 子集）
├── model-settings.json
└── projects/
    └── <name>/            # 每个子目录一个项目（core 首开自动初始化）
```

与 desktop userData（`~/Library/Application Support/Spherse`）天然隔离，两套宿主可并存。

### G4 Web 端新建/打开项目（中）

现状：`HostCapabilities` 下 web 的 `selectDirectory` 返回 null、`openProject` 直接 throw（`host-bridge-web.tsx:111-119`）；项目市场安装也因 destDir 选择不可用（`ProjectMarketDialog` 直接 return）。

npx 场景最小闭环：CLI 首启建默认项目（G2）+ 后续 `spherse new <name>` 子命令在 `projects/` 下建目录并注册（core 零成本初始化）。**不需要动 web bridge**。

增强项（可后续）：server 新增「固定 projects 目录内」的创建/注册 API（G2 方案 C），让 web UI 直接新建项目。不建议第一期做。

### G5 npm 发布链与包形态（大，工程性）

现状：全部 `@spherse/*` 包未发布过；`@spherse/server` 无 `bin`、无 `private` 标记但 workspace 依赖写 `"*"`（`packages/server/package.json:24-26`），直接 publish 无法解析安装。**`spherse` / `run-spherse` 包名在 npm registry 均未被占用（已验证 404）**。

简化后（不带前端产物）的包形态选项：

| 方案 | 说明 | 评价 |
|---|---|---|
| A. 发布全部 workspace 包 + 薄 CLI 包依赖它们 | 最干净、复用性最好 | 需建立 10 包版本同步发布链，`"*"` 依赖全部改实版本；前期成本高 |
| B. 单包 `spherse`：esbuild 把 core/server/presets/sdk/i18n/contracts + pi 系全部 bundle，better-sqlite3 作 external dependency，bin 入口 + `server` 子命令 | 一个版本一个包，安装体积最小路径单一 | bundle 注意点：pino transport（pino-pretty worker 线程按绝对路径加载）不能直接 bundle，CLI 场景换普通 stdout 输出即可；pi 系约 22MB 源码（gzip 后预计 ~5-8MB）可接受；二期若自托管前端再把 web dist 打进包（版本天然对齐） |

倾向 **B 起步**（务实、迭代快），发布流程进 CI 后如有多包复用诉求再演进 A。

其他发布注意项：

- `npx` 默认用缓存包且交互提示更新，非交互（Termux 脚本）场景文档建议 `npx spherse@latest server` 或 `npm i -g spherse`
- `engines: { node: ">=22.19.0" }` 需写入包；Termux 官方源 nodejs-lts 版本需验证（见风险）
- bin 结构预留多子命令扩展（`spherse server` / `spherse new <name>` / 未来 `spherse token` 等）

### G6 better-sqlite3 / Termux 原生模块（大，最大风险点）

**已实证（2026-10-12 核实 GitHub v12.10.0 release 资产清单）**：

- Node ABI 资产共 40 个，平台矩阵仅 `darwin-x64/arm64`、`linux-x64/arm/arm64`、`linuxmusl-x64/arm/arm64`、`win32-x64/arm64`；ABI 覆盖 node-v127/137/141/147（对应 Node 22–25）；**全部资产中 `android` 出现 0 次**
- 推导链：Termux 的 node 构建下 `process.platform === "android"`；better-sqlite3 的 install 脚本 `"prebuild-install || node-gyp rebuild --release"` 会先请求 `...-node-v<abi>-android-arm64.tar.gz` → release 无此资产 404 → 回退 node-gyp 源码编译
- 结论：**Termux 首装必然走源码编译**，需 `pkg install build-essential python` 工具链（社区有成功编译案例）

**仍待实测**（需要一台真实 Termux 环境）：源码编译的成败与耗时、`prebuild-install` 在 android 平台下的确切行为（是否还有本地缓存查找路径）。

缓解选项（按代价递增）：

1. 文档明确引导（首选项）：CLI 启动时探测 `better_sqlite3.node` 加载失败给出一键安装工具链的指引
2. Termux 自建 prebuild（TUR 或自托管 release 资产 + `npm_config_better_sqlite3_binary_host`）——生态外工作量大
3. core 增加 `node:sqlite`（Node 内置，22.x 起可用、Termux 的 node 自带）适配层替换 better-sqlite3——消除全部 native 安装负担，但 `node:sqlite` 在 22.x 属实验性（版本行为需验证），且涉及全部 SQL 层回归，是独立的大专题

### G7 零散小项（小）

- **版本配对**：线上 PWA 的版本守卫 `compareAppVersion(appVersion, __SPHERSE_WEB_VERSION__)` 在 major/minor 不一致时全屏阻断（`packages/web/src/version-guard.tsx:67-71`）。CLI 注入的 `appVersion` 必须与线上已部署的 web 版本保持同步——发布流程需保证 `spherse` npm 包与 GitHub Pages 前端同版本发布（现有 release 流程已同步 web 版本到 tag，扩展即可）
- `serverVersion` 硬编码 `"0.1.0"`（`packages/server/src/routes/connection.ts`）——CLI 版本注入后顺手改为从包版本取
- `--port` 直通 `CreateServerOptions.port`（已支持）
- **离线可用性**：线上前端方案要求手机至少在首次访问时有网络（PWA SW 缓存后续可用）；完全离线场景依赖二期自托管（G1'）
- Chrome Local Network Access（public 页面 → localhost 请求的逐步管控）是观察项：现有认证制 CORS 对 OPTIONS 无条件 204，PNA 若强制启用需补 `Access-Control-Allow-Private-Network: true` 响应头——浏览器侧尚未全面强制，先记录不动
- CLI 优雅退出：转译 desktop 的 shutdown 链（`server.close()` 幂等、SIGINT/SIGTERM 触发），防 SQLite WAL 未 checkpoint
- token 出现在 URL 深链与终端回显——与本机 loopback 威胁模型一致（server.md 安全模型），可接受；CLI 回显时提示 token 即密码

### G1'（二期）server 自托管 web 静态资源（小，后置）

第一期不做，但调研已确认成本很低，作为二期离线化 / 去 GitHub Pages 依赖的路径：

- server 增加 `staticDir?: string` 选项（`@fastify/static` 或轻量手写），desktop 不传则行为不变
- auth hook 对非 `/api/`、`/ws/` 前缀请求一律放行——静态资源（connection page 及全部 JS/CSS/SW/manifest）天然免 auth
- web 产物 `base: "./"` 相对路径任意挂载路径可用；SW `navigateFallbackDenylist` 已排除 `/api/`、`/ws/`、`/preview/`（`packages/web/vite.config.ts:77`）——同源部署 PWA 与 API 共存已在设计时考虑过；hash router 无需 history fallback
- CLI 深链回显切换为 `http://127.0.0.1:<port>/#/?base=...&token=...`，无需 mixed content / CORS 考虑

## 风险与开放问题

| 风险 | 等级 | 说明 / 待办 |
|---|---|---|
| Termux 源码编译 better-sqlite3 失败或耗时过长 | 高 | 决定性风险；design 前实测（见 G6） |
| Termux Node 版本 < 22.19 | 中 | 实测 `node -v`；engines 拦截后需引导升级 |
| CLI 版本与线上前端版本失配触发守卫阻断 | 中 | 发布流程同版本发布（G7）；短期可让 CLI 支持指定回显 dev 前端 URL 调试 |
| Android 后台杀进程 | 中 | 产品运营性问题：引导 Termux 前台通知 / termux-services / wakelock，文档提示即可 |
| bundle 破坏 pino transport / 动态 require | 中 | CLI logger 改直写 stdout；esbuild 平台 `node` + external better-sqlite3；CI 冒烟 `npx .` 验证 |
| 线上前端依赖网络（首访） | 低 | 接受；完全离线走二期 G1' |
| Chrome PNA 强制后 preflight 缺头 | 低 | 观察项，补一个响应头即可（G7） |
| 手机同机 localhost 语义 | 低 | Android 非根环境所有 app 共享网络命名空间，浏览器访问 127.0.0.1 可达 Termux 监听端口（待实测确认） |

## 建议实施切分（供后续 design doc 参考）

1. **CLI 包骨架**（G3 + G5 方案 B）——`packages/cli`（bin `spherse`）：userData/token/modelSettings/端口解析 + `createMultiProjectServer` 组装 + 线上前端深链回显 + esbuild bundle + 信号退出
2. **项目注册闭环**（G2 方案 A + G4）——CLI settings.json + 启动重放 + 默认项目创建 + `new` 子命令
3. **发布流程**（G7 版本配对）——npm 发布 CI 与 web 部署同版本联动 + `serverVersion` 修正
4. **Termux 实测与引导**（G6）——实测先行，结论决定是否需要 node:sqlite 专题
5. **二期：自托管前端**（G1'）——staticDir 选项 + web dist 进包
