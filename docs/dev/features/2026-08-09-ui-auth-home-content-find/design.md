# UI 批次：鉴权错误引导设置 / 项目主页按钮 / 内容浏览器文本搜索

本文档覆盖三个相互独立的小型 UI feature，合并在一个 spec 中描述，后续用一份分三阶段的实施计划落地。

## 概述

1. **Feature A — 鉴权错误引导打开设置**：LLM 返回 401/403 时，在助手错误气泡上增加「打开设置」按钮，点击直接打开 Settings 弹窗并定位到「文本模型」tab（API Key 配置处）。复用现有 `ModelNotConfigured` 的「特定错误 → 特定 `ErrorEventCode` → 特定 UI 处理」模式。
2. **Feature B — 活动栏「项目主页」按钮**：在活动栏底部增加一个按钮，点击回到**当前项目的欢迎页**（`/project/:projectId` 索引路由，即渲染项目 `index.html` 的 iframe）。仅在处于某个项目内时显示。
3. **Feature C — 内容浏览器文本搜索**：为 markdown 渲染页 / 源码 / 纯文本（只读 `<pre>`）增加查找功能（Cmd/Ctrl+F），仅在已渲染 DOM 文本节点上搜索，统一覆盖 markdown 与 pre 两种视图。

---

## Feature A：鉴权错误引导打开设置

### 背景与现状

错误链路与分类机制已由 `2026-08-08-chat-resilience-retry` 建立：错误分两条来源（Source 1 服务端 typed Error → `error` 事件；Source 2 LLM 运行时失败 → `message_end` with `stopReason:"error"`），分别由服务端 `classifyRunError` 与客户端 `classifyErrorMessageString` 分类为 `ErrorEventCode`。

现状下 401/403 的归类：
- **服务端** `packages/server/src/classify-run-error.ts:13`：4xx（≠429）→ `Permanent`。即 401/403 当前归 `Permanent`。
- **客户端** `packages/app/src/features/chat/model/classify-error.ts:30`：`PERMANENT_HINT_PATTERNS` 含 `/unauthorized|forbidden/i`，即 401 文案当前归 `Permanent`。

UI 现状：`ErrorMessageSection.tsx:18` 已有 `errorCode === ModelNotConfigured` 的特殊文案分支；`:44-55` 有「重试」按钮（`onRetry` prop，由 `MessageItem`/`Chat` 透传，需要 sessionId）。

设置弹窗现状：`useAppUiStore`（`app-ui-store.ts`）只持有 `settingsModalOpen: boolean`；`SettingsTabs`（`settings/index.tsx:184`）用 `<Tabs defaultValue="models">` 非受控，**无可编程切换 tab 的能力**。「文本模型」tab 的 value 为 `"models"`。

### 设计

#### A1. 契约：新增 `Auth` 错误码

`packages/server/src/contracts/websocket.ts` 的 `ErrorEventCode` 新增：

```ts
export enum ErrorEventCode {
  ModelNotConfigured = "MODEL_NOT_CONFIGURED",
  Auth = "AUTH_ERROR",
  Permanent = "PERMANENT",
  Transient = "TRANSIENT",
}
```

#### A2. 服务端分类（Source 1）

`classify-run-error.ts` 在通用 4xx 分支**之前**插入鉴权判定：

```ts
if (status === 401 || status === 403) return ErrorEventCode.Auth;
```

放在 `:12`（429/5xx）之后、`:13`（通用 4xx）之前。其余逻辑不变。

#### A3. 客户端分类（Source 2）

`classify-error.ts` 新增 `AUTH_PATTERNS`，在所有 pattern 中**最先**判定：

```ts
const AUTH_PATTERNS = [
  /unauthorized|forbidden/i,
  /invalid (api )?key/i,
  /401|403/,
  /authentication\s*(failed|required)/i,
];
```

并从 `PERMANENT_HINT_PATTERNS` 中移除 `/unauthorized|forbidden/i` 与 `/invalid (api key|key|...)/i`（已迁入 AUTH_PATTERNS）。`classifyErrorMessageString` 依次检查 `AUTH_PATTERNS` → `PERMANENT_PATTERNS` → `TRANSIENT_PATTERNS` → `PERMANENT_HINT_PATTERNS`。

#### A4. 设置弹窗：可编程定位 tab

`useAppUiStore` 扩展：

```ts
interface AppUiStore {
  settingsModalOpen: boolean;
  settingsModalTab: string | null;          // 请求的 tab；null → 默认 "models"
  setSettingsModalOpen: (open: boolean) => void;  // open=false 时同时清空 settingsModalTab
  openSettings: (tab?: string) => void;            // open=true，并设置 tab（默认 "models"）
}
```

- `SettingsTabs`（`settings/index.tsx`）改为受控：挂载时从 store 取一次 `settingsModalTab ?? "models"` 作为初始值（`useState` 初值），`<Tabs value={tab} onValueChange={setTab}>`。由于 `SettingsModal` 每次 open 都重新挂载（`App.tsx:65` 条件渲染），`useState` 初值即捕获本次 open 请求的 tab，之后用户可自由切换。
- 关闭路径（`setSettingsModalOpen(false)`）清空 `settingsModalTab`，避免脏值残留到下次。
- 齿轮按钮（`activity-bar/index.tsx:119`）由 `setSettingsModalOpen(true)` 改为 `openSettings()`（显式定位 "models"，语义更清晰）。

> 当前唯一调用方（鉴权错误按钮）目标 tab 恰为默认 `"models"`，但保留该机制以支持不久将来的「打开到非默认 tab」（如 image/general）场景，避免反复改动 store/SettingsTabs。

#### A5. 错误气泡 UI

`ErrorMessageSection.tsx`：
- 文案分支扩展：`Auth` → 友好文案（`chat.error.authFailed`，说明 API Key 可能无效或缺失，请到设置检查）。
- 新增「打开设置」按钮，**仅当 `errorCode === Auth`** 时渲染：样式复用 retry 按钮（`variant="ghost"`、`text-muted-foreground`、带 `SettingsIcon`），挂 `data-chat-open-settings` 主题钩子。
- 点击直接调 `useAppUiStore` 的 `openSettings("models")`。

**为何走 store 而非 prop**：打开设置是无上下文的全局 UI 动作；而 `onRetry` 需要 sessionId（来自 feature-local streaming store），必须走 prop。两者职责不同，ErrorMessageSection 直接消费全局 `useAppUiStore` 符合「feature 根组件自治 / 全局 UI 动作直连 store」的原则，且避免经 `MessageItem`/`MessageList`/`Chat` 三层透传。

#### A6. i18n

新增（`packages/i18n/src/locales/zh-CN.ts` 为基准带场景注释，同步 `en.ts`、`zh-TW.ts`）：
- `chat.error.authFailed`：鉴权失败友好文案（出现在错误气泡展开区，替代原始 401 文案）。
- `chat.error.openSettings`：「打开设置」按钮文案。

#### A7. 测试

- `classify-run-error.test.ts`：401/403 → `Auth`（原断言 401→Permanent 需改）；其余 status 不变。
- `classify-error.test.ts`：`unauthorized` / `invalid api key` / `401` → `Auth`；context overflow 仍 → `Permanent`；网络错误仍 → `Transient`。
- `ErrorMessageSection.structure.test.ts`：`Auth` code 下渲染「打开设置」按钮（`data-chat-open-settings`），点击调用 store `openSettings("models")`。
- 设置 tab：`openSettings("models")` 后 SettingsTabs 初始激活 `"models"`。

---

## Feature B：活动栏「项目主页」按钮

### 背景与现状

两个「欢迎页」概念需区分（避免歧义）：
- **全局引导页** = `/` 索引路由（`OnboardingPage`），无项目时显示。
- **项目欢迎页** = `/project/:projectId` 索引路由（`WelcomePagePage`，渲染项目 `index.html` 的 iframe）。本 feature 指的是这一个。

`ActivityBar`（`features/activity-bar/index.tsx`）在两处渲染：`App.tsx:63`（非项目内，独立）与 `features/side-panel/index.tsx`（项目内）。底部按钮组（`:98-136`）含 DebugTools / Pin / Settings / Add Project，均为独立 `<Button>`。

导航现状：项目头像点击走 `buildProjectRoute(projectId, project?.lastRoute)`（`use-project-actions.ts:42`），即回到该项目的**上次路由**，并非欢迎页。目前无「回到当前项目欢迎页」的常驻入口（内容浏览器 Header 与 BrowserPage 有上下文相关的返回箭头，但非常驻）。

### 设计

#### B1. 动作

`use-project-actions.ts` 新增：

```ts
const handleGoProjectHome = () => {
  if (!activeProjectId) return;
  navigate(`/project/${activeProjectId}`);   // 索引路由 = 项目欢迎页
};
```

- **仅导航，不改 store**：不动 `activeProjectId`、不关项目。项目仍打开、仍激活，用户可从活动栏头像一键切回上次路由。等同浏览器「回到该项目首页」。
- 加入 hook 返回值。

#### B2. UI

`activity-bar/index.tsx` 底部按钮组**顶部**新增一个按钮（`HomeIcon`，`variant="ghost" size="icon-lg"`）：
- **仅当处于项目内时渲染**：`const inProject = useMatch("/project/:projectId/*") !== null;`（与 `App.tsx:27` 同源判定）。
- `title={t("activity-bar.projectHomeTooltip")}`，`aria-label` 同。
- 点击 `handleGoProjectHome`。

放置位置选择：底部按钮组首位（DebugTools 之前）。底部组是常驻可见的动作区，「项目主页」作为最高频的项目级导航放首位最易触达。在全局 `/`（非项目内）时本按钮不渲染，避免与顶部项目头像重复。

> 备选位置说明：曾考虑侧栏顶部或内容浏览器 Header 已有返回箭头旁。但活动栏是「项目内常驻可见」的位置，跳转最直接，且无需在每个子页面重复入口，故选活动栏。

#### B3. i18n

新增 `activity-bar.projectHomeTooltip`（zh-CN：『项目主页』，注释说明：活动栏按钮，点击回到当前项目的欢迎页 / index.html 预览），同步 en（"Project home"）、zh-TW（『專案首頁』）。

#### B4. 浥试

- `ActivityBar.structure.test.tsx`：新增断言——项目内渲染 home 按钮、非项目内不渲染；按钮自治（从 `useProjectActions` 取 handler，不经 prop）。
- `use-project-actions` 测试：`handleGoProjectHome` 在有 `activeProjectId` 时 `navigate("/project/:id")`，无则 no-op。

---

## Feature C：内容浏览器文本搜索

### 背景与现状

- 文本渲染全部在 `ContentView.tsx`：
  - markdown 渲染：`:132-136`，`<MarkdownContent>` 渲染成普通 HTML（`<p>`/`<code>`/`<pre>` 等），文本分散在多个元素。
  - 源码/纯文本：`:138`，**单个 `<pre>` 内一个裸文本节点** `{content}`。
  - 编辑模式：`:115-124`，`<Textarea>`（本 feature 不覆盖）。
- 滚动容器：`:127` 的 `<div ref={contentRef} className="flex-1 overflow-y-auto p-4">`。注意：当 `text-selection-session` feature 关闭时，`ContentBrowser`（`index.tsx:122-137`）渲染 `<ContentView>` **不传 `contentRef`**，该 div 此时无 ref。
- 无任何虚拟化；文件全量读入 DOM，单 `<pre>` 可能很大。
- 无 Cmd+F 处理、无快捷键系统（沿用各处 `useEffect` + `addEventListener` 模式，参考 `useContentEditor.ts:105`）。
- `ContentView` 同时被浮动内容浏览器（`FloatingContentBrowserContainer`）复用（不含 `Header`）。

### 设计

#### C1. 搜索算法（统一处理 markdown 与 pre）

**在已渲染 DOM 文本节点上搜索**（不搜原始 `content` 字符串），这样 markdown 渲染态与 `<pre>` 源码态共用同一逻辑（markdown 渲染后会剥离语法，源串与渲染文本位置不一一对应）。

1. `TreeWalker`（`NodeFilter.SHOW_TEXT`）遍历滚动容器内所有文本节点，记录每个节点的 `{ node, start, end }`（`start/end` 为该节点文本在「全局拼接文本」中的累积极偏移）。仅存 per-node 元数据（**不存 per-char 映射**），大文件内存可控。
2. 在全局拼接文本上 `indexOf` 循环收集匹配区间（query 为空或 length 0 不搜）。设匹配数上限 `MAX_MATCHES = 2000`，超限停止收集、计数显示 `2000+`（避免在大文件里搜单字符导致爆炸）。
3. 当前匹配：用 `Range`（`setStart`/`setEnd` 在对应 text node 的局部 offset 上，通过二分查找 per-node 元数据定位）。
4. 高亮：**CSS Custom Highlight API**——`new Highlight(currentRange)` → `CSS.highlights.set("sp-find-current", highlight)`。CSS 规则 `::highlight(sp-find-current) { background-color: var(--primary); color: var(--primary-foreground); }`。Electron Chromium（≥105）支持，无 DOM 变更、无 `surroundContents` 跨节点边界问题。
   - **降级**：若 `typeof Highlight === "undefined"`，对「落在单个文本节点内」的匹配用 `range.surroundContents(<mark class="sp-find-mark">)`；跨节点边界的匹配（罕见）catch `DOMException` 后仅滚动不高亮。下次切换匹配前还原上一个 `<mark>`。
5. 滚动：`range.getBoundingClientRect()` 相对滚动容器居中——`container.scrollTop += rect.top - containerRect.top - containerRect.height / 2`（避免 `scrollIntoView` 影响外层滚动）。
6. 默认大小写不敏感；初版不提供「区分大小写 / 正则」开关。

#### C2. 状态与 hook

新建 `packages/app/src/features/content-browser/hooks/useContentFind.ts`，签名：

```ts
interface ContentFindApi {
  containerRef: React.RefObject<HTMLDivElement | null>; // 绑到滚动容器
  open: boolean;
  query: string;
  matchIndex: number;   // 当前匹配（-1 表示无）
  matchCount: number;
  overLimit: boolean;   // 是否超 MAX_MATCHES
  setOpen: (v: boolean) => void;
  setQuery: (q: string) => void;
  next: () => void;
  prev: () => void;
  clear: () => void;
}
export function useContentFind(opts: { enabled: boolean; contentKey: string }): ContentFindApi
```

- `enabled`：仅在可搜索视图（markdown 渲染 / pre 只读，且非编辑态、非 loading/error）启用；关闭时清理高亮与状态。
- `contentKey`：如 `${filePath}#${refreshKey}` 的字符串，变化时触发重新收集匹配（防抖 ~150ms）。
- 输入防抖 ~150ms 后重算匹配；query 变空清空高亮。
- 组件卸载 / `enabled` 转 false 时 `CSS.highlights.delete("sp-find-current")` + 还原 `<mark>`。

#### C3. UI 组件

新建 `packages/app/src/features/content-browser/FindBar.tsx`（纯展示）：输入框 + `N/M`（或 `N/2000+`，无匹配显示 `0/0`）+ 上一个 / 下一个 / 关闭按钮，根节点挂 `data-content-findbar`。配色用语义 token（`bg-background`/`border-border`/`text-foreground`），高亮色 `bg-primary`。

#### C4. 集成

- **`ContentView` 拥有查找能力**（因浮动窗口也复用 `ContentView`，放这里可同时覆盖 docked 与 floating）：
  - `ContentView` 内部创建滚动容器 ref：将 `:127` 的 `<div ref={contentRef}>` 改为同时绑定 `contentRef`（外部，text-selection 用）与查找 hook 的 `containerRef`（用 `mergeRefs` 工具合并）。
  - 调用 `useContentFind({ enabled: !isEditing && !loading && !error && (isMarkdown || (!isHtml && !isImage && !binary)), contentKey: \`${filePath}#${refreshKey}\` })`。**注意 Rules of Hooks**：该 hook 必须在所有提前 `return`（iframe / image / edit）**之前**无条件调用，`enabled` 仅控制是否激活，不影响 hook 调用顺序。
  - 当 `open` 时，在滚动容器**之外、之上**渲染 `<FindBar>`：`ContentView` 最终分支（滚动容器）根改为 `<div className="flex flex-col h-full">`，依次 `FindBar` + 滚动容器。iframe / image / edit 分支各自 `return` 独立全屏布局，不渲染 FindBar（其 `enabled` 为 false，`open` 不会为 true）。
  - 快捷键：`ContentView` 内 `useEffect` 监听 `Cmd/Ctrl+F`（preventDefault）开、`Escape` 关、`Enter` 下一个、`Shift+Enter` 上一个。仅在 `enabled` 时生效。
- **docked Header 入口**（便捷）：`Header.tsx` 右侧按钮组增加 `SearchIcon` 开关按钮，仅在可搜索文件（非图片 / 非 html-iframe / 非编辑态）显示。`ContentBrowser`（`index.tsx`）持有 `findOpen` state，传给 `Header`（`onFindToggle`）与 `ContentView`（`findOpen` + `onFindOpenChange`，作为 hook `open` 的受控源）。`ContentView` 内部 Cmd+F 也调 `onFindOpenChange`。
- **floating**：`FloatingContentBrowserContainer` 复用 `ContentView`，自动获得 Cmd+F（本次不为其加按钮，作为后续可选项）。

#### C5. 主题钩子（AGENTS.md 要求）

- 新增 `data-content-findbar`（FindBar 根）。
- 高亮走 `::highlight(sp-find-current)`（在 `styles.css` 注册，非 data 属性，无需走聊天主题变量）。
- 在 `packages/presets/skills/create-ui-theme/` 与 `create-agent-chat-theme/` 文档中补充说明（仅 `data-content-findbar` 与内容浏览器相关；高亮不属于聊天主题）。

#### C6. i18n

新增（`content-browser.*` 命名空间，zh-CN 带注释）：`content-browser.find.placeholder`（『查找』）、`content-browser.find.next`（『下一个匹配』，按钮 title/aria）、`content-browser.find.previous`（『上一个匹配』）、`content-browser.find.close`（『关闭查找』）、`content-browser.find.noMatch`（『无匹配』，可选，用于计数为 0 时输入框提示态）。同步 en、zh-TW。

#### C7. 测试

- `useContentFind`（jsdom）：渲染一段含多个匹配的 `<pre>` + 滚动容器，断言 matchCount、next/prev 循环、query 清空清高亮、`enabled=false` 清理。CSS Custom Highlight API 在 jsdom 不可用时走 `<mark>` 降级路径断言。
- `FindBar`：渲染计数 `N/M`、`overLimit` 显示 `2000+`、按钮回调。
- `ContentView.structure` / 集成测试：Cmd+F 打开 FindBar、可搜索视图才启用、编辑模式不启用。

---

## 数据模型汇总

- **Feature A**：`ErrorEventCode` 增 `Auth`；`useAppUiStore` 增 `settingsModalTab` + `openSettings`。
- **Feature B**：无新数据模型（纯导航）。
- **Feature C**：`useContentFind` 局部状态（不入全局 store）。`MAX_MATCHES = 2000` 常量。

## 范围之外

- A：不做成功响应的「重新生成」；不把 `Auth` 错误纳入自动重试（它仍是终态，仅多一个跳转按钮）。
- B：不做「关闭 / 取消选中当前项目」语义；不增加全局 `/` 引导页的入口。
- C：不覆盖编辑模式（textarea）查找、HTML iframe 预览、图片；不提供正则 / 区分大小写 / 替换；floating 窗口不加显式按钮（仅 Cmd+F）。
- 三者均不改动既有安全 / 鉴权 / WS 协议语义。

## 实现备注

- `mergeRefs` 工具：仓库内若无则在本 feature 内新建小工具（合并多个 ref 到一个回调），不引入新依赖。
- Feature A 的 `Auth` 错误仍参与 `chat-resilience-retry` 已有的分类体系（不触发自动重试，与 `Permanent` 行为一致，仅 UI 多按钮）。
