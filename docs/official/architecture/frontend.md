# 前端架构

> 覆盖：`@spherse/app` 的 Provider 栈、HostBridge 抽象、路由模型、状态分层、失效桥与项目生命周期机制。
> 包级编码守则（状态归属判断表、组件/effect/样式/i18n 规则、测试清单）见 `packages/app/README.md`，本文不重复。
> chat 流式运行时见 [chat.md](chat.md)，主题机制见 [theming.md](theming.md)，UI SDK host 侧见 [ui-sdk.md](ui-sdk.md)。

## Provider 栈与壳复用

- `createAppRoot(bridge)` 构建渲染树：QueryClientProvider → HostBridgeProvider → RouterProvider
- desktop 壳注入 `createElectronHostBridge()`；web 壳注入 `createWebHostBridge()` 外加恢复探针与版本守卫——renderer 代码单份复用，宿主差异全部收敛在 bridge
- web 壳首启的连接引导：index 路由经 `bridge.renderConnectPage()` 渲染连接页，连接信息（baseUrl / token）存 localStorage `spherse:connection`，`getServerBaseUrl` / token 从它读取
- TanStack Query 全局配置（`queries/client.ts`）：`staleTime: Infinity`、`retry: 1`，模块级单例；个别域显式覆盖 gcTime，marketplace-skills 是唯一 `staleTime: 0` 的域

## HostBridge 抽象

renderer 单份代码、宿主差异经此接口抽象的决策见 [ADR-0006](../../dev/decisions/0006-host-bridge-shells.md)。

- 接口定义宿主能力：server 连接信息、settings 读写（`getSettings` / `saveSettings`）、`openExternal`，可选方法 `saveBlob` / `showSaveDialog`（filePicker 能力配套），以及可选子 API 对象 `project` / `updater` / `devTools` / `mobile`
- `HostCapabilities` 声明能力开关，renderer 据此条件渲染宿主专属 UI：
  - 布尔项：`projectManagement` / `filePicker` / `appUpdate` / `devTools` / `mobileAccess` / `openFileExternal`
  - 对象项：`settings.editable`、`settings.scope`、`content.editable`
- desktop 实现全能力开启；web 实现大多 false（settings 可编辑、content 只读），project API 走 HTTP
- 消费经 `useHostBridge()`；feature 可见性经 `useFeature` + `FeatureGate` 按 hostKind 判定

## 路由模型

- Hash Router（Electron 本地页面刷新不依赖服务端 history fallback），路由表（`router.tsx`）：
  - `/` → App shell（errorElement 为全局错误边界），index → OnboardingPage
  - `project/:projectId` → `ProjectScope`（layout route，经 `<Outlet />` 渲染子页面）
    - index → 欢迎页；`chat/:sessionId` → ChatPage；`content` → ContentBrowserPage；`browser` → BrowserPage
- Settings 不是路由——是 App shell 级全局 modal（app-ui-store 控制开关与 tab 定位）
- **remount 下放 page 级**：ProjectScope 作为 layout 不因项目/路由切换重挂；需要重建的视图由各 page 自持 key——`<Chat key={sessionId}>`、ContentBrowser 按 path、WelcomePage 按 projectId
- `pages/` 是薄 route adapter：参数解析与缺参重定向，不承载业务逻辑
- **lastRoute**：项目内子页面路由持久化在 localStorage（`spherse:last-route:<projectId>`）
  - 启动仅 hash 为 `/` 时恢复（deep-link 优先）；项目切换/关闭后恢复下一项目的 lastRoute；closeProject 时清理

## 状态分层

| 层 | 内容 | 持久化 |
|---|---|---|
| app-store | connection、打开项目集合、activeProjectId | 项目集合与 lastActive 经 bridge.project 子 API（desktop 落 electron settings，web 走 HTTP + localStorage）；lastRoute 在 localStorage |
| settings-store | locale / theme / debugTools | 经 bridge `getSettings` / `saveSettings`（desktop 落 electron settings，web 落 `spherse:settings`） |
| TanStack Query | agents / sessions / content / directories / fileTree / skills / marketplace-skills / triggers / welcome-page / theme-settings | 内存 cache，项目关闭清除 |
| project-data-store | 只保存 initialMessage 与 streaming session id 两个运行时投影 | 内存 |
| feature stores | 折叠、浮窗、trigger 运行态、chat streaming | 见下 |

- side panel 偏好在 `side-panel-store`（localStorage `spherse:side-panel:pinned`），不在 app-store
- feature store 持久化分布：
  - localStorage：floating-chat（`spherse:floating-chat:<projectId>`）、floating-content-browser 与 browser（全局单 key）
  - 纯内存（关项目即清）：agent-session-list 折叠、agent-trigger 运行态
- **query key 一律 `["projects", projectId, ...]`**（`queries/keys.ts` factory）；文件内容 query 定义在 `features/content-browser/hooks/useContentFile.ts`——域 key 统一，定义位置按消费方就近
- **项目关闭清缓存**：`clearProjectQueries` 三步——generation++ → cancelQueries → removeQueries；generation 递增使迟到异步结果拒绝写入已清缓存
- 总线层 `bus-store`：全局多路复用 WS（`/ws/bus`），channels trigger / agent / fs-watch / debug；backoff `[1,2,5,10,30]s`、心跳 30s/60s

## 失效桥（bus → query invalidation）

| 桥 | bus 通道 | 动作 |
|---|---|---|
| ContentQueryBridge | fs-watch | content 按 changedPath 精准失效；directories / fileTree 全量失效；300ms 防抖；重连全量失效 |
| ThemeQueryBridge | fs-watch | theme.css 变更失效 theme-settings |
| WelcomePageQueryBridge | fs-watch | project.yaml 变更失效 welcome-page |
| TriggerEventBridge | trigger | updated / completed / failed 失效 triggers 并增删 running；completed 通知 + 刷新会话历史 |
| useAgentBusRefresh（hook） | agent | agent_updated 刷 agents；created / deleted 加刷 sessions |
| UiSdkBridge（event 桥） | fs-watch | 变更事件 debounce 后定向转发给订阅的 iframe（见 [ui-sdk.md](ui-sdk.md)） |

- 纯失效桥挂 ProjectScope；带运行态的域（trigger）用专属桥；跨会话 toast（ApprovalNoticeBridge）挂 App 级、订阅 streaming-store
- **重连补偿**：bus 重连置 `resumedAt`，各桥经 `useReconnectedSync` 批量失效缓存——错过的事件不重放，靠失效重拉对齐
- App 级补偿：重连后 refreshProjects；路由指向已消失项目时重定向

## 项目生命周期

- closeProject 编排链（`use-project-actions.ts`）：clearProjectData → clearProjectQueries → 各 feature store `clearProject` → clearLastRoute——per-project 状态全部显式清理
- projectId 全链路一致：URL param → ProjectContext（`useProjectCtx`）→ query key → localStorage key 后缀 → bus 订阅 key
- 依赖注入：`ProjectContext` 注入稳定只读的 projectId / projectRoot；`useConnection()` 返回 connection 本体，`useApiClient(projectId)` 从 connection 派生 ApiClient

## feature 组织

- `features/` 按业务域组织，当前 20 个，按组：
  - 工作区：side-panel、activity-bar、project-panel、user-file-panel、skill-panel、agent-session-list、agent-dialog、agent-mcp、agent-trigger
  - 内容与浏览：content-browser、browser、welcome-page、text-selection-session
  - 会话：chat、floating-chat、floating-content-browser
  - 应用级：settings、project-settings、onboarding、debug-tools
- `layouts/` 仅 `ProjectScope`：项目生命周期编排 + 桥挂载；跨 feature 编排放 layout 或自治 bridge
- `components/` 收 shadcn/ui 与跨 feature 复用组件；两个可复用子系统：
  - `file-tree/`：`FileTree` 支持 rootPath / emptyLabel，user-file-panel 与 skill-panel 共用
  - `floating-frame/`：拖拽 / resize chrome，`hookPrefix` 生成 `data-*-float-*` 主题钩子，三个浮窗 feature 复用
- side-panel 双形态：桌面 pinned 常驻或 hover 展开（clickAway 收起）；移动端（768px 断点）浮动按钮 + transform 滑出面板 + backdrop，关闭态 `inert` 防焦点泄漏

## 杂项机制

- Composer 草稿按 session 缓存：`spherse:draft:<sessionId>`，300ms 防抖写、卸载 flush、发送成功清除
- 项目内 back 是内存导航栈（`useProjectNavHistory`），不进 router history
