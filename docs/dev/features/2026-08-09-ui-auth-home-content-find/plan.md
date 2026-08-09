# 实施计划

三 feature 独立，按 A → B → C 顺序实施，每个 feature 内部按「契约/逻辑 → UI → i18n → 测试」推进。

## Feature A：鉴权错误引导打开设置

- [ ] A1 契约：`packages/server/src/contracts/websocket.ts` 的 `ErrorEventCode` 加 `Auth = "AUTH_ERROR"`
- [ ] A2 服务端分类：`packages/server/src/classify-run-error.ts` 在通用 4xx 前加 `401|403 → Auth`；更新 `__tests__/classify-run-error.test.ts`
- [ ] A3 客户端分类：`packages/app/src/features/chat/model/classify-error.ts` 新增 `AUTH_PATTERNS` 优先判定，从 `PERMANENT_HINT_PATTERNS` 移除 `unauthorized|forbidden` 与 `invalid...key`；更新 `classify-error.test.ts`
- [ ] A4 store：`packages/app/src/stores/app-ui-store.ts` 加 `settingsModalTab` + `openSettings(tab?)`，`setSettingsModalOpen(false)` 清 tab；`SettingsTabs`（`settings/index.tsx`）受控初值取 store tab；齿轮按钮改 `openSettings()`（为不久将来「打开到非默认 tab」预留）
- [ ] A5 UI：`ErrorMessageSection.tsx` 加 `Auth` 友好文案分支 +「打开设置」按钮（直连 `useAppUiStore.openSettings("models")`，`data-chat-open-settings`）；更新 `ErrorMessageSection.structure.test.ts`
- [ ] A6 i18n：`zh-CN.ts`/`en.ts`/`zh-TW.ts` 加 `chat.error.authFailed`、`chat.error.openSettings`

## Feature B：活动栏项目主页按钮

- [ ] B1 动作：`use-project-actions.ts` 加 `handleGoProjectHome`（navigate `/project/:activeProjectId`）
- [ ] B2 UI：`activity-bar/index.tsx` 底部组顶部加 `HomeIcon` 按钮，`useMatch("/project/:projectId/*")` 为真时渲染；更新 `ActivityBar.structure.test.tsx`
- [ ] B3 i18n：三语加 `activity-bar.projectHomeTooltip`

## Feature C：内容浏览器文本搜索

- [ ] C1 工具：新建 `mergeRefs` 工具（无新依赖）
- [ ] C2 hook：`hooks/useContentFind.ts`（TreeWalker 收集、indexOf 匹配、Highlight API + mark 降级、滚动居中、MAX_MATCHES=2000、防抖）+ 单测
- [ ] C3 组件：`FindBar.tsx`（input + N/M + prev/next/close，`data-content-findbar`）
- [ ] C4 集成 ContentView：合并 ref、调用 hook（hooks 在 early-return 之前）、渲染 FindBar、Cmd/Ctrl+F·Esc·Enter/Shift+Enter 快捷键
- [ ] C5 docked 入口：`Header.tsx` 加 `SearchIcon` 开关；`ContentBrowser`(`index.tsx`) 持 `findOpen` state 串联 Header↔ContentView
- [ ] C6 样式：`styles.css` 注册 `::highlight(sp-find-current)`；复用语义 token
- [ ] C7 i18n：三语加 `content-browser.find.*`
- [ ] C8 主题文档：`packages/presets/skills/create-ui-theme/` 补 `data-content-findbar` 说明

## 收尾

- [ ] 更新 `docs/dev/backlog.md`
- [ ] 验证：`npm run lint`、`npm run build`、core/server/app/i18n 测试、i18n parity check
