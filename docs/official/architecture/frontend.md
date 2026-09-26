# 前端架构

> 覆盖：`@spherse/app` 的 Provider 栈、HostBridge 抽象、路由模型、状态分层、失效桥与项目生命周期机制。
> 包级编码守则（状态归属判断表、组件/effect/样式/i18n 规则、测试清单）见 `packages/app/README.md`，本文不重复。
> chat 流式运行时见 [chat.md](chat.md)，主题机制见 [theming.md](theming.md)，UI SDK host 侧见 [ui-sdk.md](ui-sdk.md)。

## Provider 栈与壳复用

- `createAppRoot(bridge)` 构建渲染树：QueryClientProvider → HostBridgeProvider → RouterProvider
- desktop 壳注入 `createElectronHostBridge()`；web 壳注入 `createWebHostBridge()` 外加恢复探针与版本守卫——renderer 代码单份复用，宿主差异全部收敛在 bridge
- 壳只经 `@spherse/app` package.json `exports` 白名单入口导入（决策见 [ADR-0009](../../dev/decisions/0009-app-exports-whitelist.md)）；ESLint 禁止壳源码经 `@/` alias 深度导入 app 内部模块
- web 壳首启的连接引导：index 路由经 `bridge.renderConnectPage()` 渲染连接页，连接信息（baseUrl / token）存 localStorage `spherse:connection`，`getServerBaseUrl` / token 从它读取
- TanStack Query 全局配置（`queries/client.ts`）：`staleTime: Infinity`、`retry: 1`，模块级单例；个别域显式覆盖 gcTime，marketplace-skills 与 marketplace-projects 是仅有的两个 `staleTime: 0` 域（每次打开市场拉新）；marketplace-projects 挂全局 key `["marketplace", "projects"]`（非 project-scoped，零项目可用）

## HostBridge 抽象

renderer 单份代码、宿主差异经此接口抽象的决策见 [ADR-0006](../../dev/decisions/0006-host-bridge-shells.md)。

- 接口定义宿主能力：server 连接信息、settings 读写（`getSettings` / `saveSettings`）、`openExternal`，可选方法 `saveBlob` / `showSaveDialog`（filePicker 能力配套），以及可选子 API 对象 `project` / `updater` / `devTools` / `mobile` / `notifications` / `renderConnectPage` / `renderNotificationSetup`
- `HostCapabilities` 声明能力**程度**（同功能在各宿主的差异，如可编辑与否），renderer 据此条件渲染；feature 级整块开关不在这里，走 feature-registry。字段清单由 `host-capabilities.structure.test.ts` 钉住：**声明即必须被消费**（加字段必须带消费点，零消费字段删除）
  - 布尔项：`filePicker` / `mobileAccess` / `openFileExternal` / `tray`（设置 > 通用「关闭至托盘」开关）/ `systemNotifications`（设置 > 通用「系统通知」开关）
  - 对象项：`content.editable`
- desktop 实现全开；web 实现 `content` 只读、其余 false，project API 走 HTTP
- 消费经 `useHostBridge()`；feature 可见性经 `useFeature` + `FeatureGate` 按 hostKind 查 `feature-registry.ts` 矩阵（改动需同步 `feature-registry.test.ts`）

## 系统通知（双通道）

approval（含 question）与 trigger 完成/失败接系统通知，两宿主通道独立、互补不重叠：

- **desktop（本地通道）**：`ApprovalNoticeBridge` / `TriggerEventBridge` 在既有 in-app toast 逻辑处并行调 `bridge.notifications?.show()` → IPC → 主进程 `Notification`（click 聚焦主窗）。弹出条件：settings 总开关 `systemNotifications`（默认开）开启 + 窗口非聚焦（`document.hasFocus() === false`）+ approval 非当前活跃 session / trigger `entry.notify`
- **web PWA（server 推送通道）**：server 端 PushNotifier 主动推（不依赖 WS attach，见 [server.md](server.md)「Web Push」），SW 收到恒展示（tag 去重，无前台抑制）；PWA 端无 UI 开关，跟随浏览器通知权限——`notification-setup.tsx`（经 `bridge.renderNotificationSetup` 挂载）在 permission 为 default 时显示引导 banner，granted 时 ensureSubscription（本地订阅缺失或 VAPID key 不匹配则退订重订并上报，上报失败回滚本地订阅待下次自愈）；决策纯函数在 `@spherse/app/lib/notification-push`（web 壳无测试设施，沿用 web-resume-probe 模式）
- 文案 server/desktop 各自渲染：desktop 走 renderer i18n（复用 toast key + `push.*`）；push 由 server 按订阅 locale 渲染（key 同源 `push.*`）

## 路由模型

- Hash Router（Electron 本地页面刷新不依赖服务端 history fallback），路由表（`router.tsx`）：
  - `/` → App shell（errorElement 为全局错误边界），index → OnboardingPage
  - `project/:projectId` → `ProjectScope`（layout route，经 `<Outlet />` 渲染子页面）
    - index → 欢迎页；`chat/:sessionId` → ChatPage；`content` → ContentBrowserPage；`browser` → BrowserPage
- Settings 不是路由——是 App shell 级全局 modal（app-ui-store 控制开关与 tab 定位）；全局搜索（`features/global-search/`）同为 app-ui-store 控制的浮层 modal，但渲染挂 ProjectScope（项目级能力，Cmd/Ctrl+P 与 project panel 空白处右键唤出）
- chat 路由 `?messageId=<seq>` 为消息定位参数：ChatPage 解析后交 `useLocateMessage` 自动加载历史至目标 seq 并滚动高亮，完成后 replace 清参；nav 栈与 lastRoute 记录统一经 `lib/route-params.ts` 剥离该参数，避免 back 循环
- **remount 下放 page 级**：ProjectScope 作为 layout 不因项目/路由切换重挂；需要重建的视图由各 page 自持 key——`<Chat key={sessionId}>`、ContentBrowser 按 path、WelcomePage 按 projectId
- `pages/` 是薄 route adapter：参数解析与缺参重定向，不承载业务逻辑
- **内容区标签页**（`features/tabs/`，全局设置 `tabsEnabled` 开关，默认开）：tab 由路由派生——`TabRouteBridge` 把当前 chat / content / browser 路由 upsert 进 feature-local store（`features/tabs/store.ts`，外部只经 `useCloseActiveTab` / `useCloseDeletedFileTabs` / `useTabsEnabled` 访问），打开入口只管 `navigate`；非活跃 tab 不渲染，点击即导航到其 URL
  - 欢迎页为虚拟首 tab（不入存储、不可关闭）；活跃 tab 不存储，由当前路由计算
  - 关闭活跃 tab = `navigate(邻居, { replace, state: { closeTab, closedUrl } })`，导航实际发生后 bridge 才移除 tab 并清出 nav 栈，被离开守卫拦截时 tab 不丢；bridge 处理后以 replace 清空 state
  - 浏览器页内导航带 `replaceTab` 原位替换；浮窗 session、被 BrowserPage 拒绝的 url 不建 tab
  - 失效清理：会话缺失 / 所属 agent 已删 → chat tab 自动移除；文件树删除 → `useCloseDeletedFileTabs` 按路径段匹配移除并跳邻居
  - 文件 tab 名为去扩展名的文件名（`lib/file-name.ts`，与 chat 快捷链接按钮同规则），`title` 为全路径
  - 移动端 + 标签页开启 + HTML 文件：ContentBrowser 隐藏 header，纵向空间留给预览，切换 / 关闭由 tab 承担
- **内容区分窗**（`features/split-pane/`，Electron only，移动端宽度不渲染）：`ProjectScope` 的 `<main>` 内容由 `SplitLayout` 包裹——左栏 `data-split-main`（TabBar + `<Outlet/>`）恒定存在，开关分窗只增减其后的分隔条与右栏，避免左侧页面重挂载；右栏与路由解耦，显示一个 target
  - target 复用内容区 tab 词汇 `TabTarget`（`lib/tab-target.ts`，同一套 key / 归一化 / 校验）；当前只支持 `file`（`ReadOnlyContentBrowser`：无返回 / 编辑，md 内链替换右栏文件），可支持的 kind 集中在 `features/split-pane/target.ts`，`SplitPaneView` 按 kind 分发渲染
  - 状态：feature-local store（每项目 `{ target, ratio }`），外部只经 `useOpenSplit` / `useCloseSplit` / `useSplitTarget` / `useCloseDeletedSplit` / `useSplitPaneAvailable` 访问
  - 「移动」语义：分窗的 target 正是左侧当前路由 target（按 `tabKey` 比较）时，走关闭当前 tab 的导航并附 `state.openSplit`，导航实际到达后由 `SplitRouteBridge` 提交，离开守卫取消时分窗不打开
  - 失效：文件树删除按路径段匹配结束分窗；读取返回 `file_not_found` 错误码（仅文件不存在，不含项目级 404）时自动结束，其他错误保留
  - 分隔条 pointer capture 拖拽 / 方向键 / 双击复位，渲染时按左右最小宽度 clamp
- **Cmd+F 作用域**：`ContentView` 的查找快捷键只由最近交互（pointerdown / focusin）的 content 容器（`FindScopeRoot`：主内容区、分窗、浮窗）响应；焦点在所有容器之外时不响应
- **离开守卫**：ContentBrowser 有未保存编辑时经 `useBlocker` 拦截任意 pathname / search 变化并复用放弃确认框；非 POP 导航带 `state.skipLeaveGuard` 可放行（项目关闭、删除当前文件）
- **lastRoute**：项目内子页面路由持久化在 localStorage（`spherse:last-route:<projectId>`）
  - 启动仅 hash 为 `/` 时恢复（deep-link 优先）；项目切换/关闭后恢复下一项目的 lastRoute；closeProject 时清理

## 状态分层

| 层 | 内容 | 持久化 |
|---|---|---|
| app-store | connection、打开项目集合、activeProjectId | 项目集合与 lastActive 经 bridge.project 子 API（desktop 落 electron settings，web 走 HTTP + localStorage）；lastRoute 在 localStorage |
| settings-store | locale / theme / debugTools / tabsEnabled / closeToTray（`loaded` 标记区分未加载与默认值） | 经 bridge `getSettings` / `saveSettings`（desktop 落 electron settings，web 落 `spherse:settings`） |
| TanStack Query | agents / sessions / content / directories / fileTree / skills / marketplace-skills / marketplace-projects（全局 key，不随项目关闭清理）/ triggers / welcome-page / theme-settings | 内存 cache，项目关闭清除 |
| project-data-store | 只保存 initialMessage 一个运行时投影 | 内存 |
| feature stores | 折叠、浮窗、内容区 tab 列表、分窗、trigger 运行态、chat 会话运行时（连接/entries/分页） | 见下 |

- side panel 偏好在 `side-panel-store`（localStorage `spherse:side-panel:pinned`），不在 app-store
- feature store 持久化分布：
  - localStorage：floating-chat（`spherse:floating-chat:<projectId>`）、floating-content-browser、browser、tabs（`spherse:tabs`）与 split-pane（`spherse:content-split`）（后四者均为全局单 key；tabs / split-pane 按 projectId 分组，加载时逐项校验）
  - 纯内存（关项目即清）：agent-session-list 折叠、agent-trigger 运行态
- **query key 一律 `["projects", projectId, ...]`**（`queries/keys.ts` factory）；文件内容 query 定义在 `features/content-browser/hooks/useContentFile.ts`——域 key 统一，定义位置按消费方就近
- **项目关闭清缓存**：`clearProjectQueries` 三步——generation++ → cancelQueries → removeQueries；generation 递增使迟到异步结果拒绝写入已清缓存
- 总线层 `bus-store`：全局多路复用 WS（`/ws/bus`），channels trigger / agent / fs-watch / debug；连接委托 `lib/ws/ws-connection.ts`（backoff `[1,2,5,10,30]s`、心跳 30s/60s、probe 5s；store 只保留 resumedAt 与订阅派发）

## 失效桥（bus → query invalidation）

| 桥 | bus 通道 | 动作 |
|---|---|---|
| ContentQueryBridge | fs-watch | content 按 changedPath 精准失效；directories / fileTree 全量失效；300ms 防抖；重连全量失效 |
| ThemeQueryBridge | fs-watch | theme.css 变更失效 theme-settings |
| WelcomePageQueryBridge | fs-watch | project.yaml 变更失效 welcome-page |
| TriggerEventBridge | trigger | updated / completed / failed 失效 triggers 并增删 running；completed 通知 + 刷新会话历史 |
| useAgentBusRefresh（hook） | agent | agent_updated 刷 agents；created / deleted 加刷 sessions |
| UiSdkBridge（event 桥） | fs-watch | 变更事件 debounce 后定向转发给订阅的 iframe（见 [ui-sdk.md](ui-sdk.md)） |

- 项目级桥统一挂 `ProjectRuntimeBridges`（ProjectScope 内的纯挂载 fragment：3 个 FeatureGate manager + 7 个 bridge，其中 SplitRouteBridge 经 FeatureGate）；带运行态的域（trigger）用专属桥；跨会话 toast（ApprovalNoticeBridge，订阅 chat session store）与自动更新 toast（UpdateNoticeBridge，订阅 host-bridge updater 事件）挂 App 级
- **重连补偿**：bus 重连置 `resumedAt`，各桥经 `useReconnectedSync` 批量失效缓存——错过的事件不重放，靠失效重拉对齐
- App 级补偿：重连后 refreshProjects；路由指向已消失项目时重定向

## 项目生命周期

- 项目关闭级联清理单一入口 `closeProjectCascade`（`layouts/project-lifecycle.ts`，调用方 `use-project-actions.ts` 只保留导航/toast）：app-store `closeProject`（host 侧关闭，失败即抛、本地不动）→ chat session store `disconnectProject`（断开该项目全部 chat 连接与 TTL 清理）→ `clearProjectQueries` → 各 feature store `clearProject` → `clearProjectData` → `clearProjectNavHistory` → `clearLastRoute`
- 清理面为显式清单，`project-lifecycle.structure.test.ts` 递归扫描全部定义 `clearProject` action 的 store 强制其出现在 cascade 中——新增 per-project store 必须定义 `clearProject` 并纳入清单；不做注册表/事件总线
- projectId 全链路一致：URL param → ProjectContext（`useProjectCtx`）→ query key → localStorage key 后缀 → bus 订阅 key
- 依赖注入：`ProjectContext` 注入稳定只读的 projectId / projectRoot；`useConnection()` 返回 connection 本体，`useApiClient(projectId)` 从 connection 派生 ApiClient

## feature 组织

- `features/` 按业务域组织，当前 22 个，按组：
  - 工作区：side-panel、activity-bar、project-panel、user-file-panel、skill-panel、agent-session-list、agent-dialog、agent-mcp、agent-trigger
  - 内容与浏览：content-browser、browser、welcome-page、text-selection-session、tabs、split-pane
  - 会话：chat、floating-chat、floating-content-browser
  - 应用级：settings、project-settings、onboarding、debug-tools
- `layouts/`：`ProjectScope`（项目工作区 layout route）+ `ProjectRuntimeBridges`（项目级桥挂载）+ `project-lifecycle.ts`（项目关闭级联清理）；跨 feature 编排放 layout 或自治 bridge
- `components/` 收 shadcn/ui 与跨 feature 复用组件；两个可复用子系统：
  - `file-tree/`：`FileTree` 支持 rootPath / emptyLabel，user-file-panel 与 skill-panel 共用；目录数据全走 directory query（每个目录节点组件自持 `useProjectDirectory`，`enabled: expanded`），controller 只保存交互状态（expandedPaths / creating / deleteTarget）
  - `floating-frame/`：拖拽 / resize chrome，`hookPrefix` 生成 `data-*-float-*` 主题钩子，三个浮窗 feature 复用
- side-panel 双形态：桌面 pinned 常驻或 hover 展开（clickAway 收起）；移动端（768px 断点）浮动按钮 + transform 滑出面板 + backdrop，关闭态 `inert` 防焦点泄漏

## 杂项机制

- Composer 草稿按 session 缓存：`spherse:draft:<sessionId>`，300ms 防抖写、卸载 flush、发送成功清除
- 项目内 back 是内存导航栈（`useProjectNavHistory`），不进 router history；`back()` 只记录 pending 目标，location 实际到达后才出栈（被守卫拦截取消不失步）；关闭 tab / 删除文件时对应 URL 经 `dropFromProjectNavHistory` 清出
