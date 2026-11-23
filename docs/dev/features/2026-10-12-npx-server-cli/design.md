# `npx spherse server`：CLI 一键启动 Server

## 背景

调研见 [`docs/dev/investigation/2026-10-12-npx-web-bootstrap/`](../../investigation/2026-10-12-npx-web-bootstrap/README.md)。核心结论：

- `@spherse/server` 全链路不依赖 Electron，可纯 Node 自起；但独立启动的 server **项目列表恒为空**——registry 纯内存、无注册 API，desktop 靠 renderer 经 IPC 重放 `openProjects`（架构性 gap G2）
- host 职责（token 生成持久化、modelSettingsPath、项目重放）目前全部寄生在 Electron 主进程，需要 Node 重建（G3）
- workspace 包均未发布、依赖写 `"*"`，无发布链（G5）；`spherse` 包名在 npm 未被占用（已验证）
- better-sqlite3 无 android prebuild（已实证），Termux 走源码编译——**用户已有手机上魔改跑通的先例**，降级为已知成本非阻断风险
- 线上 PWA → 本机 loopback 的跨域连接链路已有现成机制（认证制 CORS + 深链自动登录），web 端零改动

与用户商定的决策：

1. **第一期只做 server 启动**（`npx spherse server`），不自托管前端——回显线上已托管 PWA（`https://spherse.mengru.work/web/`）的登录深链，点击/复制到浏览器即登录；自托管静态资源留二期
2. **CLI = 新 host**：复刻 desktop host 的最小职责集（token / 模型配置路径 / 项目注册重放），对齐 desktop 先例，不改 server 包的边界（registry 不做持久化、不加注册 API）
3. **项目模型用目录扫描而非 openProjects 持久化**：`<home>/projects/` 下每个非 dotfile 子目录即一个项目，磁盘即注册清单（CLI 场景项目位置固定，这是相对 desktop「任意目录 + settings 记账」模型的合法简化）
4. **单包发布**：npm 包 `spherse`，esbuild bundle（只打包 node 侧依赖图涉及的 **5 个 workspace 包**——server / core / contracts / sdk / presets；`@spherse/i18n` 仅被 renderer 侧引用、不在 server 依赖图中，无需处理；npm 依赖全部 external），bin `spherse` + `server` / `new` 子命令。包名与根 `package.json` 的 `"name": "spherse"` 同名（root 非 workspace 成员，合法），但脚本与文档统一用路径形式 `-w packages/cli` 消歧
5. server 包本期**零改动**（`serverVersion` 硬编码无消费方，不动）

## 设计

### 1. 新包 `packages/cli`

```
packages/cli/
├── package.json          # name: "spherse", type: "module", bin: { spherse: "bin/spherse.js" }, private 发版时由 CI 处理
├── bin/spherse.js        # 薄 shim：#!/usr/bin/env node + import("../dist/cli.mjs")
├── src/
│   ├── main.ts           # 子命令分发：server | new | --version | --help
│   ├── args.ts           # 参数解析（--port / --home / --frontend-url，无第三方依赖）
│   ├── home.ts           # home 目录解析与初始化
│   ├── settings-store.ts # serverToken 持久化
│   ├── lockfile.ts       # 单实例锁
│   ├── projects.ts       # projects/ 扫描、默认项目创建、new 命令落盘
│   ├── server-cmd.ts     # server 子命令：组装 + 注册 + 回显 + 信号退出
│   └── echo.ts           # 回显输出（endpoint / token / 深链 URL）
├── build.mjs             # esbuild bundle 脚本（发布产物，非 dev）
└── dist/                 # 构建产物（cli.mjs），gitignore
```

- workspace 顺序：排在 `packages/server` 之后（依赖 `@spherse/server` 的 dist 类型与产物）
- 根 `package.json` workspaces 增加该成员；`build` 拓扑序由 workspaces 声明顺序保证

### 2. Home 目录与 settings 存储

- home 解析优先级：`--home <dir>` > `SPHERSE_HOME` > `~/.spherse`（`os.homedir()`；Termux 下即 `/data/data/com.termux/files/home/.spherse`）
- 布局（对齐 data-conventions 分区持久化决策 ADR-0015）：

```
~/.spherse/
├── settings.json      # { "serverToken": "<64 hex>" }，唯一 key
├── model-settings.json
└── projects/
    └── <name>/        # 每个非 dotfile 子目录一个项目
```

- `settings-store.ts`：token 惰性生成语义复刻 desktop `getServerToken()`（`crypto.randomBytes(32).toString("hex")`）——存在即复用，缺失即生成并 tmp+rename 原子写回；无 electron-store 依赖（纯 `node:fs`）
  - desktop 的 `generateAccessToken`（`packages/desktop/electron/settings.ts:163-165`，两行代码）直接照抄，不跨包提炼——提炼反而制造包依赖
- `model-settings.json` 不由 CLI 读写——只把路径传给 `CreateServerOptions.modelSettingsPath`，读写全部走 server 的 `ModelSettingsStore`（用户在 web 设置页配置 API key）
- token 轮换无子命令（第一期）：删 `settings.json` 中 `serverToken` 后重启即得新 token，README 说明即可

### 3. 项目模型：目录扫描注册

- 启动时扫描 `<home>/projects/`：`readdir(withFileTypes)` 后仅取 `dirent.isDirectory()` 的条目（普通文件跳过；symlink 经 lstat 语义 `isDirectory()` 为 false、天然跳过，不把 home 外目录拉进注册范围），按字母序排序逐个 `registry.register(root)`——顺序确定，web 端项目列表顺序稳定
- 每个项目根 `path.resolve` 后经 `@spherse/core` 的 `isPathInside(projectsDir, root)` 断言（仓库路径安全红线，禁止字符串前缀判断）
- **语义**：projects/ 下的每个非 dotfile 子目录都会被视为项目；空目录首开由 core `assembleProject` 自动初始化（`.spherse/` + `project.yaml` + 默认 agent「小助手」，`packages/core/src/factory.ts:62-77`），零额外种子逻辑
- 注册失败（如目录被占用、权限）不阻断启动：log 后跳过，与 desktop `ensureServer` 重放容错一致（`packages/desktop/electron/server.ts:62-68`）
- 首次启动 `projects/` 为空时：创建默认项目 `projects/default/`（mkdir + register，即完成初始化），保证 web 连接后非空列表、开箱即用
- `lastOpened` 不由 CLI 维护：web 端 `lastActiveProject` 自落 localStorage（`host-bridge-web.tsx`），排序退化按扫描序，可接受
- 不维护 `openProjects`/`lastActiveProject` 持久化——磁盘即真相，无双源漂移问题

### 4. `server` 子命令：启动流程

```
spherse server [--port <n>] [--home <dir>] [--frontend-url <url>]
```

1. **Node 版本守卫**：`process.version` < 22.19.0 时清晰报错退出（`engines` 字段在 npm/npx 默认非 strict、只警告不阻断；Node 20 用户会在 better-sqlite3 源码编译处以不可读错误失败，必须在入口拦截并给升级指引，含 Termux 场景）
2. 解析参数、解析并初始化 home（mkdir -p `~/.spherse/projects`）
3. **单实例锁**：`<home>/server.lock`（JSON：`{ pid, port, startedAt }`）——存在时 `process.kill(pid, 0)` 探测：存活则打印「已有实例运行于 http://127.0.0.1:<port>」退出（对齐 desktop 单实例锁先例 `bootstrap.ts:9`）；ESRCH 视为 stale、覆盖。手机场景 Termux 误双开高发（两个进程同 token 注册同一批 SQLite 目录），必须防护
4. `getServerToken()`（读或生成）
5. **显式 `--port` 冲突预探测**：`net.createServer` 试绑——被占即报错退出（用户显式指定端口通常写进了脚本/书签，静默回退随机端口违背意图）；默认端口（未传 `--port`）冲突沿用 server 内部 EADDRINUSE 回退随机端口行为，可接受
6. `createMultiProjectServer({ auth: { accessToken }, modelSettingsPath, appVersion: <CLI 包版本>, port })`
7. 扫描 + 注册项目（含首启默认项目）
8. 从 `fastify.server.address()` 读实际端口（照抄 desktop `getServerPort()` `packages/desktop/electron/server.ts:84-88`）；若实际端口 ≠ 显式 `--port`（预探测后仍命中 TOCTOU 窗口），close 后报错退出
9. 回显（§5），写 lockfile
10. 信号处理：`SIGINT` / `SIGTERM` → `server.close()`（幂等；阶段超时与 desktop 相同 10s，`settleWithin` 各阶段有界合计 ≤20s，无需额外看门狗）→ 删 lockfile → exit

- `--port` 直通 `CreateServerOptions.port`（已支持，默认 53972）；`--port 0` = OS 随机分配，同样回显实际端口
- 不做 tunnel / host 白名单扩展 / 绑定地址变更——server 保持只绑 `127.0.0.1`，与手机本机访问模型一致（安全默认，不改 host-guard）

### 5. 回显输出

启动成功后 stdout 输出（英文，简短；**i18n 豁免**：CLI stdout 是终端工具输出而非 renderer UI chrome，`@spherse/i18n` 面向 renderer、不在 CLI 依赖图中，且 Termux 用户群国际化——英文是惯例最小公分母）：

```
Spherse server running

  Endpoint:  http://127.0.0.1:53972
  Token:     <64 hex>

  Open in browser (login included):
  https://spherse.mengru.work/web/#/?base=http%3A%2F%2F127.0.0.1%3A53972&token=<token>

  First time? Configure a model API key in Settings after logging in.
```

- 深链格式与 `buildConnectUrl`（`packages/app/src/lib/connect-payload.ts:9-15`）严格一致：`URLSearchParams({ base, token })` 标准编码 + `#/?` 前缀；`parseConnectPayload` 消费后自动清除 URL 中 token（`MobileConnectPage.tsx:67-79`），web 端零改动
- 线上前端 URL 常量在 CLI 包内维护（`https://spherse.mengru.work/web/`），与 `packages/app/src/lib/urls.ts` 的 `WEB_APP_URL` 值一致；提供 `--frontend-url` 覆盖（dev / 内部部署调试用）
- token 出现在终端与 URL：与本机 loopback 威胁模型一致（server.md 安全模型），输出中附一句「token 即密码，勿外传」提示

### 6. `new` 子命令

```
spherse new <name> [--home <dir>]
```

- 校验 name：非空、不含路径分隔符、不以 `.` 开头（对齐 skill 命名规则精神）；重名检查含**大小写折叠**（macOS/Windows 大小写不敏感 FS 上 `Foo` 与已有 `foo` 同目录冲突）
- 行为 = `mkdir <home>/projects/<name>` + 提示「下次 `spherse server` 启动时自动初始化并注册」——**不在 new 时初始化**（初始化依赖 core `assembleProject`，拉起 server 注册时才发生，保持单一初始化路径）
- server 运行中新建项目不热注册（第一期）：重启生效；web 端创建项目路径见二期草图

### 7. Bundle 与发布形态

- **esbuild**（仓库已有先例：`packages/sdk` devDeps `esbuild ^0.25.0`）：
  - entry `src/main.ts` → `dist/cli.mjs`，`format: "esm"`、`platform: "node"`、`target: node22`
  - `packages: "external"`：所有 npm 包 import 保持 external（运行时从 node_modules resolve）
  - alias 打包 workspace 包是 bundle 的**唯一目的**（workspace 包不发布，`"*"` 依赖无法解析），逐条映射到各包 dist 产物，**含 subpath**（alias 到文件时 esbuild 无法派生子路径，subpath import 必须显式映射，否则构建期硬失败）：
    - `@spherse/server` → `packages/server/dist/index.js`
    - `@spherse/core` → `packages/core/dist/index.js`
    - `@spherse/contracts` → `packages/contracts/dist/index.js`
    - `@spherse/sdk` → `packages/sdk/dist/index.js`
    - `@spherse/sdk/source` → `packages/sdk/dist/source.js`（server preview 路由 import 此 subpath，`packages/server/src/routes/preview.ts:11-12`）
    - `@spherse/presets` → `packages/presets/dist/index.js`
  - **构建不变量**：build.mjs 扫描 bundle 产物，残留任何 `@spherse/*` import 即 fail——未来新增 workspace 依赖 / subpath 时 fail loud，防止以「构建通过、运行时挂某路由」的隐蔽形态出现
  - external 全量 npm 包的收益：pino transport worker（运行时按模块说明符 resolve `pino-pretty`）、`bindings`/`better-sqlite3` native 加载、任何动态 require 均不受 bundle 影响，无打包黑盒风险
- CLI 包 `dependencies` = core + server 的非 workspace 依赖并集（`better-sqlite3`、`fastify`、`@fastify/websocket`、`@fastify/multipart`、`pino`、`pino-pretty`、`nanoid`、`adm-zip`、`yaml`、`gray-matter`、`cron-parser`、`@sinclair/typebox`、`@modelcontextprotocol/client`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`）；pi 系与 core 一样锁精确版本
  - 一致性由构建脚本校验：从 workspace 各包 package.json 派生期望清单，与 CLI 包声明 diff，不一致即 fail（防止 core 升依赖后 CLI 漏跟）
- `engines: { node: ">=22.19.0" }`；`files: ["bin", "dist", "README.md"]`
- 发布产物构建：`build.mjs` 在 CI 中执行（本地 `npm run build -w packages/cli` 也跑，输出 dist 便于本地冒烟）；tsc 仅用于 typecheck（`typecheck` script），不产出运行时代码
- 用户侧安装：`npx spherse@latest server`（npx 缓存提示问题 README 说明）或 `npm i -g spherse`

### 8. 版本配对与发布流程

- CLI 包 `appVersion` 注入自身版本 → `/api/connection/info` → 线上 PWA 版本守卫 `compareAppVersion`：major/minor 失配全屏阻断（`packages/web/src/version-guard.tsx:67-71`）。**`spherse` npm 包必须与 GitHub Pages 前端同版本发布**
- 现有 release 流程已把 tag 版本 sync 进 `packages/web/package.json`（`deploy-pages.yml`）；扩展 build-and-release 流程：同 tag sync 进 CLI 包 + esbuild bundle + `npm publish`（NPM_TOKEN secret）
- 顺序约束：web 前端部署（旧 appVersion 下线）与 CLI publish 同时点出现失配窗口极短且方向安全（前端先上新 → 连旧 CLI 得 patch 警告/minor 阻断前 CLI 已发布；同 release 内同步）

### 9. 文档同步

- `docs/official/project-structure.md`：新增 `packages/cli` 条目
- `docs/official/data-conventions.md`：「应用级数据」表新增 CLI home 布局行（`~/.spherse/`：settings.json 仅 serverToken、model-settings.json、projects/ 扫描注册语义）
- 根 `AGENTS.md` Package 一览表加一行
- `packages/cli/README.md`：安装、命令、Termux 引导（先 `node -v` 检查 ≥ 22.19，再 `pkg install nodejs build-essential python` 工具链说明）、token 即密码提示、`npm update -g spherse` 更新引导
- `docs/official/testing.md`：分层总览「归属」表新增 CLI 行（纯逻辑单测 + 装配测试）
- backlog 更新（二期条目入 backlog）

## 非目标

- server 自托管 web 静态资源（二期；调研已确认成本低：auth hook 对非 `/api`、`/ws/` 路径天然放行）
- tunnel / 局域网访问（绑 0.0.0.0 + host-guard 放行涉及安全模型变更，独立专题）
- token 轮换子命令、server 运行中热注册项目（二期）
- openProjects 持久化 / desktop 与 CLI 共享数据目录（两套宿主天然隔离）
- `serverVersion` 硬编码修正（无消费方）

## 已知取舍

- **projects/ 下任意子目录都会被初始化为项目**（含用户手动放入的裸目录）：与「项目文件夹固定放在 spherse 目录下」的心智一致——放进去就是要用；代价是误放目录会长出 `.spherse/`，删除项目 = 删目录即可
- **深链 URL 携带 token 进终端 scrollback / 剪贴板**：与 QR 扫码（现有移动端流程）泄露面等价，loopback 威胁模型下接受；`--frontend-url` 调试场景同样如此
- **首次使用必须联网**（加载线上 PWA；SW 缓存后后续可用）：完全离线依赖二期自托管
- **new 不热注册**：运行中的 server 看不到新项目，需重启——CLI 单进程模型下避免引入注册 API，接受重启成本
- **npx 缓存旧版本**：用户可能长期跑旧 CLI 连新前端触发版本阻断——阻断层有「暂不升级继续使用」逃生门（仅本次会话），README 引导 `npx spherse@latest`；全局安装用户同理引导 `npm update -g spherse`
- **Chrome PNA（Local Network Access）**：public 页面 → localhost 请求未来可能要求 preflight 响应 `Access-Control-Allow-Private-Network: true`——现有 CORS hook 对 OPTIONS 无条件 204，届时补一个头即可，现为观察项不动

## 验证

- `packages/cli` vitest：
  - settings-store：token 生成/持久化幂等/原子写（tmp 目录）
  - projects：扫描排序、dotfile 与文件与 symlink 跳过、首启默认项目幂等、new 命名校验与大小写折叠重名
  - args：参数解析与优先级（--home > SPHERSE_HOME > 默认）
  - lockfile：存活实例拒绝、stale 覆盖、退出清理
  - node 版本守卫：低版本注入报错文案
  - echo：深链 URL 与 `buildConnectUrl` 编码规则一致（黄金用例：同一 base/token 两边产出相同字符串——cli 侧复制实现，单测钉住格式）
- **装配测试**（对齐 desktop 契约测试精神，不 mock `createMultiProjectServer`）：tmp home + 预置两个项目目录 → CLI server 启动函数 → 断言 `/health`、`/api/connection/info`（authRequired=true、appVersion）、`/api/projects` 返回两个项目、实际端口回显值与 address() 一致；显式 `--port` 被占时退出非零
- bundle 冒烟（本地 + CI）：`npm run build -w packages/cli` 后 `node bin/spherse.js --version`、真实起一个 `--port 0` 实例 curl `/health` + `/api/connection/info`（走 contracts schema）+ 任一项目 preview 路径请求（覆盖 `@spherse/sdk/source` subpath）——把 workspace 包遗漏 / subpath 漏映射挡在 CI
- lint、typecheck、`npm run verify`；Termux 真机验证留给用户（魔改先例已证明路径可行）

## 二期草图（暂不实施）

- server `staticDir` 选项自托管前端（离线化 + 去 GitHub Pages 依赖），深链切换本机 URL
- 运行中注册 API（限定 projects 目录内）+ web 端新建项目 UI
- token 轮换子命令 / `spherse token`
- 局域网访问模式（`--host` 绑定 + host-guard 动态放行 + 明确安全提示）
