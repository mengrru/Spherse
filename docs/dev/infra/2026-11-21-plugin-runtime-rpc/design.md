# dev-v2：插件化运行时（cordis）+ 统一 RPC + 双形态部署架构设计

- 日期：2026-11-21
- 状态：reviewed（sub agent review 反馈已处理，见文末）
- 分支：`dev-v2`，自 `origin/dev`（47c00d53）分叉的长生命周期架构线，与 `dev` 并行演进、独立发版
- 路径约定：文中 `desktop/...`、`server/...` 等缩写均省略 `packages/` 前缀

## 背景与目标

Spherse 当前为单形态产品：agent runtime 全部运行在 Electron main 进程内嵌的 Fastify server（`packages/server`）中，renderer 与移动端 web 壳（`packages/web`，远程壳）通过 HTTP/WS 访问。本设计启动 dev-v2 架构线，达成三个目标：

1. **browser 版独立部署**：全 runtime 运行在浏览器端的独立站点（独立域名），与桌面版并存、共用代码、各自独立发版；消除 browser 版的 C/S 架构
2. **运行时插件化**：以 cordis 为组合层，将 core 的全部特性（capability、store、tool、trigger、MCP……）改造为 cordis 插件；pi（pi-agent-core / pi-ai）经粗粒度 bridge 接入，不侵入
3. **前端统一 RPC**：前端所有控制面调用统一为 RPC 接口，桌面版与 browser 版仅 transport 不同；为后续前端粗粒度插件化铺路

### 已确认的产品/技术决策

| # | 决策 |
|---|---|
| D1 | 组合层选 **cordis**（Koishi 系），不把 chord 提升为应用层组合运行时；chord 仅作为 pi 的传递依赖存在，应用代码不直接依赖 |
| D2 | pi 经**粗粒度 bridge** 接入，不按 pi 类型逐个包装。service 清单分两层——**core 聚合 service**：Project（ProjectManager + ProjectStore 门面）/ Session（SessionManager + AgentRunner + ModelCatalog 解析面）/ Trigger；**平台插件 service**（无 core 门面对应，按形态装配）：Store 实现 / Auth / Preview / Bus |
| D3 | runtime 全特性插件化，**store 也是插件**：desktop 形态装配 sqlite/fs 实现，browser 形态装配 IndexedDB/OPFS 实现 |
| D4 | **桌面版保留 server 进程**：Fastify 保留为 RPC transport 宿主 + 资源面反代 + auth/host-guard；REST 路由面一次性切换为 RPC 后删除（REST 无外部消费者，无双轨维护） |
| D5 | **browser 版以独立适配层替代 server 层**：runtime host 跑在 SharedWorker（托管模型见决策表），前端经 postMessage transport 访问；UI reload 不杀 turn |
| D6 | 前端统一 RPC，**双平面**划分：RPC 控制面（cordis）+ 资源面（真实 URL：桌面 Fastify 反代 / browser SW 虚拟路由）。preview、theme.css、文件下载留在资源面不进 RPC；**上传分形态**：桌面走 Fastify multipart（现状），browser 走 RPC（structured clone 传 Blob，由 Worker runtime 统一写 OPFS，保持存储单属主——避免 SW 与 Worker 双写） |
| D7 | 事件流为 RPC 一等公民：chat 流式、`since=` 续传、replay、审批 control_request 全部进契约。事件分两类：**replayable**（chat：per-session seq，源为 sessions.db event-log，现状已具备）与 **live-only**（bus 五通道现状为纯内存推送、无 seq、无持久化，P2 维持 live-only + 断线后全量对账，不为 replay 新增事件存储；未来需要时再评估 trigger/agent/session 通道的事件日志） |
| D8 | browser 版砍 `run_command` 与 stdio MCP transport（保留 StreamableHTTP）；桌面版保留全部能力 |
| D9 | 前端粗粒度插件化：插件 = 路由槽位 + UI 卡槽/面板槽 + RPC 方法 allowlist，**不给 cordis ctx**；权限模型落在 RPC 方法 allowlist 上 |
| D10 | 双形态同仓 monorepo、独立构建流水线；browser 版 UI 与 runtime 同包发布，无版本协商；桌面版保留 version-compat（远程壳需要） |

## 调研事实（已验证，证据）

### pi 系依赖：browser 安全，无硬 blocker

- pi-agent-core 0.85.1 root 入口静态与动态 import 均无 `node:`；Node 面隔离在 `./node`、`./harness/env/nodejs`、`./harness/session/testing`（conformance 测试工具，node:assert）三个子路径出口，Spherse 仅 import root 与类型
- pi-ai 0.85.1 root 无静态 node import；node 触点（包括但不限于 `auth/context.js`、`utils/provider-env.js`、`utils/pi-user-agent.js`、`env-api-keys.js`（挂 `./compat` 出口）、`api/openai-codex-responses.js`（node:zlib）、`auth/oauth/*`、`cli.js`）全部带 `typeof process === "undefined"` 守卫或隔离在独立出口，`utils/pi-user-agent.js` 注释明确做了 Vite/browser 兼容
- API 实现静态依赖的三个 SDK 均可进浏览器 bundle：openai v6（运行时检测）、@anthropic-ai/sdk（browser 字段映射）、@google/genai（dist/web 出口）；`anthropic-messages.js` 已内置 `anthropic-dangerous-direct-browser-access` header
- bedrock 路径（@aws-sdk + proxy-agent）为 lazy，`providers/all` 不静态拉入
- **半 blocker（集成改造项）**：内置 provider auth 链依赖 process.env；桌面现状靠 `applyModelSettingsToEnv`（`server/src/model-settings.ts:145-181`）注入，浏览器需改为 `createProvider` + 显式 `ApiKeyAuth` 重建（Spherse 已有先例：custom provider，`catalog.ts:107-120`）；`generate-image.ts:56-57`、`web-search.ts:47` 的 env 直读同批改造

### core 自身 Node 面（browser 版替换清单）

- **better-sqlite3**：`store/session.ts`、`store/memory.ts`，原生模块，浏览器不可载入，最大单项
- **node: import 面 37 个非测试文件（其中 23 个仅依赖 node:fs）**：全部文件工具、各 store 落盘、presets、marketplace（adm-zip）、image-processor、path-safety 依赖 node:fs
- **子进程类**：`run-command.ts`、MCP stdio（`mcp-client.ts` StdioClientTransport）
- pino：有 browser 构建，需确认 vite 走 browser 字段；cron-parser / nanoid / gray-matter / yaml 纯 JS 可共用
- 注意：当前 checkout node_modules 与 lock 不同步（`@modelcontextprotocol/client` 已声明未安装，`npm ls` 为空），P0 阶段先对齐安装再终验其 root 入口 browser 面

### preview / 资源面现状

Fastify 反代（`server/src/routes/preview.ts`）承担四职责：URL 命名空间（相对资源解析、`theme.css` 作为 `<link href>` 直载，消费方含 ImageCard/ContentView/custom-side-panel/welcome-page）、SDK 注入（`injectHeadScript`，任意目录层级解析）、`__auth/:token` 鉴权、静态服务细节（content-type 白名单、ETag/304、Range）。SDK 通信为纯 postMessage（`sdk/src/runtime/messaging.ts` + `api.ts` op allowlist），iframe 不直接 fetch server，杀 C/S 不影响 SDK 协议层。

### 环境约束

- 桌面生产环境 `loadFile`（file:// origin，`desktop/electron/window.ts:26`）**不支持 Service Worker**；SW 虚拟路由需要先改自定义标准协议（app://，`registerSchemesAsPrivileged` + `protocol.handle`）
- CORS 矩阵未验证：Anthropic 确认可直连；OpenAI 官方 API 不允许浏览器 CORS；Google/OpenRouter 一般可直连；zai/minimax/xiaomi/qwen/moonshot 待实测。Electron 可绕但 web PWA 无解，需逐 provider 实测出矩阵
- 触发器定时器现状跑在 Electron main 进程常驻；进浏览器后受页面生命周期约束

## 架构

```
┌────────────────────────── 共享层（同仓同发） ──────────────────────────┐
│  @spherse/app（UI）   contracts（TypeBox → RPC schema 词表）   sdk / i18n / presets  │
└──────────────────────────────┬────────────────────────────────────┘
                        RPC client（统一接口 + 能力矩阵查询）
             ┌────────────────────┴────────────────────┐
   desktop   │ Fastify：WS/HTTP RPC transport          │  browser：Worker 内 runtime host
             │ + auth / host-guard + 资源面反代         │  + postMessage transport + SW 资源面
             └────────────────────┬────────────────────┘
                        cordis runtime host
        （Electron main 进程 / SharedWorker，同一套插件）
        services: Project │ Session │ Store* │ Trigger │ Auth │ Preview │ Bus
                        │ bridge（粗粒度，D2）
                        ▼
              pi-agent-core（Agent loop）+ pi-ai（LLM Provider）
```

两个形态装配同一套 cordis 插件，差异仅在平台插件（Store/Preview/Auth/工具注册表）与 transport。

## 决策

| 决策点 | 结论 |
|---|---|
| 组合运行时 | cordis。理由：console（client/server 共享插件模型）生产先例、组合模型与目标同构；chord 0.85.x 版本锁死 pi 发版列车且 remote 边界半成品（symmetric RPC peers 仍为 planned）。注意 cordis 本体线分裂：3.x 生产验证但 2024-09 后冻结，4.x 活跃但 API 不稳定（见风险表）；RPC 面已与 cordis 解耦（O4 已决自研），选线影响面收敛在组合层内部。代价：需自写 pi↔cordis bridge，桥面保持粗粒度控制适配成本 |
| bridge 粒度 | service = core 聚合边界，权威两层清单见 D2（Project / Session / Trigger + 平台插件 Store / Auth / Preview / Bus）。pi 内部类型（Agent/AgentEvent/Message）只在 bridge 内部出现，对外经 contracts 类型投影 |
| RPC 形态 | 方法调用 + 事件订阅两类原语；schema 从 contracts 包 TypeBox 派生，方法按未来插件权限边界分组（见 D9）。事件订阅协议：`subscribe(scope, since) → replay + live push`，seq 单调、断线重连以 since 续传（对齐现 chat WS `?since=` 与 event-log seq 语义） |
| REST 去留 | 一次性切换后删除。Fastify 保留职责收敛为：RPC endpoint（WS/HTTP）、auth/host-guard、资源面反代（preview/静态/上传下载）。迁移量实测口径见「各层实现 / packages/server」：routes ~2.0k 行删除、非测试源码 ~4.5k 行上移、~8.4k 行契约测试重写 |
| 传输实现 | 桌面：Fastify WS 上的自研 RPC envelope 帧（O4 已决，见 `docs/dev/investigation/2026-11-22-rpc-envelope-selection/`）。浏览器：Worker postMessage transport。两个 transport 的断线/重连/背压/错误语义必须一致，前端只写一套容错 |
| store 插件 | 定义统一 Store service 接口（sessions/memory/JSON 配置三类）。desktop 插件 = better-sqlite3 + fs；browser 插件 = IndexedDB（sessions/memory）+ OPFS（项目文件）。数据格式允许分叉：无已发布 browser 版数据，不为兼容写迁移（仓库红线）。接口一次定稳，是 core 最深接缝 |
| AuthProvider | key 存储与注入抽象为 service：desktop = electron-store JSON + 显式注入 catalog；browser = 浏览器存储 + `createProvider` 显式 ApiKeyAuth 重建 17 个内置 provider + 图片/web-search 的 env 直读改注入源。key 永不进插件可达面（只暴露 call 面） |
| PreviewProvider（资源面） | `getPreviewUrl` 两实现：desktop = Fastify 反代（现状）；browser = SW 虚拟路由 + 客户端 SDK 注入（`injectHeadScript` 已为 SDK 导出的纯函数）+ 手写 Range/ETag/content-type/路径逃逸防护。桌面 app:// 协议改造与浏览器 SW 路由解耦，可并行 |
| 能力矩阵 | 现有 `HostCapabilities` 扩展为版本能力矩阵（run_command / stdio MCP / marketplace / trigger 后台 / 外部文件系统 / tunnel），RPC 暴露给前端，UI 与工具注册表按矩阵裁剪，替代散落的 kind 判断 |
| Worker 托管模型（browser） | runtime host = **SharedWorker**（兑现「UI reload 不杀 turn」的必要条件；dedicated Worker 随所属 document 销毁，仅作不支持 SharedWorker 环境的退化形态并明示牺牲 reload 隔离）；LLM 流式解析、存储写入不占 UI 线程；Worker→多标签的事件扇出用 BroadcastChannel；**存储与 runtime 属主唯一**：OPFS 只由 SharedWorker 内的 runtime 访问，禁止多标签各自起 runtime 写同一 session（event-log append 的 seq 强制连续，多写者必然冲突） |
| 版本协商 | browser 版 UI+runtime 同包无协商；桌面版 main/renderer 分发保留 version-compat，作用点从 connection/info 移到 RPC 握手元数据 |
| 前端插件（P5，粗粒度） | 插件清单 = UI 槽位声明 + 允许的 RPC 方法组。宿主把插件调用过 allowlist 再转发。SDK iframe 的 op allowlist 升级为该模型的第一块实现，两者同构 |

## 契约

- **RPC schema**：从 `@spherse/contracts` 既有 TypeBox schema 派生方法参数/返回校验；contracts 包职责从「wire 协议包」演进为「RPC 词表 + 进程内校验」，导出面规则不变。**schema 词表锁定 `@sinclair/typebox` 0.34**；pi 侧已迁移到改名包 `typebox` 1.x（两包同源不兼容主线），交互仅限 bridge 内手工类型投影；RPC envelope 已定为自研（JSON-RPC 2.0 基座 + 事件扩展，O4 已决），词表天然锁定 contracts，无第三方 RPC 包 schema 兼容性问题
- **事件契约**：统一为事件订阅原语，envelope 含 `scope`（channel + 实体键）与可选 `seq`（仅 replayable scope 定义，per-scope 单调）。**replayable**：chat 事件流（assistant delta / tool_execution_* / control_request / control_resolved），seq 源为 sessions.db event-log（`store/session.ts` events 表），`since` 续传与 replay 语义照搬现 chat WS；**live-only**：bus 五通道（trigger/agent/session/fs-watch/debug）——现状即纯内存推送（`server/src/bus/ws-bus.ts` 无 seq/持久化）、契约（`contracts/src/bus.ts`）无 seq 字段，P2 维持 live-only，断线恢复走全量对账（现 web 端 `resumedAt` 重对账模式），不为 replay 新增事件存储；browser 版 SharedWorker 内 live 事件以内存环缓冲做 best-effort 续传。通道语义表（replayable | live-only）随 P2 落 contracts
- **错误映射**：core 异常类型 ↔ RPC 错误码的映射表进 contracts；两个 transport adapter 共用，保证前端错误处理单套

## 各层实现

### packages/core

- 引入 cordis host 与 service 定义；现 `kernel/capability.ts` 的 Capability 手写 DI 逐项迁为 cordis 插件（capability / store / trigger / mcp / web-search / data / attachments）
- 拆平台面：core 主体（kernel、session fold、agent-runner、agent-assembly、model catalog 注册面）保持 browser 安全；node 专属（sqlite/fs store、run_command、stdio MCP、adm-zip、trigger executor 常驻实现）与 browser 专属（IndexedDB/OPFS store、SW preview、fetch image-processor）按平台插件拆分，形态建议单包 + subpath exports（`./node`、`./browser`），终形态 P1 时定
- `factory.ts` 装配逻辑改写为插件注册表 + 按形态选择平台插件

### packages/contracts

- 增补 RPC 方法 schema（方法分组对齐插件权限边界）、事件 envelope、错误码表
- 既有 schema 大部分直接复用（REST 方法 → RPC 方法的参数/返回一一对应）

### packages/server

- 职责收缩：RPC endpoint + transport adapter + auth/host-guard + 资源面（preview/静态/上传）
- REST routes 的业务逻辑上移为 cordis service 方法调用；实测口径：routes 层 ~2.0k 行删除、server 非测试源码 ~4.5k 行上移、~8.4k 行 REST 契约测试重写为 RPC 契约测试（P2 显式交付物，见实施顺序）

### packages/app

- `lib/api.ts`（~70 方法）与 WS 层收敛为单一 RPC client；chat 流与 bus 订阅改事件订阅原语；feature/store 层不动
- 工具注册表、agent dialog 按能力矩阵裁剪（browser 版隐藏 run_command / stdio MCP）

### packages/desktop

- main 进程改为 cordis runtime host 宿主 + Fastify transport
- P4：`loadFile` → app:// 自定义标准协议（`registerSchemesAsPrivileged: standard/supportFetchAPI/stream/secure` + `protocol.handle`），解锁 SW；dev（http://localhost）不受影响

### 新增 packages/browser

- browser 版壳：独立域名、独立 PWA manifest/CI、无连接页
- boot 装配：Worker runtime host + 平台插件（browser store/auth/preview）+ postMessage transport + SW 注册
- 复用 `@spherse/app` 全部 UI

### packages/web（远程壳）

- 维持现状连桌面版（RPC 化后随前端统一切换调用方式），去留为开放决策点（见下）

## 测试

- **transport 一致性**：同一套 RPC 用例分别跑 Fastify WS transport 与 postMessage transport（层间解耦越彻底，mock 拼接缝盲区越大——两实现共用契约测试是本设计的硬要求，延续仓库契约测试红线）
- **service 契约测试**：消费方（server/desktop/browser）对 ProjectService/SessionPort 门面各至少一条不 mock 被测方法的契约测试，锚点从现 PM 门面迁移
- **store 插件一致性**：两套 Store 实现共用同一组语义测试（sessions 分页/事件回放/memory CRUD 并发）
- **资源面双实现语义测试**：ETag/304、Range 边界（含非法 Range）、content-type 白名单、路径逃逸（`%2e%2e` 解码后校验）、`__auth/:token` 等价鉴权，Fastify 反代与 SW 虚拟路由共用同一组用例（SW 手写重实现是安全敏感面，与 store 双实现同级）
- P0 spike 用例：cordis core 在 Worker/SharedWorker 无 Node shim 运行验证；目标浏览器矩阵（SharedWorker/OPFS/SW 最低版本）；CORS 矩阵探测脚本（浏览器 origin 逐 provider 探测）

## 实施顺序

| 阶段 | 内容 | 出口判据 |
|---|---|---|
| P0 | spike：cordis-in-Worker（含 SharedWorker 形态）验证；目标浏览器矩阵定义（SharedWorker/OPFS/SW 最低版本，iOS Safari 重点）与 OPFS 多写者约束验证；CORS 矩阵实测；`@modelcontextprotocol/client` 安装对齐与 browser 面终验 | spike 结论落 docs/dev/investigation（envelope 选型已完成：`2026-11-22-rpc-envelope-selection`） |
| P1 | contracts 增补 RPC/事件/错误码 schema；core 引入 cordis host，capability/store 先行插件化（BackendPort 不动，桌面行为不变） | 全量 verify 通过，桌面行为无回归 |
| P2 | Fastify RPC transport + 前端切 RPC + 删 REST（routes ~2.0k 行删除、server 非测试源码 ~4.5k 行上移、**~8.4k 行 REST 契约测试重写为 RPC 契约测试——P2 显式交付物**）；事件面 RPC 化（chat replayable + bus live-only，通道语义表落 contracts） | 桌面版全功能回归 + E2E 通过 |
| P3 | packages/browser 壳 + SharedWorker host + browser store 插件（IndexedDB/OPFS）+ AuthProvider browser 实现；上传走 RPC（Blob 直传 Worker 落 OPFS） | browser 版可跑端到端会话：chat/审批/附件上传可用；资源面功能按 P3 降级定义验收——theme.css 回落默认主题、preview 卡片显示占位、欢迎页/侧板隐藏，不计为失败 |
| P4 | 资源面：SW 虚拟路由（Range/ETag/注入/逃逸防护）+ 桌面 app:// 协议改造 | 双形态 preview/theme.css/上传下载全通 |
| P5 | 前端插件槽位 + RPC allowlist 权限模型（吸收 SDK op allowlist） | 一个样例前端插件跑通 |

P1/P2 期间 dev-v2 与 dev 的同步策略：dev-v2 长期并行，定期从 dev 合入；反向合入按 PR 走 dev-v2 分支保护。

## 风险

| 风险 | 缓解 |
|---|---|
| pi 升级破坏 bridge | 桥面保持聚合级粗粒度；pi 类型只在 bridge 内部出现；pi 版本升级走既有 pi-deps-upgrade 流程时增加 bridge 契约测试回归 |
| cordis 在 Worker 的兼容性未验证 | P0 spike 前置；Koishi console 有 client 端浏览器先例，但 Worker + 宿主侧插件无先例，失败则退化为 renderer 内独立 context（牺牲 reload 隔离） |
| cordis 本体线分裂（调研 2026-11-22）：3.x 生产验证但 2024-09 后冻结，4.x 活跃但 latest=4.0.0-rc.13、API 不稳定 | 选线决策并入 O3 随 P1 拍板：3.x 稳定但停止演进，4.x 跟进主轨但接受 API 变动；无论选哪条，RPC 面与 envelope 已解耦（O4 自研），影响面收敛在组合层内部；锁定版本 + bridge 契约测试兜底 |
| CORS 矩阵含不可直连 provider（OpenAI 官方 API 已知不可） | 浏览器版 provider 面按矩阵裁剪或提示走 OpenRouter/自定义 baseUrl；不引入代理服务（违背去 C/S 目标） |
| better-sqlite3 → IndexedDB 语义差异（事务、并发写、WAL 语义） | Store 接口语义测试先行；sessions 事件回放一致性为核心用例 |
| SW 生命周期竞态（注册慢于首次 preview 访问） | boot 时 register+ready 再启用资源面；HtmlCard 主路径本就 fetch+srcDoc，可兜底 |
| 两 transport 行为分叉 | 共用契约测试套件（见测试节） |
| dev-v2 与 dev 长期分叉合并冲突 | P1/P2 初期尽量不动业务逻辑文件本体；P2 的 REST 删除点作为合入基线：删除合入 dev-v2 后，dev 侧对 server 包的后续改动按约定落在新逻辑层（service / 可迁移层），存量 REST 文件的 modify/delete 冲突接受人工裁决成本并计入排期 |
| 双 store 数据格式分叉的长期维护 | 格式以 browser 版为 v2 基准写一次导出/导入（zip），不做双向同步 |

## 开放决策点

| # | 问题 | 状态 |
|---|---|---|
| O1 | web 远程壳（连桌面）长期保留还是被 browser 版替代 | 待定；影响 MobileConnect/tunnel 代码是否进入维护模式 |
| O2 | 桌面 ↔ browser 数据互通最小方案（zip 导入导出 vs 暂不互通） | 待定；不阻塞 P0-P3 |
| O3 | core 拆分最终形态（单包 subpath vs core-node/core-browser 分包）；cordis 选线（3.x 冻结稳定 vs 4.x RC 活跃，见风险表） | P1 时定 |
| O4 | RPC envelope 自研 vs 复用 cordis 生态 RPC 包 | **已决（2026-11-22）**：自研，JSON-RPC 2.0 基座 + 事件扩展；cordis 生态无可复用 RPC 包。调研与 envelope v1 草案见 `docs/dev/investigation/2026-11-22-rpc-envelope-selection/` |

## 文档同步（doc-sync 预填）

- `docs/official/project-structure.md`：新增 packages/browser、server 职责收缩、core 拆分形态（P1/P3 时）
- `docs/official/architecture/`：组合层与 RPC 域文件（P2 定稿后新增）
- `packages/server`、`packages/app`、`packages/core` README：随各阶段实施同步
- dev-v2 分支策略（并行、合入方向）补充至开发流程节

## Design review 处理

review 时间：2026-11-21，sub agent review（事实核查 + 架构评估 + 完整性/可测试性）。分级反馈与处理：

**Important（4 条，全部成立，已修）**

1. bus 统一进 seq/replay 契约的成本被低估：bus 五通道现状为纯内存推送（`server/src/bus/ws-bus.ts` 无 seq/持久化）、契约无 seq 字段，"照搬 chat WS"不成立；统一 envelope 的 seq 作用域未定义 → D7 与事件契约节改写为 replayable / live-only 双语义（chat=replayable 源自 event-log；bus=live-only + 断线全量对账，不为 replay 新增事件存储），通道语义表随 P2 落 contracts
2. Worker 托管模型混淆：dedicated Worker 随 document 销毁，reload 即杀 turn，与 D5 矛盾；BroadcastChannel 只是扇出管道非托管方案；目标浏览器矩阵缺失 → 决策表改为 SharedWorker 托管（dedicated 为退化形态）、OPFS 存储属主唯一约束、多写者禁止；P0 增加浏览器矩阵与多写者验证
3. browser 版上传路径未定义：D6 原表述下上传走 SW（P4 才有，P3 空窗），且 SW 与 Worker 双写 OPFS 属主冲突 → D6 改为分形态（桌面上传走 Fastify multipart；browser 上传走 RPC Blob 直传 Worker）；P3 出口补资源面降级定义（theme 回落默认主题/preview 占位/欢迎页侧板隐藏）
4. "13.5k 行 routes" 数字错误：实测 routes 2,016 行 / server 非测试源码 4,536 行 / 测试 8,372 行 → 修正各处数字；~8.4k 行 REST 契约测试重写列为 P2 显式交付物

**Medium（5 条，全部成立，已修）**

1. TypeBox 双包共存（contracts 用 @sinclair/typebox 0.34，pi 侧用改名包 typebox 1.x）未提及 → 契约节锁定词表 0.34 + bridge 手工投影 + O4 兼容性硬评估项
2. 测试节缺资源面双实现对照 → 补 ETag/304、Range 边界、content-type 白名单、路径逃逸、`__auth` 等价鉴权共用用例组
3. D2 service 清单与决策表 bridge 粒度清单不一致 → 统一为 D2 两层权威清单（core 聚合 service + 平台插件 service）
4. P3 出口"资源面除外"不可判定（theme.css/welcome-page/custom-side-panel 对 preview URL 有聊天外硬依赖）→ P3 出口补降级定义
5. dev 并行合并策略与 P2 大规模删除自相矛盾 → 改为"REST 删除点=合入基线 + dev 侧改动落新逻辑层约定 + 冲突裁决成本入排期"

**Minor（4 条，全部成立，已修）**

1. "fs 面 40 个非测试文件"实测为 37（其中 23 个仅 node:fs）
2. pi-agent-core Node 面出口补枚举第三个（`./harness/session/testing` conformance，node:assert）
3. pi-ai node 触点改"包括但不限于"并补列（env-api-keys 挂 ./compat、openai-codex-responses node:zlib、auth/oauth/*、cli.js）
4. 篇首声明 `packages/` 路径缩写约定

**事实核查通过项**（reviewer 抽查，未列反馈）：pi-agent-core root 无 node: 且 Spherse 仅 import root；pi-ai 三守卫文件与 Vite 注释；anthropic browser header；bedrock lazy 隔离；better-sqlite3 仅 session/memory 两处；preview 四职责与消费方；SDK 纯 postMessage；REST 无外部消费者（landing/scripts/docs/SDK 均干净）；chat since/seq/replay 与 D7 一致；loadFile:26；chord "symmetric RPC peers planned"；dev-v2 merge-base 与 origin/dev head 一致。
