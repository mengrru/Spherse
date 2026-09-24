# 内容区分窗实施计划

- [x] 1. `feature-registry`：`content-split-pane`（ELECTRON_ONLY）+ test
- [x] 2. `features/split-pane/layout.ts`（常量、`clampRatio`）+ test
- [x] 3. `features/split-pane/store.ts` + test；`closeProjectCascade` 接入（+ structure test 清单）
- [x] 4. `lib/api.ts` `readContent`；`useContentFile` 改用并暴露 `notFound` + test
- [x] 5. content-browser 重构：`useContentViewState`、Header 可选 `onBack` / `onSplit` / `editing`、`ContentView` `onOpenFile` + 锚点限定容器与 decode
- [x] 6. `find-scope` + `useFindScope`，接入 ContentBrowser / 浮窗容器 + test
- [x] 7. text-selection-session：`useTextSelection` 容器外清空 + 双实例 test；`useSelectionSessionHandlers`（含左栏当前会话）+ test；popover `open: false`
- [x] 8. `ReadOnlyContentBrowser`
- [x] 9. split-pane：`use-split-divider`、`SplitLayout`、`SplitPaneView`、hooks、`SplitRouteBridge`；nav-state `openSplit`；tabs 关闭命令支持附加 state + fallback 清 nav 栈
- [x] 10. 接入：ProjectScope、ProjectRuntimeBridges(+structure test)、ContentBrowserPage、FileTree 右键菜单、UserFilePanel
- [x] 11. i18n
- [x] 12. 组件测试：SplitLayout、useOpenSplit / bridge、Header、FileTreeContextMenu
- [x] 13. E2E `content-split-pane.spec.ts`
- [x] 14. lint / build / typecheck / test / 受影响 E2E
