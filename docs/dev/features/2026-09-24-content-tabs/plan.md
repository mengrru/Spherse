# 内容区多标签页实施计划

- [x] 1. settings：core `AppSettings` / app `HostSettings` / desktop settings merge + test / settings-store（`tabsEnabled`、`loaded`、`setTabsEnabled`）+ test / General 页 Switch / i18n
- [x] 2. `lib/tab-target.ts` + test（key、url、normalize、校验、邻居）
- [x] 3. `stores/tabs-store.ts` + test；`closeProjectCascade` 接入
- [x] 4. nav history：pending back、`dropFromProjectNavHistory` + test
- [x] 5. `features/tabs/`：route target hook、`TabRouteBridge`、`TabBar`、`TabItem`、label hook、`useCloseActiveTab`、`useCloseDeletedFileTabs`
- [x] 6. 接入：ProjectScope、ProjectRuntimeBridges(+structure test)、ChatPage、ContentBrowserPage、BrowserPage/BrowserPageView、UserFilePanel、SkillPanel、use-project-actions
- [x] 7. content-browser `useLeaveGuard`（useBlocker）替换 requestLeave；render helper data router 选项 + test
- [x] 8. TabBar 组件测试
- [x] 9. E2E `content-tabs.spec.ts`
- [x] 10. lint / build / typecheck / test / 受影响 E2E
