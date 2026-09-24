# 内容区多标签页（Content Tabs）设计

- 日期：2026-09-24
- 状态：已实施

## 背景与目标

项目内右侧内容区（`ProjectScope` 的 `<main>`）目前一次只显示一个路由页面（欢迎页 / chat / 文件 / 内置浏览器），切换靠侧栏重新点选。新增多标签页：

- tab bar 位于右侧内容区顶部（`<main>` 内、`<Outlet/>` 之上），桌面与移动端均显示
- 欢迎页固定为第一个 tab，无关闭按钮、不可拖拽
- 打开 chat / 文件 / 内置浏览器页时新增 tab（类别 icon + 名称）；目标已有 tab 时只激活不新增
- tab 列表按项目持久化：切换项目、重启 app 后恢复
- 非活跃 tab 不保持渲染：tab = 链接，点击即 `navigate` 到该 tab 的 URL
- 全局设置可开关，默认开启；关闭后隐藏 tab bar 且不再记录，已记录列表保留，重新开启时恢复

## 已确认的产品决策

1. 默认开启（web 端无设置 UI，只能用默认值）
2. 移动端（<768px）同样显示 tab bar（横向滚动）
3. 功能开启时，chat / 文件页 header 的 X 按钮 = 关闭当前 tab
4. 内置浏览器路由（`/browser?url=`）也开 tab，按 url 去重；页内地址栏导航替换当前 tab 而非新开
5. 文件编辑态有未保存改动时切换 / 关闭 tab：弹现有「放弃修改」确认
6. 附加交互：仅拖拽排序（移动端禁用）；不做中键关闭、右键菜单
7. 功能关闭时保留已记录 tab 列表

## 决策

| 决策点 | 结论 |
|---|---|
| tab 来源 | **由路由派生**：`TabRouteBridge`（挂 `ProjectRuntimeBridges`）监听 location，当前路由解析为 tab target 时 upsert。现有 ~20 处 `navigate(...)` 打开 chat/file 的调用点零改动，天然满足「已打开则跳转」 |
| 活跃 tab | 不存储，由当前路由计算（`routeTabKey`）。上次活跃 tab 由既有 `lastRoute` 机制恢复，无需重复持久化 |
| 状态位置 | `stores/tabs-store.ts`（app 级）：被 tab bar、pages、文件侧栏多方写入，不属单一 feature；只存 target 与顺序，不存标题（服务端真相在 Query） |
| 持久化 | localStorage 单 key `spherse:tabs`，`Record<projectId, TabTarget[]>`，每次变更写回；加载时逐项校验结构，非法项丢弃（同 floating-content-browser 模式）。`clearProject` 进 `closeProjectCascade` |
| tab 身份 | `chat:<sessionId>` / `file:<path>` / `browser:<url>`；welcome 为虚拟 tab，不入存储，恒在首位 |
| 新 tab 位置 | 追加到末尾 |
| 关闭非活跃 tab | 直接从 store 移除 |
| 关闭活跃 tab | 选邻居（右侧优先，否则左侧，否则 welcome）→ `navigate(neighborUrl, { state: { closeTab: key } })`；bridge 在导航**实际发生后**看到 `state.closeTab` 才移除。这样未保存编辑的 blocker 取消导航时 tab 不会被误删。bridge 处理后以 `replace` 导航清空该 entry 的 state，防止前进/后退回到同一 entry 时重复处理 |
| 浏览器页内导航 | `BrowserPageView.onNavigate` 带 `state: { replaceTab: true }`；bridge 若见该标记且上一路由 tab 为 browser tab，则原位替换（新 url 已有 tab 时删除旧的、激活已有） |
| 功能关闭 | `TabBar` 返回 null、bridge 不 upsert / 不处理 state；header X 回到原行为（回欢迎页） |
| chat 标签名 | 优先读 session catalog（`useProjectSessions`，与侧栏同源，自动标题 / 改名即时同步）；catalog 无此 session（分页外的旧会话）时才启用 `useProjectSession` 查询，避免 N 个 tab 各自触发 probe。无标题时 fallback 与 `SessionRow` 相同（`updatedAt` 本地时间串），抽共享函数 `sessionDisplayTitle` 到 `lib/` |
| chat tab 失效 | catalog 无且 session 查询成功返回 `null` → 该 tab 自动移除（覆盖侧栏删除会话、删除智能体后的会话） |
| 文件标签名 | 去扩展名的 basename（`lib/file-name.ts` `fileDisplayName`，与 chat 快捷链接按钮共用；点文件 / 无扩展名保持原样），`title` 为全路径 |
| 文件 tab 失效 | 侧栏文件树删除时（`UserFilePanel` / `SkillPanel` `handleFileDeleted`）调用 store `closeFileTabs(projectId, path)`，按「相等或 `path + "/"` 前缀」匹配（同现有 handleFileDeleted 规则，均为项目相对路径字符串，不涉及文件系统解析）。外部删除不追踪，打开时由内容页显示错误 |
| 浏览器标签名 | `host + pathname`，`title` 为完整 url |
| icon | lucide：welcome `HouseIcon`、chat `MessageSquareIcon`、文件 `FileIcon`、浏览器 `GlobeIcon` |
| 未保存编辑守卫 | `ContentBrowser` 改用 react-router `useBlocker`（`createHashRouter` 为 data router，可用）：`isDirty` 且 pathname/search 变化即拦截，复用现有 leave 确认框，确认 → `blocker.proceed()`，取消 → `blocker.reset()`。Back / Close 按钮不再走 `requestLeave`，直接导航交给 blocker，避免双重确认。副作用（改进）：侧栏点选、切项目等任何离开都受保护 |
| header X | pages 通过 `useCloseActiveTab()` 取关闭函数：功能开启 → 关闭当前 tab；关闭 → 原 fallback（回欢迎页）。浏览器页无 X，只有 Back，不改 |
| 拖拽排序 | 原生 HTML5 DnD（不引依赖），仅非 welcome tab 之间；`useIsMobile()` 时 `draggable={false}` |
| 溢出 | tab bar `overflow-x-auto`，活跃 tab 变化时 `scrollIntoView({ inline: "nearest", block: "nearest" })` |
| 主题钩子 | 新增 `data-tab-bar`、`data-tab`（带 `data-active`），按 theming 同步契约检查两个 theme skill |

## 契约

### HostSettings / AppSettings

```ts
tabsEnabled?: boolean; // 缺省视为 true
```

- core `AppSettings`、app `HostSettings` 加字段
- desktop `electron/settings.ts`：`getMaskedSettings` 输出 `tabsEnabled ?? true`；`saveSettings` merge `incoming ?? prev ?? true`
- web：整对象写 localStorage，settings-store 各 setter 回写全字段即可
- settings-store：`tabsEnabled` 默认 `true`，`loadLocale` 读取，新增 `setTabsEnabled`，其余 setter 回写 `tabsEnabled`

### localStorage `spherse:tabs`

```ts
type TabTarget =
  | { kind: "chat"; sessionId: string }
  | { kind: "file"; path: string }
  | { kind: "browser"; url: string };
type Persisted = Record<string /* projectId */, TabTarget[]>;
```

## 各层实现

### `stores/tabs-store.ts`

```ts
byProject: Record<string, TabTarget[]>
openTab(projectId, target)                 // 幂等，追加末尾
replaceTab(projectId, oldKey, target)      // 原位替换；target 已存在则删 oldKey
closeTab(projectId, key)
closeFileTabs(projectId, path)             // 相等或前缀
moveTab(projectId, fromKey, toKey)
clearProject(projectId)
```

纯函数放 `lib/tab-target.ts`，供 store、pages、feature 共用。

### `lib/tab-target.ts`

- `tabKey(target)`、`tabUrl(projectId, target)`、`isTabTarget(value)`（持久化校验）
- `pickNeighborKey(keys, closingKey): string | null`（右优先、左次之、null = welcome）

### `features/tabs/`

- `TabRouteBridge.tsx`：`useMatch` 解析 chat / content / browser 路由 + `useSearchParams` → 当前 target；处理 `state.closeTab` / `state.replaceTab`；功能关闭时不执行
- `use-route-tab.ts`：`useRouteTabTarget()` 返回当前路由 target（bridge 与 bar 共用）
- `TabBar.tsx`：welcome tab + 列表；拖拽；滚动到活跃项；功能关闭返回 null
- `TabShell.tsx` / `TabItems.tsx`：按 kind 渲染 icon + label + 关闭按钮（`aria-label` / `title`），`role="tab"`、`aria-selected`
- `use-chat-tab-info.ts`：chat 标题解析与失效判定（ChatTab 内移除）
- `use-tab-actions.ts`：`closeTab` / `useCloseActiveTab(fallback)` / `useCloseDeletedFileTabs`
- `use-visible-tabs.ts`：bar 与邻居选择共用的可见列表（browser feature 关闭时过滤）
- `index.ts`：导出 `TabBar`、`TabRouteBridge`、`useCloseActiveTab`

### 接入点

- `ProjectScope`：`<main>` 内 `<TabBar />` 置于 `<Outlet/>` 之上（ProjectScope 无新增 state，满足 structure test）
- `ProjectRuntimeBridges`：`<TabRouteBridge />`
- `project-lifecycle.ts`：`useTabsStore.getState().clearProject(projectId)`
- `ChatPage` / `ContentBrowserPage`：`onClose` 改用 `useCloseActiveTab`
- `BrowserPageView`：`onNavigate` 带 `replaceTab` state
- `UserFilePanel` / `SkillPanel`：`handleFileDeleted` 调 `closeFileTabs`
- `ContentBrowser`：`useBlocker` 守卫（新 hook `useLeaveGuard(isDirty)`），`useContentEditor` 移除 `requestLeave` / `confirmLeave` / `showLeaveConfirm`
- settings General 页：`tabsEnabled` Switch
- i18n：`tabs.welcome`、`tabs.close`、`tabs.loading`、`settings.contentTabs`、`settings.contentTabsDesc`（`settings.tabs.*` 已被设置页 tab 名占用）

## 测试

- `lib/tab-target.test.ts`：key / url 往返、校验、`pickNeighborKey`
- `stores/tabs-store.test.ts`：幂等 open、replace（含目标已存在）、close、closeFileTabs 前缀、move、持久化读写 / 非法数据、clearProject
- `features/tabs/TabBar.test.tsx`：路由派生新增 tab、重复打开不新增、点击切换、关闭活跃 tab 跳邻居、welcome 无关闭按钮、功能关闭不渲染
- `stores/settings-store.test.ts`：`tabsEnabled` 默认 / 读取 / 回写
- `desktop/electron/settings.test.ts`：merge 保留 `tabsEnabled`
- E2E：新增 `content-tabs.spec.ts`（打开 chat 与文件生成 tab、重复点击不新增、关闭、重启恢复）；受影响 `project-close.spec.ts`、`file-tree.spec.ts`、`agent-list.spec.ts` 回归

## 风险

- `useBlocker` 同一时刻只允许一个 blocker；目前仓库无其他 blocker
- 浮窗 content browser 不走 `ContentBrowser` 组件，不受 blocker 影响（已确认 `<ContentBrowser` 仅在 `ContentBrowserPage` 使用）
- 主题模板里若有针对 `<main>` 首子元素的选择器，tab bar 插入会影响；检查 theme skill

## Design review 处理

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| 1 | important | 浮窗 session 的 chat tab 点击后被 `FloatingChatManager` 弹回欢迎页 | bridge 不为当前浮窗 session upsert；浮窗 session 变化时移除其 chat tab |
| 2 | important | `BrowserPage` 会拒绝的 url / feature 关闭时产生伪 tab | route target 解析复用 `useFeature("browser")` + `isLoopbackUrl`；bar 在 feature 关闭时过滤 browser tab；`isTabTarget` 拒绝空值 |
| 3 | important | catalog 加载中所有 chat tab 各自触发 session probe | 仅 catalog 加载成功且不含该 session 时启用 `useProjectSession` |
| 4 | important | 删除智能体后其 session 查询仍缓存（staleTime ∞），tab 不失效 | `use-tab-label`：agents 已加载且 session 的 agent 不存在 → 移除 tab |
| 5 | important | 关闭 / 切换项目时 blocker 拦截导致悬空 | blocker 对 `state.skipLeaveGuard` 放行，关闭项目导航携带；`handleSelectProject` 不再预先 `setActiveProject`（ProjectScope effect 已按 URL 同步） |
| 6 | medium | 关闭 tab 后 Back 又重开 | 关闭导航用 `replace: true`，并从 project nav stack 移除该 URL |
| 7 | medium | `back()` 先 pop 后导航，被拦截取消后 stack 失步 | 改为记录 pending back target，location 实际到达后再 pop |
| 8 | medium | `replaceTab` 依赖 ref，前进后退重复应用 | state 显式携带 `replaceTab: oldKey`；bridge 处理后 replace 清空 state |
| 9 | medium | 浏览器页转浮窗后 tab 残留 | 转浮窗走关闭当前 tab |
| 10 | medium | `useBlocker` 在 `MemoryRouter` 测试中抛错 | `renderWithProviders` 增加 data router 选项；新增 `useLeaveGuard` 测试 |
| 11 | medium | settings 加载前默认 true 导致关闭态也被记录 | settings-store 增加 `loaded`，bridge / bar 在 loaded 后才生效 |
| 12 | medium | 删除打开中的文件：回欢迎页而非邻居、dirty 时误弹确认 | 新 hook `useCloseDeletedFileTabs`：移除匹配 tab，活跃被删则 `replace` 跳邻居并 `skipLeaveGuard`；bridge 只响应 location 变化 |
| 13 | minor | theming 文档 / skill 表 | 同步 `theming.md` 可主题化入口表与 `spherse-create-ui-theme` skill |
| 14 | minor | structure test | `ProjectRuntimeBridges.structure.test.ts` 加 `TabRouteBridge` |
| 15 | minor | a11y：tab 内嵌按钮 | `role="tablist"` 容器，关闭按钮为 tab 按钮的兄弟节点 |
| 16 | minor | key 未规范化致重复 | browser 用 `new URL(url).href`；file 去 `./` 前缀、`\` → `/` |
| 17 | minor | `spherse:tabs` 不清理已消失项目 | 暂不修：体积小，项目重新打开时仍可复用 |
| 18 | minor | 重新开启后当前页无 tab | bridge effect 依赖含 `enabled` |
| 19 | minor | 缺失 session 短暂出现伪 tab | 接受：label hook 返回 null 后自动移除 |
| 20 | minor | 文档说明 | 关闭项目同 `lastRoute` 一起清除 tab；E2E 回归补 `floating-chat` / `floating-content-browser` |
| 21 | minor | `isLoopbackUrl` 从 browser feature index 导入 | 采纳 |

## Code review 处理

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| I-1 | important | official 文档 / theme skill 未同步 | 已修：frontend.md、project-structure.md、theming.md、desktop.md、glossary.md、`spherse-create-ui-theme` skill |
| M-1 | medium | 删除打开中的文件后 Back 回到已删文件并重建 tab | 已修：`closeDeletedFileTabs` 以路径段匹配把受影响 content URL 清出 nav 栈 |
| M-2 | medium | `skipLeaveGuard` 滞留 history entry，POP 时绕过守卫 | 已修：守卫仅对非 POP 导航认该标记 |
| M-3 | medium | 浏览器页内导航后 Back 追加重复旧 url tab | 已修：页内导航改 `replace` 并携带 `closedUrl`，bridge 清出 nav 栈 |
| M-4 | medium | browser feature 关闭时邻居可能选中隐藏 tab | 已修：`useVisibleTabs` 供 bar 与邻居选择共用 |
| M-5 | medium | 分页外旧会话 tab 各自拉全量列表 | 未修：入 backlog「批量解析分页外会话的 tab 标题」 |
| m-1 | minor | design 文本与实现不一致 | 已修（本文） |
| m-2 | minor | tabs-store 注释 | 已修 |
| m-3 | minor | 未使用导出 | 已修 |
| m-4 | minor | 拖拽指示条物理方向 / arbitrary value | 已修：`before:start-0` 逻辑属性 |
| m-5 | minor | a11y：tablist 内关闭按钮、隐藏滚动条 | 部分修：恢复滚动条；关闭按钮保持为 tab 兄弟节点（主流编辑器同款），暂不做方向键 roving |
| m-6 | minor | settings 加载失败时功能被静默关闭 | 已修：失败也置 `loaded` |
| m-7 | minor | E2E 未覆盖 chat tab / 真重启 | 未修：chat tab 由组件测试覆盖；reload 已重建 store 模块，与重启的 localStorage 路径一致 |
| m-8 | minor | bridge effect 依赖整个 `location` | 未修：effect 幂等，location 每次导航本就更新 |

## 后续调整（用户反馈）

1. 文件 tab 不显示扩展名：抽 `lib/file-name.ts`（`fileBasename` / `fileDisplayName`），chat Header 快捷链接按钮同步改用
2. 移动端 + 标签页开启 + HTML 文件时隐藏 ContentBrowser header（HTML 多为自带完整界面的页面，移动端纵向空间有限，切换 / 关闭交给 tab）；判定在 `features/content-browser/index.tsx` 内，按用户要求加注释说明。副作用：该场景下无编辑 / 源码切换入口（移动端 web 本就只读）
