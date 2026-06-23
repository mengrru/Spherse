# 体验优化 Round 1 — Implementation Plan

- 对应 design：`docs/dev/features/2026-06-24-ux-optimization-round1/design.md`
- 实现：subagent-driven 模式（各 Task 独立派发）
- 验证：`npm run verify`（lint + build + unit tests + i18n check）

## Task 依赖与并行

```
T1 (content browser toolbar + reload + i18n) ──┐
                                               ├──> T3 (auto-refresh，依赖 T1 的 reload)
T2 (HTML edit)      | T4 (bubble 90%) | T5 (back key) | T6 (HTML card image)   并行
```

- **可并行批次 1**：T1、T2、T4、T5、T6（无相互依赖；T1 含 i18n 文案，自洽）
- **串行**：T3 在 T1 完成后派发（消费 T1 的 `useContentFile.reload()` 与 `ContentBrowser` 的统一 reload 组合）

---

## T1 — content browser 工具栏 + 统一 reload + i18n

**目标**：Header 增加复制路径按钮、刷新按钮；建立统一 `reload()` 机制；补 3 条 i18n 文案。

**改动**：

1. `packages/app/src/features/content-browser/hooks/useContentFile.ts`
   - 增加 `reloadNonce` state（初始 0）
   - content 拉取 effect 依赖改为 `[filePath, client, reloadNonce]`
   - 暴露 `reload: () => setReloadNonce(n => n + 1)`
2. `packages/app/src/features/content-browser/index.tsx`
   - 新增 `refreshKey` state（驱动 iframe remount）
   - 组合统一 `reload`：`const reload = useCallback(() => { reloadContent(); setRefreshKey(k => k + 1); }, [reloadContent])`（`reloadContent` 来自 `useContentFile` 的 `reload`，需 `useCallback` 稳定化或用 ref）
   - 传 `onCopyPath`、`onRefresh`、`refreshing?`（可选）给 `Header`
   - 传 `refreshKey` 给 `ContentView` 的 iframe（作为 React `key`）
3. `packages/app/src/features/content-browser/Header.tsx`
   - import `CopyIcon`、`RefreshCwIcon`（lucide-react）
   - 路径 `<span>` 后插入两个图标按钮（`size="icon"` / `variant="ghost"`）
   - 复制按钮 `onClick`：`navigator.clipboard.writeText(filePath)` → `toast.success(t("content-browser.pathCopied"))`
   - 刷新按钮 `onClick={onRefresh}`，`disabled={isEditing}`
   - Props 新增 `onCopyPath`、`onRefresh`
4. `packages/app/src/features/content-browser/ContentView.tsx`
   - iframe 接收 `refreshKey` 并作为 `key={refreshKey}`
5. i18n（3 文件：`zh-CN.ts` / `zh-TW.ts` / `en.ts`，插入到各自 `content-browser.source` 之后）：
   - `content-browser.copyPath`：复制路径 / 複製路徑 / Copy path
   - `content-browser.pathCopied`：路径已复制 / 路徑已複製 / Path copied
   - `content-browser.refresh`：刷新 / 重新整理 / Refresh

**参考模式**：`FileTreeContextMenu.tsx:39-46`（复制路径 + toast）。

**验证**：`npm run lint --workspace=packages/app` + `npm test --workspace=packages/i18n` + 手动：复制得到相对路径、toast 出现；刷新按钮 remount iframe；编辑态禁用刷新。

---

## T2 — HTML 文件编辑按钮

**目标**：HTML 文件可进入 textarea 源码编辑。

**改动**（两处条件）：
1. `packages/app/src/features/content-browser/index.tsx:46`
   - `const isEditable = !isHtml && !isImage;` → `const isEditable = !isImage;`
2. `packages/app/src/features/content-browser/Header.tsx:58`
   - `: isEditable && !isHtml ? (` → `: isEditable ? (`

**无需改动**：`ContentView.tsx` 的 `if (isEditing)` textarea 分支已适用 HTML；Preview/Source 切换的 `isHtml && !isEditing` 条件使编辑态自动隐藏切换。

**验证**：`npm run lint --workspace=packages/app`；手动：HTML 文件显示 Edit 按钮 → 进入编辑 → Save 后回到 Preview。

---

## T3 — 非编辑状态自动刷新（依赖 T1）

**前置**：T1 完成（`ContentBrowser` 已有统一 `reload`）。

**目标**：只读模式下文件外部变更时自动刷新。

**改动**：
1. 新增 `packages/app/src/features/content-browser/hooks/useContentAutoRefresh.ts`：
   ```ts
   export function useContentAutoRefresh({
     projectId, filePath, enabled, onReload,
   }: {
     projectId: string; filePath: string; enabled: boolean; onReload: () => void;
   }): void
   ```
   - `useRef` 持有 `enabled`、`filePath`、`onReload` 最新值（handler 稳定，不触发重订阅）
   - `useBusSubscription(projectId, "fs-watch", (_type, payload) => {...})`
   - handler 内：`enabledRef.current` 为 false 则 return；取 `payload.path`，`(payload as {path?:string}|null)?.path?.replace(/\\/g,"/")` 归一化，与 `filePathRef.current.replace(/\\/g,"/")` 比较；相等则 300ms debounce 调 `onReloadRef.current()`
   - 用模块内 `timerRef`（`useRef`）管理 debounce
2. `packages/app/src/features/content-browser/index.tsx`
   - `const { projectId } = useProjectCtx()`（已有）
   - `useContentAutoRefresh({ projectId, filePath, enabled: !editor.isEditing, onReload: reload })`

**参考惯用法**：`useContentEditor.ts:112-127`（ref + path 归一化）、`features/file-tree/hooks/useFsWatchRefresh.ts`（debounce）。

**验证**：`npm run lint --workspace=packages/app`；手动：只读态外部改文件 → 自动刷新；编辑态不触发（由 conflict 流程负责）。

---

## T4 — 聊天气泡宽度 90%

**目标**：气泡最大宽度 80% → 90%。

**改动**（一处）：
- `packages/app/src/features/chat/MessageItem.tsx:22`
  - className 中 `max-w-[80%]` → `max-w-[90%]`

**验证**：`npm run lint --workspace=packages/app`；手动：宽窗口下气泡占 ~90%。

---

## T5 — 返回键 project 隔离

**目标**：content browser 返回不跨 project；上一条非当前 project 则回项目主页。

**改动**：
1. 新增 `packages/app/src/lib/use-project-navigation.ts`：
   - 纯函数 `isPathInProject(pathname: string, projectId: string): boolean`：`pathname === \`/project/${projectId}\` || pathname.startsWith(\`/project/${projectId}/\`)`
   - 模块级 `prevPathname: string`（初始 `""`）+ `trackPrevPath(pathname: string): void`（赋值）
   - hook `useProjectNavigation()`：`useNavigate()` + `useProjectCtx()` 取 `projectId`；返回 `{ back }`，`back()` 中：`isPathInProject(prevPathname, projectId)` ? `navigate(-1)` : `navigate(\`/project/${projectId}\`)`
2. `packages/app/src/App.tsx`
   - `useLocation()` 取 `location.pathname`；新增 effect 依赖 `[location.pathname]` 调 `trackPrevPath(location.pathname)`（App.tsx 始终挂载）
3. `packages/app/src/pages/ContentBrowserPage.tsx`
   - 删去 `useNavigate()`（若仅用于 back）；`const { back } = useProjectNavigation()`
   - `onBack={() => navigate(-1)}` → `onBack={back}`（`editor.requestLeave(back)`）

**单测**（T5 自带）：`isPathInProject` 纯函数边界（等于 / 前缀匹配 / 不匹配 / 空 pathname）。放 `packages/app/src/lib/use-project-navigation.test.ts`。

**验证**：`npm test --workspace=packages/app`（含新测试）+ `npm run lint`；手动：切项目后 content 返回回主页；project 内 chat→content 返回回 chat。

---

## T6 — chat HTML card 图片修复

**目标**：`render_card({file_path})` 的相对图片在 chat card 正常显示。

**改动**（4 文件，跨 core + app）：
1. `packages/core/src/tools/render-card.ts`
   - `onUpdate`（`:64-75`）与 `return`（`:77-88`）的 `details` 新增 `file_path: params.file_path`（仅 `params.file_path` 存在时；inline content 不设 → 该字段为 `undefined`）
2. `packages/app/src/features/chat/types.ts`
   - `HtmlCard` interface 新增 `file_path?: string`
3. `packages/app/src/features/chat/chat-session-reducer.ts`
   - 流式路径（`:149` `updated._card = details`）天然带上，无需改
   - 历史恢复路径（`:234-242`）手动构造 card 处新增 `file_path: toolResult.details.file_path`
4. `packages/app/src/features/chat/HtmlCard.tsx`
   - 渲染分支（`:83-92`）：`card.file_path` 存在 → `<iframe src={client.getPreviewUrl(card.file_path)} sandbox="allow-scripts allow-same-origin" ... />`；否则保持 `<iframe srcDoc={card.html} ... />`
   - `client` 已由 `useProjectCtx()` 提供（`:17`）

**单测**（T6 自带）：
- `packages/core`：`render-card` 测试断言 `details.file_path`（file_path 来源 / inline 来源两分支）
- （可选）`chat-session-reducer`：历史恢复 `_card.file_path`

**验证**：`npm test --workspace=packages/core` + `npm run lint` + `npm run build`（确保 core 变更编译，app 消费）；手动：`render_card({file_path})` 引用相对图片正常显示；inline content card 仍渲染。

---

## 收尾验证（合并前）

- `npm run verify`（lint + build + unit tests + i18n check，必须全绿）
- 按设计 §5「E2E 选择建议」跑受影响 spec：content browser、chat/session、文件树相关 E2E
- 更新 `docs/dev/backlog.md`（如有对应条目）
