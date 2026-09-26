# 自定义侧边面板（Custom Side Panel）设计

- 日期：2026-09-27
- 状态：草案

## 背景与目标

左侧 ProjectPanel（agent/session 列表 + 用户文件树 + skill 面板）目前结构固定。新增「自定义侧边面板」：用户在项目设置中指定项目内一个 HTML 文件的路径，激活后 ProjectPanel 的整个内容区被一个透明背景的 iframe 替换，渲染用户设定的页面。技术上与欢迎页同构——复用 preview 静态服务路由（`/api/projects/:id/preview/...`，含 UI SDK 自动注入），HTML 由用户项目文件提供，fs-watch 变更自动刷新。

- 项目设置新增「侧边面板」dialog：配置项目内 HTML 相对路径，可清除
- 激活时 iframe 宽高占满 ProjectPanel；背景透明（不加 `bg-*`，透出 app 主题背景 `--sp-background`；页面自身 html/body 若设背景则以页面为准）
- 切换入口：项目头像右键菜单（设置项 + 显示/隐藏切换项）+ iframe 视图角落悬浮退出按钮
- 侧边面板内的页面自动获得注入的 `window.spherse`（UI SDK，无会话上下文，与欢迎页一致）

## 已确认的产品决策

1. `path` 仅允许 html / htm（不支持图片）
2. 切换入口 = 头像右键菜单切换项 + iframe 角落退出按钮
3. 激活状态（是否正在显示侧边面板）持久化到 localStorage，per-project
4. 未配置 `path`（或配置了但文件不可达、query 加载中）时，切换菜单项置灰；设置项不置灰（但仍在既有的 Settings 子菜单门控内，见「右键菜单」）

## 决策

| 决策点 | 结论 |
|---|---|
| 命名 | yaml 字段 `sidePanel.path`；renderer feature 目录 `features/custom-side-panel/`（区别于既有的 `features/side-panel/`——后者指整个左侧滑动容器 ActivityBar+ProjectPanel，术语不变）；i18n 侧用户文案「侧边面板」。**硬约束**：`ProjectPanel.structure.test.ts` 与 `ActivityBar.structure.test.tsx` 以子串匹配禁用 `useSidePanel` / `useSidePanelStore`，故 renderer 侧新符号一律带 `Custom` 前缀——query hook `useCustomSidePanel`（文件 `queries/custom-side-panel.ts`）、store `useCustomSidePanelStore`（`stores/custom-side-panel-store.ts`）、组件 `CustomSidePanel` |
| 数据模型 | `ProjectConfig` 增加 `sidePanel?: { path: string }`，落盘 `.spherse/project.yaml`；`ProjectConfigStore` 增加 `getSidePanelSettings()` / `updateSidePanelSettings(path: string \| null)`（null = 删除字段），`ProjectManager` 增加同名薄门面——全按 welcomePage 模式 |
| 校验 | `normalizeSidePanelPath`：与 `normalizeWelcomePagePath` 同规则（trim、`\`→`/`、拒绝绝对路径 / `..` / 非 `userFiles` 类别即排除 `.spherse/**` 等），差异仅在扩展名白名单只含 `html` / `htm`；保存时不要求文件存在；server 与 dialog 各自再校验一遍（双层，同欢迎页） |
| API | contracts 新增 `sidePanelSettingsRequest { path: string \| null }` / `sidePanelSettingsResponse { ok, path }`；server `routes/settings.ts` 新增 `GET/PUT /api/projects/:projectId/settings/side-panel`，handler 直接委托 PM 门面 |
| query 解析 | `queries/custom-side-panel.ts`：`resolveCustomSidePanel` = settings 查询 → 无 `path` 返回 `{ path: null }`；有则 `fetch(getPreviewUrl(path))` 验证可达，不可达返回 `{ path: null }`。**不做** 欢迎页的根 `index.html` fallback（侧边面板是显式配置项）。`gcTime: Infinity` 同欢迎页；query key `["projects", id, "custom-side-panel"]` |
| 视图切换状态 | 新 store `stores/custom-side-panel-store.ts`：`activeByProject: Record<string, boolean>` + `isActive(projectId)` / `setActive` / `toggle` / `clearProject`；localStorage key `spherse:custom-side-panel:active-by-project`（JSON map，读写模式仿 `side-panel-store.ts` 手写 read/write）。关闭清理：`closeProjectCascade` 调用 `useCustomSidePanelStore.getState().clearProject(id)`——`project-lifecycle.structure.test.ts` 会自动发现一切定义 `clearProject` 的 store 并强制其进入级联，该机制钉死挂点不遗漏 |
| 渲染切换 | `ProjectPanel` 顶部读 store 激活态 + query 解析结果：`active && resolvedPath` → 渲染 `<CustomSidePanel key={projectId} path={path} />` **替换**默认三段内容；否则渲染既有默认内容（AgentSessionList + UserFilePanel + SkillPanel）。path 被清除/不可达时自动回落默认内容，激活态保留（休眠，重新配置后自动恢复显示）。激活时 `aside` 改 `overflow-hidden`（iframe 自管滚动，防双重滚动条）。`key={projectId}`：ProjectPanel 不随项目切换重挂（WelcomePage 的干净切换依赖页面级 key，见 `WelcomePagePage.tsx` 注释），须在组件上补 key 防旧项目的 reloadKey/pathRef/iframe 残留（同 iframe 换 src 是导航而非重挂）。外层 ContextMenu 与 `aside` 骨架不变 |
| iframe | `src = client.getPreviewUrl(path)`（复用现有构造，含 `__auth` 段；**不带** `?v=` 版本参数——刷新机制是 `key={reloadKey}` 整体重挂，与欢迎页一致）；`sandbox="allow-scripts allow-same-origin"`；`className="h-full w-full border-0"` 不加 `bg-*`（透明）；fs-watch 防抖 300ms 后 `setReloadKey(k=>k+1)` 强制重挂载刷新，比较归一化路径 === 当前 path，逻辑照搬 `WelcomePage` |
| 角落退出按钮 | 在 `CustomSidePanel` 组件内部：容器 `relative group`，按钮 absolute 定位在右上角，`opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100`（hover 浮现 + 键盘可达 + 触屏常显，Tailwind 4.2 原生支持 `pointer-coarse` 变体），点击 `toggle(projectId)` 回默认面板。放组件内而非 `ProjectPanel/index.tsx`，规避其 structure test 对 `absolute` 的禁令 |
| 右键菜单 | `ActivityBar` 头像右键菜单：① Settings 子菜单追加「侧边面板」→ 打开 `SidePanelSettingsDialog`（第三组 dialog state + 挂载，完全照现有两组模式）；该子菜单整体维持既有 `canEditProject && projectId === activeProjectId` 门控。② 切换项「显示/隐藏侧边面板」与 Settings 子菜单同级、Settings 子菜单**之外**，门控仅 `projectId === activeProjectId`——激活是本地视图状态、不写项目数据，web host（`editable: false`，无设置入口）也能切换（path 可来自桌面配置或手改 project.yaml 后同步）；label 基于有效显示态（`active && resolvedPath`）而非裸激活态，休眠时显示「显示侧边面板」；`disabled = resolvedPath == null`（含 query 加载期，`== null` 同时覆盖 undefined）。ActivityBar 内部 `useCustomSidePanel(activeProjectId, client)` 取解析结果（内部 hooks 不经 props，合规）。注意：iframe 激活时会吞掉 ProjectPanel 区域的右键事件，菜单入口在 ActivityBar 头像上不受影响 |
| QueryBridge | 新建 `CustomSidePanelQueryBridge`（fs-watch `.spherse/project.yaml` 变更 → invalidate custom-side-panel query；重连补偿 → 同上），挂 `ProjectRuntimeBridges`。独立于 `WelcomePageQueryBridge` 不合并——两个订阅者互不冲突，等出现第三个 project.yaml 消费者时再统一收敛 |
| 加载失败态 | iframe `onError` → 面板内占位文案（`custom-side-panel.loadFailed`）；query `isError` 视同 `path: null` 回落默认内容，同欢迎页处理 |
| i18n | 新 key（zh-CN / zh-TW / en，实现时加载 i18n skill）：`side-panel-settings.{title,description,pathLabel,pathPlaceholder,saved,saveFailed,loadFailed,invalidPath,clear}`、`activity-bar.settings.sidePanel`、`activity-bar.showCustomSidePanel` / `activity-bar.hideCustomSidePanel`（带 Custom 前缀避免与 `activity-bar.pinSidePanelTooltip` 的「项目面板 = 整个左栏」语义混淆）、`custom-side-panel.{loadFailed,exitTooltip}` |
| Agent 工具 | 本期不给 `manage-project-config` 加 `update_side_panel` action；如需 agent 代配置后续单独补（与 UI 走同一 PM 门面，成本极低） |

## 契约

```ts
// @spherse/core ProjectConfig
sidePanel?: { path: string };

// @spherse/contracts schemas
sidePanelSettingsRequest: { path: string | null };
sidePanelSettingsResponse: { ok: boolean; path: string | null };

// server
GET /api/projects/:projectId/settings/side-panel  → { ok, path }
PUT /api/projects/:projectId/settings/side-panel  body { path } → { ok, path }
```

## 影响面

- `packages/core`：`src/types.ts`（`ProjectConfig.sidePanel`）、`src/store/project-config.ts`（normalize + getter/updater）、`src/project-manager.ts`（门面）
- `packages/contracts`：`src/settings.ts`（schema + Static 类型导出）
- `packages/server`：`src/routes/settings.ts`（两条路由）
- `packages/app`：
  - `src/lib/api.ts`（`getSidePanelSettings` / `updateSidePanelSettings` client 方法）
  - `src/queries/keys.ts`（`customSidePanel`）、`src/queries/custom-side-panel.ts`（新）
  - `src/stores/custom-side-panel-store.ts`（新）
  - `src/features/custom-side-panel/index.tsx`（`CustomSidePanel` 组件，新）、`CustomSidePanelQueryBridge.tsx`（新）
  - `src/features/project-panel/index.tsx`（视图二选一）
  - `src/features/project-settings/side-panel-settings/index.tsx`（dialog，新）
  - `src/features/activity-bar/index.tsx`（菜单项 + dialog 挂载）
  - `src/layouts/ProjectRuntimeBridges.tsx`（挂 bridge）、`src/layouts/project-lifecycle.ts`（关闭级联加 `clearProject`）
- `packages/i18n`：三个 locale 新 key
- 文档：`docs/official/data-conventions.md`（project.yaml 字段表 + 校验条目）、`docs/official/project-structure.md`（新增文件/目录）、`docs/official/architecture/frontend.md`（bridge 清单 / feature 清单 / store 说明，如涉及）

## 测试

- core `__tests__/store/project-config.test.ts`：新增 sidePanel 用例——合法 html/htm 规范化写入、拒绝图片扩展名 / 绝对路径 / `..` / `.spherse/**`、`null` 清除字段、YAML 往返持久化
- contracts `__tests__/api-contracts.test.ts`：side-panel null path 过 Fastify body coercion 平价用例（仿 welcome-page 既有用例，防 Union([Null, String]) 被 coercion 吞掉）
- server `__tests__/settings-side-panel.test.ts`（新）：真实 `assembleProject`（临时目录 + silent logger）+ fastify inject，GET 默认 null、PUT 合法路径落盘 project.yaml、PUT 非法路径 4xx、PUT null 清除——不 mock 被测门面（契约红线）
- app `stores/custom-side-panel-store.test.ts`：默认未激活、toggle、per-project 隔离、localStorage 持久化与初始化读取、`clearProject`
- app `features/custom-side-panel/CustomSidePanel.test.tsx`：iframe 渲染（src 构造、透明无 bg）、fs-watch 防抖 reload（仿 `WelcomePage.test.tsx`）、path 为 null 时由 ProjectPanel 负责不渲染（组件自身不处理）
- app `CustomSidePanelQueryBridge.test.tsx`：project.yaml 变更触发 invalidate（仿 `WelcomePageQueryBridge.test.tsx`）
- app 既有结构测试的联动更新：`ProjectRuntimeBridges.structure.test.ts` 挂载清单追加 `CustomSidePanelQueryBridge`；`project-lifecycle.test.ts` 级联断言补 `useCustomSidePanelStore`（`project-lifecycle.structure.test.ts` 的自动发现机制会强制新增 store 进入级联）
- 手动验收：配置 → 激活 → 编辑 HTML 实时刷新 → 清除配置自动回落 → 重启后激活态保留

## 已知限制

- iframe `onError` 占位分支实际几乎不可达：浏览器对 iframe 的 HTTP 失败（404/500）不派发元素 error 事件——该写法自 WelcomePage 同构继承。文件配置后被删除的场景，iframe 内显示 preview 404 页而非回落默认面板（query 缓存不因目标文件删除而失效）；用户可通过角落按钮手动退出。长期可改为 reload 后探活 fetch 再决定回落
- iframe 激活时 ProjectPanel 整区被页面占据，面板自身的右键菜单（全局搜索）在该状态下实际不可达（iframe 吞事件）；依赖头像右键菜单与角落按钮
- web host 无设置入口（`content.editable: false`，Settings 子菜单不渲染），仅能切换显示；窄视口（`useIsMobile` 为视口断点，非仅移动设备）抽屉中 iframe 视图同样生效，260px 宽度下体验未专门优化
- iframe 沙箱允许 `allow-same-origin`（preview 路由同源、SDK 需要），页面 JS 可发起对本地 server 的已认证请求——与欢迎页风险面一致，不新增
- 激活态按 projectId 记忆在 localStorage（per-device）；项目目录被复制到新 id 后需重新激活；非正常退出（无关闭级联）时已关闭项目的 stale 条目会残留在 map 中（体积极小，无害）
