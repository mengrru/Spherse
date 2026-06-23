# 体验优化 Round 1 — Design

- 日期：2026-06-24
- 范围：content browser 工具栏增强、HTML 编辑、文件改动自动刷新、聊天气泡宽度、返回键 project 隔离、chat HTML card 图片渲染修复
- 类型：体验优化 + bugfix（混合）

## 1. 背景与现状

本轮聚焦六项独立改动，均针对现有代码中已确认的痛点或缺陷。各改动相互独立、可分别实现与验证。

| # | 主题 | 现状（关键文件:行） |
|---|---|---|
| 1 | content browser 工具栏 | `Header.tsx` 仅有 Back + 路径展示 + (Edit\|Preview/Source)；无复制路径、无刷新 |
| 2 | HTML 文件不可编辑 | `index.tsx:46` `isEditable = !isHtml && !isImage`；`Header.tsx:58` Edit 按钮 `isEditable && !isHtml` 永不显示给 HTML |
| 3 | 只读模式无自动刷新 | `useContentEditor.ts:122-127` 已通过 ws-bus 订阅 fs-watch 并 path-filter，但 `!isEditingRef.current` 时 early-return（仅 conflict）；只读无刷新 |
| 4 | 聊天气泡偏窄 | `MessageItem.tsx:22` `max-w-[80%]` |
| 5 | 返回键跨 project | `ContentBrowserPage.tsx:61` `navigate(-1)` 走全局共享 history，切项目后可退到其它 project |
| 6 | chat HTML card 图片不显示 | `HtmlCard.tsx:84` `<iframe srcDoc={card.html}>`（origin `null`，相对路径无法解析）；`render-card.ts:64-88` 丢弃 `file_path`，card 无 base 信息 |

### 关键事实

- **content browser HTML 渲染（对照）**：`ContentView.tsx:41` `<iframe src={client.getPreviewUrl(filePath)}>`，由 `preview.ts` 以真实 HTTP URL 提供 HTML 与图片等静态资源，相对路径自然解析。这就是图片在 content browser 能显示、在 chat card 不能显示的根因。
- **fs-watch 管线（ws-bus 重构后）**：单一全局 `/ws/bus` WebSocket，`(projectId, channel)` 订阅模型（`ws-bus.ts`）；fs-watch channel 发送 `{channel:"fs-watch", projectId, type:"change", payload:{eventType, path}}`，契约见 `contracts/bus.ts`。客户端经 `stores/bus-store.ts`（自动重连/心跳/订阅重放）+ `hooks/useBusSubscription(projectId, channel, handler)` 消费，handler 签名 `(type, payload)` —— **path 已透传**。现有 fs-watch 消费方：file-tree（忽略 payload、300ms debounce 全量刷新）、content editor（仅编辑时按 path 匹配设 conflict）、custom-theme（`.spherse/theme.css` 变更时刷新 `<link>`）。
- **路由**：React Router v7 hash router，`/project/:projectId` 为 layout route；所有 project 共享一份全局 history。
- **toast**：全仓库统一 `import { toast } from "sonner"`；复制路径成功提示可参考 `FileTreeContextMenu.tsx:41`（key `file-tree.pathCopied`）。

## 2. 需求（来自对齐）

1. content browser 增加复制路径 + 刷新按钮。
2. HTML 文件增加编辑按钮（复用 textarea 编辑源码模式）。
3. 文件更新后在非编辑状态自动刷新（基于现有 fs-watcher）。
4. 聊天气泡最大宽度改为 chat 区域宽度的 90%。
5. bugfix：content browser 返回键不应退到其它 project；若上一条历史非当前 project 则回到项目主页。抽一个 project 专用的 `history.go(-1)`。
6. bugfix：chat 中 HTML card 的图片引用无法显示（content browser 同页面可显示）。

### 对齐结论（已确认）

- **复制路径格式**：复制**相对项目根目录**的路径（与 Header 已展示的 `filePath` 一致，如 `output/report.html`）。
- **HTML 编辑模式**：复用现有 textarea 编辑流程编辑原始 HTML 源码；编辑时隐藏 Preview/Source 切换，Save/Cancel 后回到 Preview。行为与其它文本文件一致，改动最小。
- **HTML card 图片修复**：当 card 来源于 `file_path` 时，iframe 改用 `src={previewUrl}`（与 content browser 一致）；纯 `content` inline HTML 仍用 `srcDoc`（这类内容通常无外部相对资源）。

## 3. 设计

### 3.1 content browser：复制路径 + 刷新按钮

**位置**：`features/content-browser/Header.tsx` 工具栏右侧。

**复制路径按钮**：
- 新增 `CopyIcon` 按钮，放在路径展示 `<span>` 与右侧操作区之间（或紧邻路径）。
- 点击执行 `navigator.clipboard.writeText(filePath)`（`filePath` 即相对路径），成功后 `toast.success(t("content-browser.pathCopied"))`。
- 复用 `sonner`，模式对齐 `FileTreeContextMenu.tsx:39-46`。
- 文案 key 见 §4 i18n。

**刷新按钮**：
- 新增 `RefreshCwIcon` 按钮。
- 点击触发统一 `reload()`（见下）。
- **编辑中禁用**（`disabled={isEditing}`），避免丢弃未保存编辑；编辑态的磁盘变更仍由现有 conflict 流程处理。

**统一 reload 机制**：
- `hooks/useContentFile.ts` 增加 `reload()`：用一个 `reloadNonce` state 作为 effect 依赖（`[filePath, client, reloadNonce]`），调用时 `reloadNonce++` 重新拉取文本内容。
- HTML/图片 iframe 的刷新：`ContentBrowser` 持有 `refreshKey` state，`reload()` 同时 `setRefreshKey(k=>k+1)`；将 `refreshKey` 作为 `<iframe>` 的 `key` 传入 `ContentView`，使 React remount iframe → 重新请求 preview URL。
- `reload()` 聚合：在 `ContentBrowser`（`index.tsx`）中组合 `useContentFile.reload()` + `setRefreshKey()`，作为 `onRefresh` 回调传给 `Header`。

**改动文件**：
- `features/content-browser/Header.tsx`：新增两个按钮 + props（`onCopyPath`、`onRefresh`、`refreshing?`）。
- `features/content-browser/index.tsx`：组合 `reload`、传 props。
- `features/content-browser/hooks/useContentFile.ts`：暴露 `reload()`。
- `features/content-browser/ContentView.tsx`：iframe 接收 `refreshKey` 作为 `key`。

### 3.2 HTML 文件编辑按钮

目标：让 HTML 文件可进入 textarea 源码编辑，与其它文本文件体验一致。

**改动**：
- `index.tsx:46`：`isEditable = !isHtml && !isImage` → `isEditable = !isImage`。
- `Header.tsx:58`：Edit 按钮条件 `isEditable && !isHtml` → `isEditable`（去掉 `&& !isHtml`）。
- 现有 `Header.tsx:63` Preview/Source 切换的渲染条件 `isHtml && !isEditing` 保持不变 → 编辑时自动隐藏切换，符合需求。
- `ContentView.tsx:60-69` 已有 `if (isEditing)` 渲染 `<Textarea>` 分支，对 HTML 同样适用（HTML 在编辑态不再走 `:38` 的 preview 分支，因为该分支含 `&& !isEditing`）。无需额外改动。
- 编辑流程（`useContentEditor` 的 enterEdit/cancelEdit/save/conflict）对 HTML 完全复用，无需改动。

**保存语义**：Save 直接写入 `editedContent`（原始 HTML）到磁盘，不做额外转换。

**改动文件**：`index.tsx`、`Header.tsx`（各一处条件）。

### 3.3 非编辑状态自动刷新（基于 ws-bus）

**现状**：ws-bus 重构后，`payload.path` 已透传到每个 fs-watch 消费方（handler 签名 `(type, payload)`）。`useContentEditor.ts:122-127` 已订阅 fs-watch 并按 path 匹配，但 `!isEditingRef.current` 时 early-return —— **只读模式无任何刷新**。因此本轮无需再改管线，只需新增一个只读模式的 path-aware 刷新订阅。

**方案：新增只读刷新 hook**

- 新增 `features/content-browser/hooks/useContentAutoRefresh.ts`：
  - 签名 `useContentAutoRefresh({ projectId, filePath, enabled, onReload })`。
  - `enabled = !isEditing`（由 `ContentBrowser` 传入；编辑态由 conflict 流程负责，不重复刷新）。
  - 经 `useBusSubscription(projectId, "fs-watch", handler)` 订阅；handler 中：
    - 从 `payload` 取 `path`，归一化为 posix 风格（`.replace(/\\/g,"/")`）—— 复用 `useContentEditor.ts:124` 和 `useCustomTheme.ts:25` 已建立的同一惯用法。
    - 与 `filePath` 归一化后比较；仅当相等时触发刷新。
    - 300ms debounce（与 file-tree 一致），调用 `onReload()`（§3.1 统一 `reload()`，确保文本内容与 iframe 同步刷新）。
  - 用 `useRef` 持有 `enabled`/`filePath`/`onReload` 的最新值（handler identity 稳定，不触发 `useBusSubscription` 重订阅——该 hook 仅依赖 `[projectId, channel]`）。
- 多订阅零成本：`bus-store` 对同一 `(projectId, channel)` 去重 subscribe，服务端共享一个 OS watcher（`fs-watcher.ts` acquire/release）。新增第 4 个 fs-watch handler 不增加网络或 OS 开销。

**改动文件**：新增 `features/content-browser/hooks/useContentAutoRefresh.ts`；`features/content-browser/index.tsx`（实例化 hook，`enabled={!editor.isEditing}`，`onReload={reload}`）。

### 3.4 聊天气泡宽度 90%

- `features/chat/MessageItem.tsx:22`：外层 wrapper className `max-w-[80%]` → `max-w-[90%]`。
- 该 wrapper 同时服务 user/assistant 气泡（`self-end`/`self-start`），一处改动覆盖两种角色。
- floating-chat 复用同一 `MessageItem`，90% 在窄浮窗内同样合理，无需特判。

**改动文件**：`features/chat/MessageItem.tsx`（一处）。

> 说明：`max-w-[90%]` 属既有约定的 magic-number 百分比写法（当前 80% 即如此），沿用既有风格，不引入新 token。

### 3.5 返回键 project 隔离

**问题**：`navigate(-1)` 走全局共享 history；切项目时 `App.tsx` 以 push 方式导航，旧 project 路由残留在栈中，导致 content browser 返回可能落到其它 project。

**方案：project 专用导航 hook**——追踪全局「上一条 pathname」，按下返回时判断其是否属于当前 project。封装为一个通用的 project-scoped navigation hook（命名不局限于 `back`，便于后续按需扩展其它 project 内导航能力）：

- 新增 `lib/use-project-navigation.ts`（`lib/` 为扁平结构，无 hooks 子目录，与 `api.ts`/`utils.ts` 并列），导出：
  - 纯函数 `isPathInProject(pathname: string, projectId: string): boolean`（判断 `pathname` 是否属于 `/project/${projectId}`），便于单测。
  - hook `useProjectNavigation()`：内部 `useNavigate()` + 从 `useProjectCtx()` 取 `projectId`，读取模块级「上一条 pathname」（`prevPathname`，见下），返回方法对象：
    - `back()`：若 `isPathInProject(prevPathname, projectId)` → `navigate(-1)`；否则 → `navigate(\`/project/${projectId}\`)`（项目主页/Welcome）。
  - （本轮只实现 `back()`，不预置其它方法——按 YAGNI，命名留扩展余地即可。）
- App shell 追踪：`App.tsx` 始终挂载，在其中 location-change 处调用模块函数 `trackPrevPath(location.pathname)`（effect 依赖 `location.pathname`），保证 `prevPathname` 始终反映全局上一条。
- `pages/ContentBrowserPage.tsx:61`：`onBack={() => navigate(-1)}` → `onBack={() => back()}`（`const { back } = useProjectNavigation()`）。

**边界**：
- 初始进入 project（prevPathname 为空或非本项目）→ 返回回项目主页，符合「上一条非当前 project 则回主页」。
- project 内连续导航（如 chat→content）→ prevPathname 属当前 project → `navigate(-1)` 正常回退。
- 该方案为单窗口 Electron 应用的确定性、低风险实现；模块级 ref 在单窗口下无并发问题。

**改动文件**：新增 `lib/use-project-navigation.ts`；`App.tsx`（追踪 prevPath）；`pages/ContentBrowserPage.tsx`。

### 3.6 chat HTML card 图片修复

**根因**：chat 用 `srcDoc`（origin `null`），相对 `<img src>` 无法解析；且 `render-card.ts` 丢弃 `file_path`，前端拿不到来源目录。content browser 用 `src=previewUrl` 故正常。

**方案（已选：src=preview URL for file_path）**：

1. `packages/core/src/tools/render-card.ts`：
   - `onUpdate` 与最终 `return` 的 `details` 中新增 `file_path: params.file_path`（仅 file_path 来源时存在；inline content 不设）。
2. `packages/app/src/features/chat/types.ts`：
   - `HtmlCard` 增加可选字段 `file_path?: string`。
3. `packages/app/src/features/chat/chat-session-reducer.ts`：
   - 流式路径（`:149` `updated._card = details`）天然带上新字段，无需改动。
   - 历史恢复路径（`:234-242`）手动构造 card，新增 `file_path: toolResult.details.file_path`。
4. `packages/app/src/features/chat/HtmlCard.tsx`：
   - 渲染分支：若 `card.file_path && client` → `<iframe src={client.getPreviewUrl(card.file_path)} sandbox="allow-scripts allow-same-origin" ...>`；否则保持 `<iframe srcDoc={card.html} ...>`。
   - `sandbox` 保留（与 chat 现有一致；图片为同源 HTTP GET，sandbox 不影响加载）。
   - 保存逻辑（`handleSave`）不受影响：仍基于 `card.html` 写盘。
   - `client` 已由 `useProjectCtx()` 提供（`:17`）。

**已知限制（接受）**：纯 `content` inline HTML（无 `file_path`）仍用 `srcDoc`，其内部相对图片依旧无法解析。此类内容通常为自包含 HTML，不在本轮范围。

**改动文件**：`render-card.ts`、`types.ts`、`chat-session-reducer.ts`、`HtmlCard.tsx`。

## 4. i18n 新增文案

基准 `packages/i18n/src/locales/zh-CN.ts`（每条附 UI 场景注释），同步 `zh-TW`、`en`：

| key | zh-CN | 场景 |
|---|---|---|
| `content-browser.copyPath` | 复制路径 | content browser Header 复制按钮文案 |
| `content-browser.pathCopied` | 路径已复制 | 复制相对路径成功后的 toast |
| `content-browser.refresh` | 刷新 | content browser Header 刷新按钮（icon 按钮 title/aria-label） |

> 复用既有 `common.back`、`common.edit`、`common.save` 等，不重复新增。

## 5. 边界与测试

**单元/契约测试**：
- `render-card.ts`：补/改测试，断言 `file_path` 来源时 `details.file_path` 等于入参；inline 时不包含该字段。
- `chat-session-reducer.ts`：历史恢复路径构造的 `_card` 包含 `file_path`。
- `useProjectNavigation`：`isPathInProject` 纯函数与 `back()` 的两条分支（prevPathname 属/不属当前 project）行为（可抽纯函数判定逻辑做单测）。
- （ws-bus fs-watch 契约 `contracts/bus.ts` 已有覆盖，无需新增。）

**手动/E2E 验证**：
- 复制路径：粘贴得到相对路径，toast 出现。
- 刷新：外部改文件后只读态自动刷新；编辑态出现 conflict 而非覆盖。
- HTML 编辑：进入/退出编辑、Save 写盘后 Preview 更新。
- 气泡宽度：宽窗口下气泡占 chat 区 ~90%。
- 返回键：切项目后 content 返回回项目主页；project 内 chat→content 返回回 chat。
- HTML card 图片：`render_card({file_path})` 引用的相对图片在 chat card 正常显示；inline content card 仍渲染（图片除外）。

**E2E 选择建议**：content browser / chat / 路由相关 E2E（文件树、content browser、chat/session）受影响，合并前优先跑对应 spec。

## 6. 不在本轮范围

- 纯 inline HTML card 的相对资源解析（可后续用 `<base>` 注入方案）。
- project 内完整的前进/后退历史栈（本次仅解决返回不跨 project）。
- HTML 卡片的可视化编辑器（仅源码编辑）。
