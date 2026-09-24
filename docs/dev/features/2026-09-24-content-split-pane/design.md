# 内容区分窗（Content Split Pane）设计

- 日期：2026-09-24
- 状态：已实施

## 背景与目标

项目内容区（`ProjectScope` 的 `<main>`）一次只渲染一个路由页面（欢迎页 / chat / 文件 / 内置浏览器）。新增分窗：把一个文件固定在内容区右侧，左侧照常切换 tab / 路由，典型场景是「左边与 Agent 对话、右边对照文件」。

- content browser header 编辑按钮旁新增「分窗」按钮；文件树文件右键菜单新增「分窗」/「取消分窗」
- 右侧分窗默认占内容区一半，中间分隔条可拖拽调整左右宽度
- 分窗状态（文件 + 比例）按项目持久化：切换项目、重启 app 后恢复
- 右侧分窗 header 无返回按钮，点关闭按钮即结束分窗
- 右侧分窗只读

## 已确认的产品决策

1. header 分窗 = **移动**：文件进入右侧分窗，左侧关闭该文件 tab 并切到邻居（等同点 header X）；右键菜单分窗时若该文件正是左侧当前路由文件，同样移动
2. 右侧分窗**只读**：无编辑按钮；保留复制路径、刷新、查找、HTML 预览/源码切换、划词发起会话、关闭
3. 只有一个分窗；再次分窗其他文件 = 替换右侧文件
4. 宽度比例按项目保存
5. 分窗与浮窗互不影响，同一文件可同时浮窗与分窗
6. 仅 Electron 开放（web 暂不开放）；移动端宽度（<768px）不显示入口、不渲染分窗（持久化状态保留）
7. 恢复划词「发送至当前会话」：左栏当前路由为 chat 时，该 session 作为「当前会话」出现在划词弹窗中。该功能由 `681461a` 引入，当时 content browser 与 chat 同屏，「当前会话」取自 URL；后续路由重构使 content 与 chat 成为互斥路由，`ContentBrowserPage` 只组装浮窗会话，该入口再也不会出现。分窗重新提供了「文件与 chat 同屏」的场景

## 决策

| 决策点 | 结论 |
|---|---|
| 布局层级 | 分窗属于项目层，与路由解耦：`<main>` 内容包进横向 `SplitLayout`，左栏 = `TabBar` + `<Outlet/>`，右栏 = 分窗。TabBar 只覆盖左栏 |
| 左栏稳定性 | 左栏**始终**包在同一个 `<div data-split-main className="flex min-w-0 flex-1 flex-col">` 里，有无分窗只增减其后的分隔条与右栏兄弟节点。否则开 / 关分窗会改变 `<Outlet/>` 的树位置 → 左侧页面整体重挂载（未保存编辑、chat 滚动、iframe 全部丢失）。`SplitLayout` 测试覆盖「开关分窗后左侧子组件 state 保留」 |
| 右侧组件 | 不复用 `ContentBrowser`（它内含 `useContentEditor` 与 `useLeaveGuard` → `useBlocker`，router 同一时刻只允许一个 blocker）。content-browser feature 新增只读组合组件 `ReadOnlyContentBrowser`：复用 `Header`、`ContentView`、`TextSelectionSession`、`useContentFile`，不挂编辑器与 blocker |
| 视图状态复用 | `ContentBrowser` 中 htmlView / refreshKey（含 `dataUpdatedAt` effect）/ findOpen / `handleRefresh` / `classifyFileKind` / `findable` 抽为 content-browser 内部 hook `useContentViewState`，两个组件共用，避免复制 |
| Header 差异 | `onBack`、`onSplit` 可选，不传不渲染（返回按钮连同外层 wrapper 一起省略，避免空 flex 项 + gap）。编辑相关 props 收为可选分组 `editing?: { isDirty; isEditing; isEditable; saving; onEnter; onCancel; onSave }`，右侧不传。左侧页仅在可用时传 `onSplit`；右侧 X = 结束分窗 |
| 右侧链接跳转 | `ContentView` 新增可选 `onOpenFile(path)`：传入时内部 md 链接调用它而不 `navigate`；右侧用它替换分窗文件。浮窗与左侧不传，行为不变 |
| 状态位置 | `features/split-pane/store.ts`（feature-local）。其他 feature（pages、user-file-panel）只经 split-pane 导出的命令 / selector hook 访问 |
| 持久化 | localStorage 单 key `spherse:content-split`，`Record<projectId, { filePath: string; ratio: number }>`；每次变更写回；加载时逐项校验（filePath 非空字符串、ratio 为有限数且 0 < ratio < 1），非法项丢弃。`clearProject` 进 `closeProjectCascade` |
| 结束分窗时比例 | 关闭即删除该项目条目（含 ratio），下次分窗回到 0.5。保持状态模型最简；如需记住比例后续再拆 |
| 打开分窗 API | `useOpenSplit(): (filePath) => void`，`projectId` 取自 `useProjectCtx`。「当前路由即该文件」用 `useMatch` content 路由 + `useSearchParams` 判定（不手写解析） |
| 移动语义 | 目标不是左侧当前文件 → 直接 `openSplit`。目标是左侧当前文件 → **不先写 store**，改为走关闭当前 tab 的导航并在 nav state 附带 `openSplit: path`；由 `SplitRouteBridge`（挂 `ProjectRuntimeBridges`）在 location 实际到达后提交 `openSplit` 并以 `replace` 清 state（同 `TabRouteBridge` 处理 `closeTab` 的时序）。这样左侧有未保存编辑（右键菜单入口不受 header 编辑态隐藏保护）时，blocker 取消 → 分窗不会打开，不会出现左右同文件且右侧过期。tabs 关闭时 fallback 为回欢迎页（同 header X），并 `dropFromProjectNavHistory` 该 URL，避免 Back 把文件重开到左侧。需要 `use-tab-actions` 的关闭动作支持附加 nav state，由 tabs 导出窄命令 hook |
| 文件失效 | 两条路径：① 侧栏删除：`UserFilePanel` 的 `onDeleted` 组合 tabs 的 `useCloseDeletedFileTabs` 与 split-pane 的 `useCloseDeletedSplit`（`isPathAtOrUnder`，删父目录同样关闭）；② 外部删除 / 重启时文件已不存在：`useContentFile` 暴露 `notFound`（仅 HTTP 404），右栏 `notFound` 时自动结束分窗。**其他错误（5xx、401、网络、服务端重连中）不关闭**，保留错误 + 刷新按钮，避免误删用户刻意保留的布局。注意 TanStack Query refetch 失败时保留旧 `data`，故判定不依赖 `content === null` |
| 404 判定 | `ApiClient` 新增 `readContent(path)`：非 ok 时抛 `ApiError(status)`；`useContentFile` 改用它，404 映射为原 `"File not found"` 文案并置 `notFound`。既有 `getContent`（null 语义）不变，UI SDK `content.get`、链接存在检查、`reloadFromDisk` 不受影响 |
| 分隔条 | 新 hook `useSplitDivider`：pointer capture 拖拽（写法参考 `components/floating-frame/use-resize.ts`），拖动中更新本地 ratio，pointerup 提交 store；`projectId` 变化时重置本地 ratio。双击恢复 0.5。键盘：`role="separator"`、`tabIndex=0`、`aria-orientation="vertical"`、`aria-valuemin/max/now`（0-100）、`aria-controls` 指向右栏，方向键按 5% 步进；RTL 下拖拽方向与方向键翻转 |
| 最小宽度 | 渲染时也 clamp，不只在拖拽中：`ResizeObserver` 取容器宽度，纯函数 `clampRatio(ratio, containerWidth)` 保证左栏 ≥ `SPLIT_MIN_MAIN_WIDTH`（400px，左栏承载 chat）、右栏 ≥ `SPLIT_MIN_PANE_WIDTH`（320px）；容器过窄时回落 0.5。两栏均 `min-w-0`。窗口缩放、side panel pin/unpin 都会触发重算 |
| 拖动与 iframe | pointer capture 已保证拖动事件路由到分隔条；额外在 `SplitLayout` 置 `data-dragging`，用 Tailwind 任意变体让两栏 iframe `pointer-events-none` 兜底（不新增原生 CSS class） |
| Cmd+F 冲突 | `ContentView` 现有 `window` 级 Cmd+F 会让左右（以及已存在的浮窗）同时打开查找。content-browser 内新增模块级 `find-scope` + `useFindScope(rootRef, open)`：由 `ContentBrowser`、`ReadOnlyContentBrowser`、浮窗容器在**整个容器根节点**（含 header）注册，`pointerdown` / `focusin` 时成为 active；Cmd+F 只由 active scope 响应；active 卸载后回落到最近注册者。导出测试用 reset。顺带修复浮窗与主视图同时打开查找的既有问题 |
| 锚点跳转 | `document.getElementById` 改为在 `ContentView` 滚动容器内按 `id` 查找，避免左右打开同一文件时滚错侧（`resolveMarkdownLink` 已对锚点 decode） |
| 多个划词实例 | `useTextSelection` 在 `document` 上监听 mouseup / keydown，选区不在自身容器内时当前实现直接 return 而不清空，左右各选一次会残留两个工具栏。改为选区在容器外时 `setSelectionState(null)`；补双实例测试 |
| 划词发起会话 | `ContentBrowserPage` 中 `activeSessions` 组装与 `handleStartSession` 抽到 text-selection-session feature 导出的 `useSelectionSessionHandlers()`，页面与右侧分窗共用；右侧发起后左侧导航到新 chat。左侧有未保存编辑时 blocker 会拦截该导航（会话已创建，可从侧栏进入），接受此行为 |
| 当前会话 | `useSelectionSessionHandlers()` 组装 `activeSessions`：① 左栏路由会话——`useMatch("/project/:projectId/chat/:sessionId")` 命中时加入 `{ floating: false }`（显示「发送至当前会话」）；② 浮窗会话（`floating: true`，同现状）。按 sessionId 去重，左栏会话在前。发送走既有 `sendMessage` action；左栏会话已可见，传 `open: false` 避免对同一 URL 重复 `navigate` 压入历史。左栏为 content 页时①不命中，行为与现状一致 |
| 右栏 key | `key={\`${projectId}:${filePath}\`}`：`ProjectScope` 跨项目不重挂载，避免两项目分窗同名文件共享组件 state |
| side panel click-away | `<main>` 的 `clickAwayProps` 对右栏与分隔条同样生效（点击收起 hover 展开的 side panel），与左栏一致，不做特殊处理 |
| 开关 | `feature-registry` 新增 `"content-split-pane": ELECTRON_ONLY`；`useSplitPaneAvailable()` = feature 开启 && `!useIsMobile()`，控制入口、渲染 |
| 主题钩子 | 新增 `data-split-pane`（右栏根）、`data-split-divider`（分隔条，带 `data-dragging`）。右栏内部复用 `data-content-browser`，项目主题对 content browser 的定制自动生效 |

## 契约

### localStorage `spherse:content-split`

```ts
interface SplitPaneState {
  filePath: string;
  ratio: number; // 右栏占内容区宽度比例，默认 0.5
}
type Persisted = Record<string /* projectId */, SplitPaneState>;
```

## 各层实现

### `features/split-pane/`

- `store.ts`：`useSplitPaneStore`

  ```ts
  byProject: Record<string, SplitPaneState>
  openSplit(projectId, filePath)        // 已有条目则只替换 filePath，保留 ratio
  closeSplit(projectId)
  closeDeletedSplit(projectId, path)    // isPathAtOrUnder 匹配
  setRatio(projectId, ratio)
  clearProject(projectId)
  ```

- `layout.ts`：常量 `SPLIT_DEFAULT_RATIO`、`SPLIT_MIN_MAIN_WIDTH`、`SPLIT_MIN_PANE_WIDTH`，纯函数 `clampRatio`
- `use-split-divider.ts`：拖拽 / 双击 / 键盘 / RTL
- `SplitLayout.tsx`：`children` 为左栏，始终包在 `data-split-main` 中；可用且当前项目有分窗时追加分隔条 + `SplitPaneView`
- `SplitPaneView.tsx`：读 store → `ReadOnlyContentBrowser`（`key={projectId:filePath}`），`onClose` = `closeSplit`，`onOpenFile` = `openSplit`，`notFound` 时 `closeSplit`
- `SplitRouteBridge.tsx`：location 到达后处理 nav state `openSplit`
- `hooks.ts`：`useSplitPaneAvailable()`、`useOpenSplit()`、`useSplitFilePath()`（右键菜单判断「取消分窗」）、`useCloseSplit()`、`useCloseDeletedSplit()`
- `index.ts`：导出 `SplitLayout`、`SplitRouteBridge` 与上述 hooks

### `features/content-browser/`

- `Header.tsx`：`onBack?`、`onSplit?`、`editing?` 分组；分窗按钮为 icon 按钮（`Columns2Icon`，`title` / `aria-label`），位于编辑按钮之前，编辑态隐藏
- `ContentBrowser`：透传 `onSplit?`，改用 `useContentViewState`、`useFindScope`
- `ReadOnlyContentBrowser.tsx`（新）：`filePath`、`onClose`、`onOpenFile`、`notFound` 回调，自取 `useContentFile`、`useContentViewState`、划词 handlers；导出于 `index.ts`
- `hooks/useContentViewState.ts`（新）
- `hooks/useContentFile.ts`：改用 `readContent`，暴露 `notFound`
- `ContentView.tsx`：`onOpenFile?`、锚点限定容器、Cmd+F 经 `find-scope` 判定
- `ContentBody.tsx`（新）：`TextSelectionSession` + `ContentView` 组合，左右共用；`TextSelectionSession` 自取 `useSelectionSessionHandlers()`，不再由页面透传 agents / activeSessions / onStartSession
- `find-scope.ts`（新）：模块级 scope 注册表 + `useFindScope()`；`FindScopeRoot.tsx`（新）：容器根 + context（组件卸载即注销，无需测试 reset）
- 浮窗容器 `FloatingContentBrowserContainer` 接入 `useFindScope`（经 content-browser 导出）

### 其他

- `lib/api.ts`：`readContent(path)`（抛 `ApiError`）
- `text-selection-session`：`useSelectionSessionHandlers()`（含左栏当前会话）；`StartSessionPopover` 发送时 `open: false`；`useTextSelection` 容器外选区清空
- `tabs`：关闭当前 tab 的命令 hook 支持附加 nav state（`openSplit`），fallback 分支 `dropFromProjectNavHistory`
- `lib/nav-state.ts`：`NavState.openSplit?: string`

### 接入点

- `ProjectScope`：`<main>` 内容包进 `<SplitLayout>`（无新增 state，满足 structure test）
- `ProjectRuntimeBridges`：`<SplitRouteBridge />`（同步 structure test）
- `ContentBrowserPage`：`onSplit`（仅 `useSplitPaneAvailable()` 时）= `useOpenSplit()(filePath)`；划词改用 `useSelectionSessionHandlers()`
- `FileTreeContextMenu` / `file-tree-context` / `FileTreeNode` / `FileTree`：新增可选 `onSplitFile`、`splitFilePath`，文件项菜单在浮窗项后显示「分窗」/「取消分窗」（只读树无右键菜单，Electron 下 `canMutate` 恒为 true，不受影响）
- `UserFilePanel`：可用时传入（skill panel 不传）；`onDeleted` 组合 `useCloseDeletedFileTabs` 与 `useCloseDeletedSplit`
- `project-lifecycle.ts`：`useSplitPaneStore.getState().clearProject(projectId)`（同步 structure test 显式清单）
- `feature-registry.ts`（+ test）
- i18n（zh-CN 带注释，同步 en / zh-TW）：`content-browser.split`、`file-tree.split`、`file-tree.cancelSplit`、`split-pane.resize`（分隔条 aria-label）

### 文档同步

- `docs/official/architecture/frontend.md`：localStorage 清单加 `spherse:content-split`；feature 列表加 split-pane；`ProjectScope` 布局描述
- `docs/official/architecture/theming.md`：可主题化入口表加 `data-split-main` / `data-split-pane` / `data-split-divider`
- `spherse-create-ui-theme` skill：新增钩子；`data-tab-bar` 描述改为「左栏顶部」
- `docs/official/project-structure.md`：新 feature 目录、content-browser 新文件、新 E2E spec

## 测试

- `features/split-pane/store.test.ts`：open / 替换保留 ratio / close / closeDeletedSplit（相等、父目录、无关路径）/ setRatio / 项目隔离 / 持久化读写与非法数据（含 ratio 越界）/ clearProject
- `features/split-pane/layout.test.ts`：`clampRatio` 边界（左右最小宽度、过窄回落）
- `features/split-pane/SplitLayout.test.tsx`：无分窗只渲染左栏；**开关分窗后左侧子组件 state 保留**；有分窗渲染右栏且无返回 / 编辑按钮；X 结束分窗；方向键调整比例；移动端不渲染；404 自动结束、500 / 网络错误保留
- `SplitRouteBridge` / `useOpenSplit` 测试：非当前文件直接打开；当前文件走导航后才打开；blocker 取消时不打开；tabs 关闭时 fallback 并清 nav 栈
- `content-browser/Header` 测试：`onBack` / `onSplit` / `editing` 缺省不渲染；编辑态隐藏分窗按钮
- `find-scope` / `ContentView` 测试：`onOpenFile` 拦截内部链接；两个实例时 Cmd+F 只打开 active 实例；active 卸载后回落
- `useTextSelection` 双实例测试
- `useSelectionSessionHandlers` 测试：左栏为 chat 路由时含当前会话且在前；与浮窗同 session 去重；左栏为 content 页时仅浮窗会话；`StartSessionPopover` 发送当前会话调用 `sendMessage` 且 `open: false`
- `useContentFile` 测试：404 → `notFound`，其他错误不置位
- `FileTreeContextMenu` 测试：分窗 / 取消分窗项
- `project-lifecycle.structure.test.ts`、`ProjectRuntimeBridges.structure.test.ts`、`feature-registry.test.ts` 更新
- E2E：新增 `content-split-pane.spec.ts`（header 分窗→左侧切走、右侧显示且无返回按钮；右键分窗 / 取消分窗；reload 后恢复；切换项目后恢复；X 结束；侧栏删除父目录后分窗结束；拖动分隔条后比例持久化；左栏打开 chat 时在右栏划词「发送至当前会话」，消息出现在左栏 chat）；回归 `content-tabs.spec.ts`、`file-tree.spec.ts`、`floating-content-browser.spec.ts`、`project-close.spec.ts`、`agent-quick-links.spec.ts`（左栏变窄后 chat header）

## 风险

- `<main>` 结构变化（多一层 `data-split-main`）可能影响用户主题中针对 `<main>` 直接子元素的选择器；按 theming 契约检查两个 theme skill
- 左栏变窄后 chat / content 仍按视口宽度（`useIsMobile`）选择桌面布局；左栏最小 400px 兜底，E2E 检查 chat header 与 composer
- 分窗仅在 `SplitLayout` 挂载，即 `ProjectScope` 内；切换项目时由 `projectId` 读取各自条目，无跨项目残留
- 左侧编辑中的 blocker 不受影响：右侧不注册 blocker，右侧操作（关闭、替换文件）不触发路由变化
- 从右侧划词发起会话会导航左侧；若左侧处于未保存编辑，blocker 拦截，会话已创建但不跳转

## Design review 处理

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| C1 | critical | 开关分窗改变 `<Outlet/>` 树位置，左侧整页重挂载 | 采纳：左栏始终包在稳定 `data-split-main` 中，补 state 保留测试 |
| I1 | important | refetch 失败保留旧 data，`content === null` 判定对已加载文件失效 | 采纳：侧栏删除走 `useCloseDeletedSplit`；外部删除走 `notFound` |
| I2 | important | 任何错误都会关闭并删除持久化分窗 | 采纳：新增 `readContent` 区分 404，仅 404 自动关闭 |
| I3 | important | 右键分窗左侧 dirty 文件：先写 store 后被 blocker 取消，左右同文件 | 采纳：nav state `openSplit` + `SplitRouteBridge` 在导航到达后提交 |
| I4 | important | find scope 应覆盖整个容器（含 header） | 采纳：`useFindScope(rootRef)` 由容器根注册，卸载回落，导出 reset |
| I5 | important | 双 `TextSelectionSession` 残留工具栏 | 采纳：容器外选区清空，补双实例测试 |
| M1 | medium | 最小宽度只在拖拽时生效 | 采纳：ResizeObserver 渲染时 clamp，两栏 `min-w-0` |
| M2 | medium | 右侧发起会话被左侧 blocker 拦截 | 记录为接受行为（会话可从侧栏进入） |
| M3 | medium | 右栏 key 跨项目碰撞 | 采纳：`projectId:filePath`，projectId 变化重置本地 ratio |
| M4 | medium | 只读组件复制视图状态；Header 必填编辑 props | 采纳：`useContentViewState`；Header `editing?` 分组 |
| M5 | medium | 返回按钮 wrapper 残留 | 采纳 |
| M6 | medium | `useOpenSplit` API 不一致、路由判定方式 | 采纳：绑定 projectId，`useMatch` + `useSearchParams` |
| M7 | medium | 左栏窄于视口，仍用桌面布局 | 采纳：左栏最小 400px，E2E 回归 chat |
| M8 | medium | 文档同步清单不全 | 采纳：见「文档同步」 |
| M9 | medium | 测试缺口 | 采纳：见「测试」 |
| m1 | minor | tabs 关闭时 Back 重开文件 | 采纳：fallback 分支清 nav 栈 |
| m2 | minor | 锚点未 decode | 核实不成立：`resolveMarkdownLink` 已 `safeDecode` 锚点 |
| m3 | minor | ratio 范围校验 | 采纳 |
| m4 | minor | separator a11y / RTL | 采纳 |
| m5 | minor | iframe pointer-events 实现方式 | 采纳：pointer capture 为主，Tailwind 任意变体兜底 |
| m6 | minor | 只读树无右键菜单 | 记录，Electron 下不受影响 |
| m7 | minor | 分隔条点击触发 click-away | 接受，与左栏一致 |
| m8 | minor | UI SDK split actions | 本期不做，入 backlog |
| m9 | minor | structure test 仍通过 | 确认 |
